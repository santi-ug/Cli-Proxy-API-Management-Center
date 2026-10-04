import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import i18n from '@/i18n';
import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';
import { formatResetClock, formatDuration, formatResetIn } from '@/features/pools/format';
import { compareProviders, planLabel, planWeight, providerFor } from '@/features/pools/registry';
import { countClaudeBankedResets, creditRedeemRequestId } from '@/features/pools/usage';

describe('plan lookup', () => {
  const claude = providerFor('claude');
  const codex = providerFor('codex');

  test('maps Claude rate-limit tiers and Codex plan types to plan names with prices', () => {
    expect(planLabel(claude, null, 'default_claude_max_5x')).toBe('Max 5x ($100)');
    expect(planLabel(claude, null, 'default_claude_max_20x')).toBe('Max 20x ($200)');
    expect(planLabel(claude, null, 'default_claude_ai')).toBe('Pro ($20)');
    expect(planLabel(codex, null, 'plus')).toBe('Plus ($20)');
    expect(planLabel(codex, null, 'pro')).toBe('Pro 20x ($200)');
  });

  test('an unknown code shows raw, pool_plan always wins, and no data shows nothing', () => {
    expect(planLabel(codex, null, 'pro_500')).toBe('pro_500');
    expect(planLabel(codex, 'Team ($30)', 'plus')).toBe('Team ($30)');
    expect(planLabel(claude, null, null)).toBeNull();
  });

  test('plans are scoped per provider', () => {
    expect(planLabel(claude, null, 'plus')).toBe('plus');
  });

  test('capacity follows the advertised multiplier rather than the dollar price', () => {
    expect(planWeight(claude, null, 'default_claude_max_5x')).toBe(5);
    expect(planWeight(claude, null, 'default_claude_max_20x')).toBe(20);
    expect(planWeight(claude, null, 'default_claude_ai')).toBe(1);
    expect(planWeight(codex, null, 'pro')).toBe(20);
    expect(planWeight(codex, null, 'plus')).toBe(1);
  });

  test('the reported tier beats a stale label; a known label covers a failed tier read', () => {
    expect(planWeight(claude, 'Pro ($20)', 'default_claude_max_5x')).toBe(5);
    expect(planWeight(claude, 'Max 5x ($100)', null)).toBe(5);
    expect(planWeight(codex, 'Pro 20x ($200)', null)).toBe(20);
  });

  test("unrecognized tiers, custom labels and another provider's plans stay unknown", () => {
    expect(planWeight(codex, 'Plus ($20)', 'pro_500')).toBeNull();
    expect(planWeight(claude, 'Team ($30)', null)).toBeNull();
    expect(planWeight(claude, 'Plus ($20)', null)).toBeNull();
    expect(planWeight(codex, null, null)).toBeNull();
  });
});

describe('provider registry', () => {
  test('unknown providers render read-only: no polling, no reads, no resets', () => {
    const kimi = providerFor('kimi');
    expect(kimi.label).toBe('Kimi');
    expect(kimi.pollMs).toBeNull();
    expect(kimi.fetchUsage).toBeNull();
    expect(kimi.redeemReset).toBeNull();
  });

  test('sections list known providers in registry order, then the rest by name', () => {
    expect(['zed', 'codex', 'antigravity', 'claude'].sort(compareProviders)).toEqual([
      'claude',
      'codex',
      'antigravity',
      'zed',
    ]);
  });
});

/** T3 Code's Node implementation, copied verbatim, as the reference. */
function t3CreditRedeemRequestId(accountId: string, creditId: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from('6f1c2a9e2d4b4c1e9a7f3b8d5e0c1a42', 'hex'))
    .update(`${accountId}:${creditId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('creditRedeemRequestId', () => {
  test('matches T3 Code byte for byte, so both clients dedupe the same redemption', () => {
    for (const [accountId, creditId] of [
      ['acct_123', 'credit_abc'],
      ['8f2b6c1e-0000-4000-8000-1234567890ab', 'rlrc_ünicode'],
    ]) {
      expect(creditRedeemRequestId(accountId, creditId)).toBe(
        t3CreditRedeemRequestId(accountId, creditId)
      );
    }
  });

  test('differs per credit', () => {
    expect(creditRedeemRequestId('a', '1')).not.toBe(creditRedeemRequestId('a', '2'));
  });
});

describe('countClaudeBankedResets', () => {
  const NOW = Date.parse('2026-10-03T14:00:00Z');
  const grant = (overrides: Partial<AnthropicResetGrant>): AnthropicResetGrant => ({
    id: 'g',
    label: '',
    resetsTotal: 3,
    resetsLeft: 1,
    startsAt: null,
    endsAt: null,
    clears: ['five_hour'],
    paused: false,
    usableNow: true,
    useRequiresLimit: true,
    percentUsed: {},
    ...overrides,
  });
  const status = (grants: AnthropicResetGrant[], eligible = true) => ({
    eligible,
    ineligibleReason: null,
    atLimit: false,
    grants,
    nextGrantId: null,
    weeklyResetsAt: null,
    cooldownUntil: null,
  });

  test('counts resets left on grants that are live now', () => {
    expect(
      countClaudeBankedResets(
        status([
          grant({ resetsLeft: 1 }),
          grant({ resetsLeft: 2, paused: true }),
          grant({ resetsLeft: 4, endsAt: '2026-10-01T00:00:00Z' }),
          grant({ resetsLeft: 8, startsAt: '2026-11-01T00:00:00Z' }),
          grant({ resetsLeft: 16, endsAt: '2026-10-09T00:00:00Z' }),
        ]),
        NOW
      )
    ).toBe(17);
  });

  test('an ineligible account has none', () => {
    expect(countClaudeBankedResets(status([grant({ resetsLeft: 2 })], false), NOW)).toBe(0);
  });
});

describe('reset time text', () => {
  // Other suites read whatever language is active; leave it as found.
  const previous = i18n.language;
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage(previous);
  });

  test('clock shows the time today and the date plus time on other days', () => {
    const now = new Date(2026, 9, 3, 14, 0).getTime();
    expect(formatResetClock(new Date(2026, 9, 3, 16, 40).getTime(), now, 'en-US')).toBe('16:40');
    expect(formatResetClock(new Date(2026, 9, 6, 13, 0).getTime(), now, 'en-US')).toBe(
      '10/06, 13:00'
    );
  });

  test('relative and footer durations always show the second unit', () => {
    const now = 0;
    const t = i18n.t.bind(i18n);
    expect(formatResetIn(t, 2 * 3_600_000 + 20 * 60_000, now)).toBe('in 2 hr 20 min');
    expect(formatResetIn(t, (6 * 24 + 4) * 3_600_000 + 59 * 60_000, now)).toBe('in 6 d 4 hr');
    expect(formatResetIn(t, 45 * 60_000, now)).toBe('in 45 min');
    expect(formatDuration(t, (2 * 24 + 4) * 3_600_000)).toBe('2 d 4 hr');
    expect(formatDuration(t, 3 * 24 * 3_600_000)).toBe('3 d 0 hr');
    expect(formatDuration(t, 7 * 3_600_000 + 12 * 60_000)).toBe('7 hr 12 min');
    expect(formatDuration(t, 30_000)).toBe('1 min');
  });
});
