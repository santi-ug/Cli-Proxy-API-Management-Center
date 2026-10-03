import { describe, expect, test } from 'bun:test';
import {
  parseClaudeRateLimitTier,
  parseClaudeUsage,
  parseCodexConsumeCode,
  parseCodexResetCredits,
  parseCodexUsage,
} from '@/features/pools/parsers';

const NOW = Date.parse('2026-10-03T14:00:00Z');

describe('parseClaudeUsage', () => {
  test('turns percent used into percent left and keeps model weeklies as their own window', () => {
    const windows = parseClaudeUsage({
      five_hour: { utilization: 66, resets_at: '2026-10-03T16:40:00Z' },
      seven_day: { utilization: 39, resets_at: '2026-10-06T13:00:00Z' },
      seven_day_opus: null,
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 52,
          resets_at: '2026-10-06T13:00:00Z',
          scope: { model: { display_name: 'Fable' } },
        },
        { kind: 'monthly_spend', percent: 10 },
      ],
    });
    expect(windows).toEqual([
      {
        id: 'five-hour',
        kind: 'five-hour',
        model: null,
        leftPercent: 34,
        resetAtMs: Date.parse('2026-10-03T16:40:00Z'),
      },
      {
        id: 'weekly',
        kind: 'weekly',
        model: null,
        leftPercent: 61,
        resetAtMs: Date.parse('2026-10-06T13:00:00Z'),
      },
      {
        id: 'weekly:fable',
        kind: 'model-weekly',
        model: 'Fable',
        leftPercent: 48,
        resetAtMs: Date.parse('2026-10-06T13:00:00Z'),
      },
    ]);
  });

  test('an unused 5-hour window has no reset time; over-limit values clamp to 0 left', () => {
    const windows = parseClaudeUsage({
      five_hour: { utilization: 0, resets_at: null },
      seven_day: { utilization: 104, resets_at: 'not a date' },
    });
    expect(windows?.map(({ leftPercent, resetAtMs }) => ({ leftPercent, resetAtMs }))).toEqual([
      { leftPercent: 100, resetAtMs: null },
      { leftPercent: 0, resetAtMs: null },
    ]);
  });

  test('prefers the active entry when one model is listed twice', () => {
    const windows = parseClaudeUsage({
      limits: [
        { kind: 'weekly_scoped', percent: 10, scope: { model: { display_name: 'Fable' } } },
        {
          kind: 'weekly_scoped',
          percent: 70,
          is_active: true,
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    });
    expect(windows?.map((entry) => entry.leftPercent)).toEqual([30]);
  });

  test('rejects bodies without a single readable window', () => {
    expect(parseClaudeUsage('rate limited')).toBeNull();
    expect(parseClaudeUsage({ five_hour: { utilization: 'high' } })).toBeNull();
  });
});

describe('parseClaudeRateLimitTier', () => {
  test('reads organization.rate_limit_tier', () => {
    expect(
      parseClaudeRateLimitTier({ organization: { rate_limit_tier: 'default_claude_max_5x' } })
    ).toBe('default_claude_max_5x');
    expect(parseClaudeRateLimitTier({ account: {} })).toBeNull();
  });
});

describe('parseCodexUsage', () => {
  test('classifies windows by duration, not position, and converts epoch seconds', () => {
    const usage = parseCodexUsage(
      {
        plan_type: 'Pro',
        rate_limit: {
          primary_window: { used_percent: 78, reset_at: 1759600800, limit_window_seconds: 604800 },
          secondary_window: { used_percent: 20, reset_at: 1759512600, limit_window_seconds: 18000 },
        },
      },
      NOW
    );
    expect(usage).toEqual({
      planCode: 'pro',
      windows: [
        {
          id: 'five-hour',
          kind: 'five-hour',
          model: null,
          leftPercent: 80,
          resetAtMs: 1759512600000,
        },
        { id: 'weekly', kind: 'weekly', model: null, leftPercent: 22, resetAtMs: 1759600800000 },
      ],
    });
  });

  test('falls back to primary = 5-hour, secondary = weekly and to reset_after_seconds', () => {
    const usage = parseCodexUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 0 },
          secondary_window: { used_percent: 10, reset_after_seconds: 3600 },
        },
      },
      NOW
    );
    expect(usage?.windows.map(({ id, resetAtMs }) => ({ id, resetAtMs }))).toEqual([
      { id: 'five-hour', resetAtMs: null },
      { id: 'weekly', resetAtMs: NOW + 3_600_000 },
    ]);
    expect(usage?.planCode).toBeNull();
  });

  test('a monthly allowance is labeled monthly, not 5-hour', () => {
    const usage = parseCodexUsage(
      {
        plan_type: 'free',
        rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 2592000 } },
      },
      NOW
    );
    expect(usage?.windows.map((entry) => entry.kind)).toEqual(['monthly']);
  });

  test('rejects bodies with neither windows nor a plan', () => {
    expect(parseCodexUsage({ rate_limit: null }, NOW)).toBeNull();
    expect(parseCodexUsage([], NOW)).toBeNull();
  });
});

describe('parseCodexResetCredits', () => {
  test('keeps available, unexpired Codex credits, soonest expiry first', () => {
    const credits = parseCodexResetCredits(
      {
        credits: [
          {
            id: 'late',
            status: 'available',
            reset_type: 'codex_rate_limits',
            expires_at: '2026-12-01T00:00:00Z',
          },
          {
            id: 'used',
            status: 'redeemed',
            reset_type: 'codex_rate_limits',
            expires_at: '2026-11-01T00:00:00Z',
          },
          {
            id: 'expired',
            status: 'available',
            reset_type: 'codex_rate_limits',
            expires_at: '2026-10-01T00:00:00Z',
          },
          {
            id: 'other',
            status: 'available',
            reset_type: 'image_limits',
            expires_at: '2026-11-01T00:00:00Z',
          },
          {
            id: 'soon',
            status: 'available',
            reset_type: 'codex_rate_limits',
            expires_at: '2026-10-20T00:00:00Z',
          },
        ],
      },
      NOW
    );
    expect(credits?.map((credit) => credit.id)).toEqual(['soon', 'late']);
  });

  test('null when the body is not a credits list, empty when it lists none', () => {
    expect(parseCodexResetCredits('<html>', NOW)).toBeNull();
    expect(parseCodexResetCredits({ credits: [] }, NOW)).toEqual([]);
  });
});

describe('parseCodexConsumeCode', () => {
  test('accepts only the documented outcomes', () => {
    expect(parseCodexConsumeCode({ code: 'reset' })).toBe('reset');
    expect(parseCodexConsumeCode({ code: 'already_redeemed' })).toBe('already_redeemed');
    expect(parseCodexConsumeCode({ code: 'maybe' })).toBeNull();
    expect(parseCodexConsumeCode('reset')).toBeNull();
  });
});
