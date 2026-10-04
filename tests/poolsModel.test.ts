import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types';
import {
  accountStatus,
  isUsageDue,
  countdownParts,
  maskEmail,
  oldestFetch,
  parseViewMode,
  percentTone,
  pickNextRequest,
  splitDuration,
  summarizeProvider,
  toPoolAccount,
  usageColumns,
  type AccountUsage,
  type PoolAccount,
  type UsageEntry,
  type UsageWindow,
} from '@/features/pools/model';

import { planWeight, providerFor } from '@/features/pools/registry';

const MINUTE = 60_000;

const weightOf = (account: PoolAccount, usage: AccountUsage | null) =>
  planWeight(providerFor(account.provider), account.planOverride, usage?.planCode ?? null);

function account(file: Partial<AuthFileItem> & { name: string }): PoolAccount {
  const parsed = toPoolAccount({ provider: 'claude', ...file });
  if (!parsed) throw new Error('fixture must parse');
  return parsed;
}

const win = (id: string, leftPercent: number, model: string | null = null): UsageWindow => ({
  id,
  kind: model ? 'model-weekly' : id === 'five-hour' ? 'five-hour' : 'weekly',
  model,
  leftPercent,
  resetAtMs: null,
});

describe('toPoolAccount', () => {
  test('label preserves pool_label and masks email and filename fallbacks', () => {
    expect(
      account({ name: 'a.json', email: 'account@example.com', pool_label: 'Santi' }).label
    ).toBe('Santi');
    expect(account({ name: 'a.json', email: 'reserve@example.com' }).label).toBe('r•••@e•••.com');
    expect(account({ name: 'claude-work.json' }).label).toBe('•••');
  });

  test('missing or unknown pool fields degrade to safe defaults', () => {
    const parsed = account({ name: 'a.json', pool_mode: 'sometimes', pool_state: 'asleep' });
    expect(parsed.mode).toBe('auto');
    expect(parsed.state).toBeNull();
    expect(parsed.activeRequests).toBeNull();
    expect(parsed.planOverride).toBeNull();
  });

  test('reads every pool field the proxy may send', () => {
    const parsed = account({
      name: 'a.json',
      pool_mode: 'off',
      pool_state: 'needs-login',
      pool_role: 'Reserve',
      pool_note: 'Keeps 50% for Mom',
      pool_plan: 'Pro 20x ($200)',
      active_requests: 2,
      priority: 5,
    });
    expect(parsed).toMatchObject({
      mode: 'off',
      state: 'needs-login',
      role: 'Reserve',
      note: 'Keeps 50% for Mom',
      planOverride: 'Pro 20x ($200)',
      activeRequests: 2,
      priority: 5,
    });
  });

  test('rejects entries without a name and normalizes the provider key', () => {
    expect(toPoolAccount({ name: '  ' })).toBeNull();
    expect(account({ name: 'a.json', provider: 'Codex' }).provider).toBe('codex');
    expect(toPoolAccount({ name: 'a.json' })?.provider).toBe('unknown');
  });
});

describe('maskEmail', () => {
  test('keeps the first letter, the domain initial and the top-level domain', () => {
    expect(maskEmail('account@example.com')).toBe('a•••@e•••.com');
    expect(maskEmail('a@mail.example.co.uk')).toBe('a•••@m•••.uk');
  });

  test('hides anything that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('•••');
    expect(maskEmail('@example.com')).toBe('•••');
  });
});

describe('percentTone', () => {
  test('healthy from 60% left, yellow from 25%, red below', () => {
    expect(percentTone(100)).toBe('good');
    expect(percentTone(60)).toBe('good');
    expect(percentTone(59)).toBe('mid');
    expect(percentTone(25)).toBe('mid');
    expect(percentTone(24)).toBe('low');
    expect(percentTone(0)).toBe('low');
  });
});

