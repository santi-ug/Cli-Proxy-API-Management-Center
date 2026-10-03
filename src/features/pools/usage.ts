/**
 * Live usage reads and reset spending for pool accounts, all through the
 * management api-call proxy (`$TOKEN$` is swapped for the credential's token).
 * Request shapes follow T3 Code's cliproxyApi reference.
 */

import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex, utf8ToBytes, hexToBytes } from '@noble/hashes/utils.js';
import { apiCallApi, getApiCallErrorMessage, type ApiCallResult } from '@/services/api/apiCall';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import {
  readClaudeResetGrants,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import { resetGrantOperations } from '@/features/quota/providers/claude/resetGrantOperations';
import { selectResetGrant } from '@/features/quota/providers/claude/selectResetGrant';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
} from '@/utils/quota/constants';
import { resolveCodexChatgptAccountId, resolveCodexPlanType } from '@/utils/quota/resolvers';
import type { AccountUsage, PoolAccount } from './model';
import {
  parseClaudeRateLimitTier,
  parseClaudeUsage,
  parseCodexConsumeCode,
  parseCodexResetCredits,
  parseCodexUsage,
} from './parsers';

/** What a reset attempt tells the person, as an i18n key and a notification tone. */
export interface ResetResult {
  ok: boolean;
  messageKey: string;
}

const isOk = (result: ApiCallResult) => result.statusCode >= 200 && result.statusCode < 300;

function requireAuthIndex(account: PoolAccount): string {
  if (!account.authIndex) throw new Error('missing auth_index');
  return account.authIndex;
}

async function getOk(authIndex: string, url: string, header: Record<string, string>) {
  const result = await apiCallApi.request({ authIndex, method: 'GET', url, header });
  if (!isOk(result)) throw new Error(getApiCallErrorMessage(result));
  return result.body;
}

// ---------------------------------------------------------------------------
// Claude

/** Plan tiers rarely change: one profile read per account per connection. */
const claudeTiers = new Map<string, Promise<string | null>>();

function readClaudeTier(authIndex: string): Promise<string | null> {
  const key = `${apiClient.getConnectionRevision()}:${authIndex}`;
  const cached = claudeTiers.get(key);
  if (cached) return cached;
  const pending = getOk(authIndex, CLAUDE_PROFILE_URL, { ...CLAUDE_REQUEST_HEADERS }).then(
    parseClaudeRateLimitTier
  );
  claudeTiers.set(key, pending);
  // A failed read is retried on the next poll instead of being remembered.
  pending.catch(() => claudeTiers.delete(key));
  return pending;
}

/** Resets left on grants that can be spent at some point now: not paused, not expired. */
export function countClaudeBankedResets(status: AnthropicResetGrantStatus, now: number): number {
  if (!status.eligible) return 0;
  return status.grants
    .filter(
      (grant) =>
        !grant.paused &&
        (!grant.startsAt || Date.parse(grant.startsAt) <= now) &&
        (!grant.endsAt || Date.parse(grant.endsAt) > now)
    )
    .reduce((sum, grant) => sum + grant.resetsLeft, 0);
}

export async function fetchClaudeUsage(account: PoolAccount): Promise<AccountUsage> {
  const authIndex = requireAuthIndex(account);
  const [usage, grants, tier] = await Promise.allSettled([
    getOk(authIndex, CLAUDE_USAGE_URL, { ...CLAUDE_REQUEST_HEADERS }),
    readClaudeResetGrants(authIndex),
    readClaudeTier(authIndex),
  ]);
  if (usage.status === 'rejected') throw usage.reason;
  const windows = parseClaudeUsage(usage.value);
  if (!windows) throw new Error('unexpected usage response');
  return {
    windows,
    planCode: tier.status === 'fulfilled' ? tier.value : null,
    // Only a parsed reset-grant block proves a count; otherwise the page shows none.
    bankedResets:
      grants.status === 'fulfilled' ? countClaudeBankedResets(grants.value, Date.now()) : null,
  };
}

const CLAUDE_REFUSALS = new Set([
  'not_limited',
  'cooldown',
  'ineligible',
  'unavailable',
  'rate_limited',
  'auth_error',
]);

