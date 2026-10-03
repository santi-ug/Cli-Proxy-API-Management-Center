/**
 * Typed readers for the provider responses the pools page relies on. Each one
 * accepts `unknown` (the api-call body) and drops anything it cannot vouch for.
 * Pure: tests/poolsParsers.test.ts feeds them recorded shapes.
 */

import { isRecord } from '@/utils/helpers';
import { normalizeCodexResetCreditsPayload } from '@/utils/quota/resetCredits';
import { clampPercent, modelWindowId, orderWindows, type UsageWindow } from './model';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const isoMs = (value: unknown): number | null => {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
};

// ---------------------------------------------------------------------------
// Claude: GET https://api.anthropic.com/api/oauth/usage

/**
 * `five_hour` / `seven_day` carry `utilization` as percent used. Model-specific
 * weeklies arrive in `limits[]` as `weekly_scoped` with a model display name.
 */
export function parseClaudeUsage(body: unknown): UsageWindow[] | null {
  if (!isRecord(body)) return null;
  const windows: UsageWindow[] = [];

  const named = [
    ['five_hour', 'five-hour'],
    ['seven_day', 'weekly'],
  ] as const;
  for (const [key, kind] of named) {
    const window = body[key];
    if (!isRecord(window)) continue;
    const used = finite(window.utilization);
    if (used === null) continue;
    windows.push({
      id: kind,
      kind,
      model: null,
      leftPercent: clampPercent(100 - used),
      resetAtMs: isoMs(window.resets_at),
    });
  }

  const scoped = new Map<string, { window: UsageWindow; active: boolean }>();
  for (const limit of Array.isArray(body.limits) ? body.limits : []) {
    if (!isRecord(limit) || limit.kind !== 'weekly_scoped') continue;
    const scope = isRecord(limit.scope) ? limit.scope : null;
    const model = scope && isRecord(scope.model) ? text(scope.model.display_name) : null;
    const used = finite(limit.percent);
    if (!model || used === null) continue;
    const id = modelWindowId(model);
    const active = limit.is_active === true;
    // Duplicate entries for one model: the active one wins, then the first seen.
    if (scoped.has(id) && (scoped.get(id)?.active || !active)) continue;
    scoped.set(id, {
      active,
      window: {
        id,
        kind: 'model-weekly',
        model,
        leftPercent: clampPercent(100 - used),
        resetAtMs: isoMs(limit.resets_at),
      },
    });
  }
  windows.push(...[...scoped.values()].map((entry) => entry.window));

  return windows.length > 0 ? orderWindows(windows) : null;
}

/**
 * GET https://api.anthropic.com/api/oauth/profile → `organization.rate_limit_tier`,
 * e.g. `default_claude_max_5x`. Field name follows the upstream profile type; not
 * yet confirmed against a live response.
 */
export function parseClaudeRateLimitTier(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.organization)) return null;
  return text(body.organization.rate_limit_tier);
}

// ---------------------------------------------------------------------------
// Codex: GET https://chatgpt.com/backend-api/wham/usage

const SIX_HOURS_S = 6 * 3600;
const MONTH_S = 28 * 24 * 3600;

function codexWindow(
  value: unknown,
  fallback: 'five-hour' | 'weekly',
  now: number
): UsageWindow | null {
  if (!isRecord(value)) return null;
  const used = finite(value.used_percent);
  if (used === null) return null;
  const seconds = finite(value.limit_window_seconds);
  const kind =
    seconds === null
      ? fallback
      : seconds <= SIX_HOURS_S
        ? 'five-hour'
        : seconds >= MONTH_S
          ? 'monthly'
          : 'weekly';
  const resetAt = finite(value.reset_at);
  const resetAfter = finite(value.reset_after_seconds);
  return {
    id: kind,
    kind,
    model: null,
    leftPercent: clampPercent(100 - used),
    resetAtMs:
      resetAt !== null && resetAt > 0
        ? resetAt * 1000
        : resetAfter !== null
          ? now + resetAfter * 1000
          : null,
  };
}

export interface CodexUsage {
  windows: UsageWindow[];
  planCode: string | null;
}

/**
 * `primary_window` / `secondary_window` are positions, not durations: classify by
 * `limit_window_seconds` and fall back to 5-hour then weekly when it is missing.
 */
export function parseCodexUsage(body: unknown, now: number): CodexUsage | null {
  if (!isRecord(body)) return null;
  const rateLimit = isRecord(body.rate_limit) ? body.rate_limit : null;
  const windows = [
    codexWindow(rateLimit?.primary_window, 'five-hour', now),
    codexWindow(rateLimit?.secondary_window, 'weekly', now),
  ].filter((window): window is UsageWindow => window !== null);
  // Two windows of the same kind would collide on one column; keep the first.
  const unique = windows.filter(
    (window, index) => windows.findIndex((other) => other.id === window.id) === index
  );
  const planCode = text(body.plan_type)?.toLowerCase() ?? null;
  if (unique.length === 0 && !planCode) return null;
  return { windows: orderWindows(unique), planCode };
}

export interface CodexResetCredit {
  id: string;
  expiresAtMs: number;
}

/**
 * GET .../wham/rate-limit-reset-credits → usable credits, soonest expiry first.
 * Returns null when the payload is not a credits list at all.
 */
export function parseCodexResetCredits(body: unknown, now: number): CodexResetCredit[] | null {
  const summary = normalizeCodexResetCreditsPayload(body);
  if (summary.invalidPayload) return null;
  return summary.credits
    .flatMap((credit) => {
      const expiresAtMs = Date.parse(credit.expiresAt);
      return credit.id && !Number.isNaN(expiresAtMs) && expiresAtMs > now
        ? [{ id: credit.id, expiresAtMs }]
        : [];
    })
    .sort((a, b) => a.expiresAtMs - b.expiresAtMs);
}

export const CODEX_CONSUME_CODES = [
  'reset',
  'nothing_to_reset',
  'no_credit',
  'already_redeemed',
] as const;
export type CodexConsumeCode = (typeof CODEX_CONSUME_CODES)[number];

/** POST .../rate-limit-reset-credits/consume → `{ code }`. */
export function parseCodexConsumeCode(body: unknown): CodexConsumeCode | null {
  if (!isRecord(body)) return null;
  return CODEX_CONSUME_CODES.find((known) => known === body.code) ?? null;
}