describe('pickNextRequest', () => {
  test('skips disabled, unavailable and switched-off accounts, then takes the highest priority', () => {
    const accounts = [
      account({ name: 'a.json', priority: 9, disabled: true }),
      account({ name: 'b.json', priority: 8, unavailable: true }),
      account({ name: 'c.json', priority: 7, pool_mode: 'off' }),
      account({ name: 'd.json', priority: 1 }),
      account({ name: 'e.json', priority: 3 }),
    ];
    expect(pickNextRequest(accounts)?.name).toBe('e.json');
  });

  test('breaks priority ties by name and returns null when nothing is eligible', () => {
    expect(
      pickNextRequest([account({ name: 'zeta.json' }), account({ name: 'alpha.json' })])?.name
    ).toBe('alpha.json');
    expect(pickNextRequest([account({ name: 'a.json', disabled: true })])).toBeNull();
  });
});

describe('accountStatus', () => {
  test('a manual On/Off wins over the routing note', () => {
    expect(accountStatus(account({ name: 'a.json', pool_mode: 'off', pool_note: 'x' }))).toEqual({
      kind: 'mode',
      mode: 'off',
      tone: 'off',
    });
  });

  test('on Auto the note wins, colored by state', () => {
    expect(
      accountStatus(account({ name: 'a.json', pool_state: 'limited', pool_note: 'Weekly out' }))
    ).toEqual({ kind: 'note', text: 'Weekly out', tone: 'alert' });
  });

  test('without pool fields it falls back to the credential flags', () => {
    expect(accountStatus(account({ name: 'a.json', disabled: true }))).toMatchObject({
      state: 'disabled',
      tone: 'off',
    });
    expect(accountStatus(account({ name: 'a.json', unavailable: true }))).toMatchObject({
      state: 'unavailable',
      tone: 'alert',
    });
    expect(accountStatus(account({ name: 'a.json' }))).toMatchObject({
      state: 'ready',
      tone: 'on',
    });
  });
});

describe('usageColumns', () => {
  test('unions every account window in display order', () => {
    const santi: AccountUsage = {
      windows: [win('weekly:fable', 48, 'Fable'), win('weekly', 61), win('five-hour', 34)],
      planCode: null,
      bankedResets: 1,
    };
    const mom: AccountUsage = {
      windows: [
        win('weekly', 72),
        { ...win('monthly', 50), kind: 'monthly' },
        win('five-hour', 100),
      ],
      planCode: null,
      bankedResets: 0,
    };
    expect(usageColumns([mom, null, santi]).map((column) => column.id)).toEqual([
      'five-hour',
      'weekly',
      'weekly:fable',
      'monthly',
    ]);
  });
});