export async function redeemClaudeReset(account: PoolAccount): Promise<ResetResult> {
  const authIndex = requireAuthIndex(account);
  const grant = selectResetGrant(await readClaudeResetGrants(authIndex), Date.now());
  if (!grant) return { ok: false, messageKey: 'claude_reset.blocked' };
  try {
    const answer = await resetGrantOperations.run(account.key, authIndex, grant.id);
    if (answer.unresolved) return { ok: false, messageKey: 'claude_reset.unknown' };
    if (answer.code === 'reset' || answer.code === 'already_used') {
      await clearCooldown(authIndex);
      return { ok: true, messageKey: `claude_reset.${answer.code}` };
    }
    return {
      ok: false,
      messageKey: CLAUDE_REFUSALS.has(answer.code)
        ? `claude_reset.${answer.code}`
        : 'claude_reset.blocked',
    };
  } catch {
    const pending = resetGrantOperations.inspect(account.key);
    return {
      ok: false,
      messageKey: pending && !pending.code ? 'claude_reset.unknown' : 'claude_reset.blocked',
    };
  }
}

// ---------------------------------------------------------------------------
// Codex

function codexHeader(account: PoolAccount): Record<string, string> {
  const accountId = resolveCodexChatgptAccountId(account.file);
  return {
    ...CODEX_REQUEST_HEADERS,
    Accept: 'application/json',
    'OpenAI-Beta': 'codex-1',
    Originator: 'Codex Desktop',
    ...(accountId ? { 'Chatgpt-Account-Id': accountId } : {}),
  };
}

export async function fetchCodexUsage(account: PoolAccount): Promise<AccountUsage> {
  const authIndex = requireAuthIndex(account);
  const header = codexHeader(account);
  const [usage, credits] = await Promise.allSettled([
    getOk(authIndex, CODEX_USAGE_URL, header),
    getOk(authIndex, CODEX_RATE_LIMIT_RESET_CREDITS_URL, header),
  ]);
  if (usage.status === 'rejected') throw usage.reason;
  const now = Date.now();
  const parsed = parseCodexUsage(usage.value, now);
  if (!parsed) throw new Error('unexpected usage response');
  // A credits outage must not hide successfully fetched windows.
  const available =
    credits.status === 'fulfilled' ? parseCodexResetCredits(credits.value, now) : null;
  return {
    windows: parsed.windows,
    planCode: parsed.planCode ?? resolveCodexPlanType(account.file),
    bankedResets: available ? available.length : null,
  };
}

const REDEEM_NAMESPACE = hexToBytes('6f1c2a9e2d4b4c1e9a7f3b8d5e0c1a42');

/**
 * UUIDv5-shaped id per account and credit, byte-for-byte the one T3 Code sends,
 * so a retry from either client redeems the same credit at most once.
 */
export function creditRedeemRequestId(accountId: string, creditId: string): string {
  const input = new Uint8Array([...REDEEM_NAMESPACE, ...utf8ToBytes(`${accountId}:${creditId}`)]);
  const bytes = sha1(input).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function redeemCodexReset(account: PoolAccount): Promise<ResetResult> {
  const authIndex = requireAuthIndex(account);
  const header = codexHeader(account);
  const credits = parseCodexResetCredits(
    await getOk(authIndex, CODEX_RATE_LIMIT_RESET_CREDITS_URL, header),
    Date.now()
  );
  const credit = credits?.[0];
  if (!credit) return { ok: false, messageKey: 'pools.reset_result.no_credit' };

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
    header,
    data: JSON.stringify({
      redeem_request_id: creditRedeemRequestId(
        resolveCodexChatgptAccountId(account.file) ?? account.name,
        credit.id
      ),
      credit_id: credit.id,
    }),
  });
  if (!isOk(result)) throw new Error(getApiCallErrorMessage(result));
  const code = parseCodexConsumeCode(result.body);
  if (!code) return { ok: false, messageKey: 'pools.reset_result.unknown' };
  if (code === 'reset' || code === 'already_redeemed') await clearCooldown(authIndex);
  return {
    ok: code === 'reset' || code === 'already_redeemed',
    messageKey: `pools.reset_result.${code}`,
  };
}

/**
 * Clears the gateway's own cooldown so routing resumes now instead of after it
 * expires. Best effort: the reset already happened upstream.
 */
async function clearCooldown(authIndex: string) {
  try {
    await authFilesApi.resetCooldown(authIndex);
  } catch {
    // The provider reset succeeded; the cooldown simply runs out on its own.
  }
}