describe('summarizeProvider', () => {
  const santi = account({ name: 's.json', pool_label: 'Santi', priority: 2, active_requests: 1 });
  const mom = account({ name: 'm.json', pool_label: 'Mom', priority: 1, active_requests: 0 });
  const usage = new Map<string, AccountUsage>([
    [
      santi.key,
      {
        windows: [win('five-hour', 34.4), win('weekly', 61.4), win('weekly:fable', 48, 'Fable')],
        planCode: 'default_claude_max_5x',
        bankedResets: 1,
      },
    ],
    [
      mom.key,
      {
        windows: [win('five-hour', 100), win('weekly', 72.4)],
        planCode: 'default_claude_ai',
        bankedResets: 0,
      },
    ],
  ]);

  test('weights remaining capacity by tier, rounding only the combined result', () => {
    const summary = summarizeProvider(
      [santi, mom],
      (item) => usage.get(item.key) ?? null,
      weightOf
    );
    expect(summary.weekly).toEqual({
      leftPercent: 76,
      capacityPercent: 120,
      fillPercent: (61.4 * 5 + 72.4) / 6,
    });
    expect(summary.fiveHour).toEqual({
      leftPercent: 54,
      capacityPercent: 120,
      fillPercent: (34.4 * 5 + 100) / 6,
    });
    expect(summary.models).toEqual([
      {
        model: 'Fable',
        total: { leftPercent: 48, capacityPercent: 100, fillPercent: 48 },
        holders: ['Santi'],
        everyone: false,
      },
    ]);
    expect(summary.banked).toBe(1);
    expect(summary.next?.label).toBe('Santi');
    expect(summary.active).toBe(1);
  });

  test('says nothing about banked resets or activity when no account reports them', () => {
    const quiet = account({ name: 'q.json', pool_plan: 'Pro ($20)' });
    const summary = summarizeProvider(
      [quiet],
      () => ({
        windows: [win('weekly', 90)],
        planCode: null,
        bankedResets: null,
      }),
      weightOf
    );
    expect(summary.banked).toBeNull();
    expect(summary.active).toBeNull();
    expect(summary.fiveHour).toBeNull();
  });

  test('an account still loading prevents a misleading partial total', () => {
    const summary = summarizeProvider(
      [santi, mom],
      (item) => (item.key === santi.key ? (usage.get(item.key) ?? null) : null),
      weightOf
    );
    expect(summary.weekly).toBeNull();
    expect(summary.models).toEqual([]);
  });

  test.each([
    ['claude', 'Max 5x ($100)', 0, 100, 20],
    ['claude', 'Max 5x ($100)', 100, 0, 100],
    ['claude', 'Max 5x ($100)', 100, 100, 120],
    ['claude', 'Max 20x ($200)', 0, 100, 5],
    ['codex', 'Pro 20x ($200)', 0, 100, 5],
    ['codex', 'Pro 20x ($200)', 100, 0, 100],
    ['codex', 'Pro 20x ($200)', 100, 100, 105],
    ['codex', 'Pro 20x ($200)', 0, 0, 0],
  ])(
    '%s %s at %i%% plus a base plan at %i%% leaves %i%%',
    (provider, plan, primary, reserve, expected) => {
      const accounts = [
        account({ name: 'primary.json', provider, pool_plan: plan }),
        account({
          name: 'reserve.json',
          provider,
          pool_plan: provider === 'claude' ? 'Pro ($20)' : 'Plus ($20)',
        }),
      ];
      const summary = summarizeProvider(
        accounts,
        (item) => ({
          windows: [win('weekly', item === accounts[0] ? primary : reserve)],
          planCode: null,
          bankedResets: null,
        }),
        weightOf
      );
      expect(summary.weekly?.leftPercent).toBe(expected);
    }
  );

  test('identical full plans add to 200% and fill one complete bar', () => {
    const accounts = [
      account({ name: 'a.json', pool_plan: 'Max 5x ($100)' }),
      account({ name: 'b.json', pool_plan: 'Max 5x ($100)' }),
    ];
    const summary = summarizeProvider(
      accounts,
      () => ({
        windows: [win('weekly', 100)],
        planCode: null,
        bankedResets: null,
      }),
      weightOf
    );
    expect(summary.weekly).toEqual({ leftPercent: 200, capacityPercent: 200, fillPercent: 100 });
  });

  test('capacity does not depend on account order and the bar remains proportional', () => {
    const primary = account({ name: 'p.json', pool_plan: 'Max 5x ($100)' });
    const reserve = account({ name: 'r.json', pool_plan: 'Pro ($20)' });
    const summary = summarizeProvider(
      [reserve, primary],
      (item) => ({
        windows: [win('weekly', item === primary ? 74 : 51)],
        planCode: null,
        bankedResets: null,
      }),
      weightOf
    );
    expect(summary.weekly).toEqual({ leftPercent: 84, capacityPercent: 120, fillPercent: 421 / 6 });
  });

  test('a window only counts its holders and uses unrounded usage', () => {
    const primary = account({ name: 'p.json', provider: 'codex', pool_plan: 'Pro 20x ($200)' });
    const reserve = account({ name: 'r.json', provider: 'codex', pool_plan: 'Plus ($20)' });
    const summary = summarizeProvider(
      [primary, reserve],
      (item) => ({
        windows:
          item === primary ? [win('weekly', 95.49)] : [win('weekly', 100), win('five-hour', 80)],
        planCode: null,
        bankedResets: null,
      }),
      weightOf
    );
    expect(summary.weekly).toEqual({
      leftPercent: 100,
      capacityPercent: 105,
      fillPercent: (95.49 * 20 + 100) / 21,
    });
    expect(summary.fiveHour).toEqual({ leftPercent: 80, capacityPercent: 100, fillPercent: 80 });
  });

  test("an unknown holder's tier hides totals without inventing an equal weight", () => {
    const custom = account({ name: 'custom.json', pool_plan: 'Team ($30)' });
    const summary = summarizeProvider(
      [santi, custom],
      (item) =>
        item === santi
          ? (usage.get(santi.key) ?? null)
          : { windows: [win('weekly', 100)], planCode: 'unrecognized', bankedResets: 2 },
      weightOf
    );
    expect(summary.weekly).toBeNull();
    // Unknown capacity on a non-holder does not poison the primary's other windows.
    expect(summary.fiveHour).toEqual({ leftPercent: 34, capacityPercent: 100, fillPercent: 34.4 });
    expect(summary.models[0]?.total).toEqual({
      leftPercent: 48,
      capacityPercent: 100,
      fillPercent: 48,
    });
    expect(summary.banked).toBe(3);
  });
});

describe('time helpers', () => {
  test('splitDuration and countdownParts round down, never below one minute', () => {
    expect(splitDuration((2 * 24 * 60 + 4 * 60 + 59) * MINUTE)).toEqual({
      days: 2,
      hours: 4,
      minutes: 59,
    });
    expect(countdownParts((3 * 24 * 60 + 4 * 60 + 30) * MINUTE)).toEqual({
      kind: 'days_hours',
      days: 3,
      hours: 4,
    });
    expect(countdownParts(3 * 24 * 60 * MINUTE + 5)).toEqual({
      kind: 'days_hours',
      days: 3,
      hours: 0,
    });
    // 2 hr 47 min must not read as 3 hr, and the minutes show even at zero.
    expect(countdownParts((2 * 60 + 47) * MINUTE + 59_000)).toEqual({
      kind: 'hours_minutes',
      hours: 2,
      minutes: 47,
    });
    expect(countdownParts(3 * 60 * MINUTE)).toEqual({
      kind: 'hours_minutes',
      hours: 3,
      minutes: 0,
    });
    expect(countdownParts(10_000)).toEqual({ kind: 'minutes', minutes: 1 });
  });
});

describe('isUsageDue', () => {
  const entry = (overrides: Partial<UsageEntry>): UsageEntry => ({
    usage: null,
    fetchedAt: null,
    attemptedAt: null,
    loading: false,
    error: null,
    ...overrides,
  });

  test('reads new accounts, never doubles an in-flight read, and waits a full interval', () => {
    const now = 1_000_000_000;
    expect(isUsageDue(undefined, 10 * MINUTE, now)).toBe(true);
    expect(isUsageDue(entry({ loading: true }), 10 * MINUTE, now)).toBe(false);
    expect(isUsageDue(entry({ attemptedAt: now - 9 * MINUTE }), 10 * MINUTE, now)).toBe(false);
    expect(isUsageDue(entry({ attemptedAt: now - 10 * MINUTE }), 10 * MINUTE, now)).toBe(true);
  });

  test('a failed read also waits, so a broken account is not hammered', () => {
    const now = 1_000_000_000;
    expect(
      isUsageDue(entry({ attemptedAt: now - MINUTE, error: 'HTTP 429' }), 5 * MINUTE, now)
    ).toBe(false);
  });
});

describe('oldestFetch and parseViewMode', () => {
  test('reports the stalest successful read and ignores accounts never read', () => {
    expect(
      oldestFetch([
        undefined,
        { usage: null, fetchedAt: 500, attemptedAt: 500, loading: false, error: null },
        { usage: null, fetchedAt: 200, attemptedAt: 900, loading: false, error: 'x' },
        { usage: null, fetchedAt: null, attemptedAt: 100, loading: true, error: null },
      ])
    ).toBe(200);
    expect(oldestFetch([undefined])).toBeNull();
  });

  test('only a stored "compact" switches the view; anything else is Full', () => {
    expect(parseViewMode('compact')).toBe('compact');
    expect(parseViewMode('full')).toBe('full');
    expect(parseViewMode(null)).toBe('full');
    expect(parseViewMode('"compact"')).toBe('full');
  });
});
