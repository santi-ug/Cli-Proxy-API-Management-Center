import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountItem } from '@/features/pools/AccountItem';
import { providerFor } from '@/features/pools/registry';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { resetGrantOperations } from '@/features/quota/providers/claude/resetGrantOperations';
import { authFilesApi } from '@/services/api/authFiles';
import { expect, test } from 'bun:test';
import {
  createUsageReader,
  fetchClaudeUsage,
  redeemClaudeReset,
  redeemCodexReset,
  hasPendingClaudeReset,
} from '@/features/pools/usage';
import { toPoolAccount } from '@/features/pools/model';
import { apiCallApi } from '@/services/api/apiCall';
import { spyOn } from 'bun:test';

const account = toPoolAccount({
  name: 'fixture.json',
  authIndex: 'fixture-one',
  provider: 'claude',
})!;

test('deduplicates in-flight and repeated manual reads until the 60-second floor', async () => {
  let now = 0;
  let calls = 0;
  let revision = 1;
  const read = createUsageReader(
    async () => {
      calls++;
      return { windows: [], planCode: null, bankedResets: null };
    },
    () => now,
    () => revision
  );
  await Promise.all([read(account), read(account)]);
  now = 59_999;
  await read(account);
  expect(calls).toBe(1);
  now = 60_000;
  await read(account);
  expect(calls).toBe(2);
  revision++;
  await read(account);
  expect(calls).toBe(3);
});

test('Claude windows and grants come from the same cedar_ember request', async () => {
  const urls: string[] = [];
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (args) => {
    urls.push(args.url);
    return {
      statusCode: 200,
      header: {},
      bodyText: '',
      body: args.url.includes('/profile')
        ? { organization: { rate_limit_tier: 'default_claude_ai' } }
        : { five_hour: { utilization: 40 }, cedar_ember: { eligible: true, grants: [] } },
    };
  });
  try {
    const result = await fetchClaudeUsage(account);
    expect(result.windows[0].leftPercent).toBe(60);
    expect(result.bankedResets).toBe(0);
    expect(urls.filter((url) => url.includes('/usage'))).toEqual([
      'https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1',
    ]);
  } finally {
    request.mockRestore();
  }
});

test('confirmed Claude reset within the manual floor reads new allowance and remaining grants', async () => {
  const resetAccount = toPoolAccount({
    name: 'reset.json',
    authIndex: 'reset-fixture',
    provider: 'claude',
  })!;
  let spent = false;
  let usageReads = 0;
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (args) => {
    const profile = args.url.includes('/profile');
    if (!profile) usageReads++;
    return {
      statusCode: 200,
      header: {},
      bodyText: '',
      body: profile
        ? { organization: { rate_limit_tier: 'default_claude_ai' } }
        : {
            five_hour: { utilization: spent ? 0 : 100 },
            cedar_ember: {
              eligible: true,
              at_limit: !spent,
              grants: [
                {
                  id: 'reset_fixture',
                  resets_total: 1,
                  resets_left: spent ? 0 : 1,
                  usable_now: !spent,
                },
              ],
            },
          },
    };
  });
  const claim = spyOn(resetGrantOperations, 'run').mockImplementation(async () => {
    spent = true;
    return { code: 'reset', unresolved: false };
  });
  const cooldown = spyOn(authFilesApi, 'resetCooldown').mockResolvedValue({
    status: 'ok',
    auth_index: 'reset-fixture',
    models: [],
  });
  try {
    const before = await fetchClaudeUsage(resetAccount);
    expect(before.windows[0].leftPercent).toBe(0);
    expect(before.bankedResets).toBe(1);
    expect(await redeemClaudeReset(resetAccount)).toEqual({
      ok: true,
      messageKey: 'claude_reset.reset',
    });
    const after = await fetchClaudeUsage(resetAccount);
    expect(after.windows[0].leftPercent).toBe(100);
    expect(after.bankedResets).toBe(0);
    expect(usageReads).toBe(3);
    await fetchClaudeUsage(resetAccount);
    expect(usageReads).toBe(3);
  } finally {
    request.mockRestore();
    claim.mockRestore();
    cooldown.mockRestore();
  }
});

test('invalidation waits for an old in-flight read before allowing a post-reset read', async () => {
  let resolve: (value: { windows: []; planCode: null; bankedResets: number }) => void = () => {};
  let calls = 0;
  const read = createUsageReader(() => {
    calls++;
    return calls === 1
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve({ windows: [], planCode: null, bankedResets: 0 });
  });
  const old = read(account);
  const invalidating = read.invalidate(account);
  expect(read(account)).toBe(old);
  resolve({ windows: [], planCode: null, bankedResets: 1 });
  await invalidating;
  expect((await read(account)).bankedResets).toBe(0);
  expect(calls).toBe(2);
});

test('connection change during Codex credit lookup prevents consume and cooldown', async () => {
  let revision = 1;
  const revisionSpy = spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  const calls: string[] = [];
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (args) => {
    calls.push(args.method);
    revision++;
    return {
      statusCode: 200,
      header: {},
      bodyText: '',
      body: {
        credits: [
          {
            id: 'fixture-credit',
            status: 'available',
            reset_type: 'codex_rate_limits',
            granted_at: '2026-01-01',
            expires_at: '2099-01-01',
          },
        ],
      },
    };
  });
  const cooldown = spyOn(authFilesApi, 'resetCooldown').mockResolvedValue({
    status: 'ok',
    auth_index: 'fixture',
    models: [],
  });
  try {
    await expect(redeemCodexReset(account)).rejects.toThrow('Connection changed');
    expect(calls).toEqual(['GET']);
    expect(cooldown).not.toHaveBeenCalled();
  } finally {
    request.mockRestore();
    cooldown.mockRestore();
    revisionSpy.mockRestore();
  }
});

test('connection change during Codex consume prevents cooldown against replacement gateway', async () => {
  let revision = 1;
  const revisionSpy = spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (args) => {
    if (args.method === 'POST') revision++;
    return {
      statusCode: 200,
      header: {},
      bodyText: '',
      body:
        args.method === 'POST'
          ? { code: 'reset' }
          : {
              credits: [
                {
                  id: 'fixture-credit',
                  status: 'available',
                  reset_type: 'codex_rate_limits',
                  granted_at: '2026-01-01',
                  expires_at: '2099-01-01',
                },
              ],
            },
    };
  });
  const cooldown = spyOn(authFilesApi, 'resetCooldown').mockResolvedValue({
    status: 'ok',
    auth_index: 'fixture',
    models: [],
  });
  try {
    await expect(redeemCodexReset(account)).rejects.toThrow('Connection changed');
    expect(cooldown).not.toHaveBeenCalled();
  } finally {
    request.mockRestore();
    cooldown.mockRestore();
    revisionSpy.mockRestore();
  }
});

for (const outcome of [
  { code: 'not_limited', unresolved: false },
  { code: 'rate_limited', unresolved: true },
] as const) {
  test(`refused or ambiguous Claude reset ${outcome.code} keeps the manual floor`, async () => {
    const resetAccount = toPoolAccount({
      name: `${outcome.code}.json`,
      authIndex: outcome.code,
      provider: 'claude',
    })!;
    let usageReads = 0;
    const request = spyOn(apiCallApi, 'request').mockImplementation(async (args) => {
      const profile = args.url.includes('/profile');
      if (!profile) usageReads++;
      return {
        statusCode: 200,
        header: {},
        bodyText: '',
        body: profile
          ? { organization: { rate_limit_tier: 'default_claude_ai' } }
          : {
              five_hour: { utilization: 100 },
              cedar_ember: {
                eligible: true,
                at_limit: true,
                grants: [
                  { id: 'fixture-grant', resets_total: 1, resets_left: 1, usable_now: true },
                ],
              },
            },
      };
    });
    const claim = spyOn(resetGrantOperations, 'run').mockResolvedValue(outcome);
    try {
      const before = await fetchClaudeUsage(resetAccount);
      expect((await redeemClaudeReset(resetAccount)).ok).toBe(false);
      expect(await fetchClaudeUsage(resetAccount)).toBe(before);
      expect(usageReads).toBe(2);
    } finally {
      request.mockRestore();
      claim.mockRestore();
    }
  });
}

test('Pools retries an ambiguous committed Claude claim with its original request ID and exhausted grant', async () => {
  const resetAccount = toPoolAccount({
    name: 'ambiguous.json',
    authIndex: 'ambiguous-fixture',
    provider: 'claude',
  })!;
  let spent = 0;
  const requestIds: string[] = [];
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (args) => {
    let body: unknown;
    let statusCode = 200;
    if (args.method === 'POST') {
      const claim = JSON.parse(args.data!);
      requestIds.push(claim.request_id);
      if (requestIds.length === 1) {
        spent++;
        statusCode = 500;
        body = {};
      } else body = { result: 'already_used' };
    } else if (args.url.includes('/profile')) {
      body = {
        organization: {
          uuid: '11111111-2222-3333-4444-555555555555',
          rate_limit_tier: 'default_claude_ai',
        },
      };
    } else
      body = {
        five_hour: { utilization: spent ? 0 : 100 },
        cedar_ember: {
          eligible: true,
          at_limit: !spent,
          grants: [
            {
              id: 'ambiguous_grant',
              resets_total: 1,
              resets_left: spent ? 0 : 1,
              usable_now: !spent,
            },
          ],
        },
      };
    return { statusCode, header: {}, bodyText: '', body };
  });
  const cooldown = spyOn(authFilesApi, 'resetCooldown').mockResolvedValue({
    status: 'ok',
    auth_index: 'ambiguous-fixture',
    models: [],
  });
  try {
    expect(await redeemClaudeReset(resetAccount)).toEqual({
      ok: false,
      messageKey: 'claude_reset.unknown',
    });
    const usage = await fetchClaudeUsage(resetAccount);
    expect(usage.bankedResets).toBe(0);
    expect(hasPendingClaudeReset(resetAccount, Date.now())).toBe(true);
    const markup = renderToStaticMarkup(
      createElement(AccountItem, {
        account: resetAccount,
        provider: providerFor('claude'),
        columns: [],
        entry: {
          usage,
          fetchedAt: Date.now(),
          attemptedAt: Date.now(),
          loading: false,
          error: null,
        },
        now: Date.now(),
        modeBusy: false,
        onMode: () => {},
        onReset: () => {},
        onRefresh: () => {},
      })
    );
    expect(markup).toContain(`>${i18n.t('claude_reset.retry')}</button>`);
    expect(markup).not.toContain(`disabled="">${i18n.t('claude_reset.retry')}</button>`);
    expect(await redeemClaudeReset(resetAccount)).toEqual({
      ok: true,
      messageKey: 'claude_reset.already_used',
    });
    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    expect(spent).toBe(1);
    expect(hasPendingClaudeReset(resetAccount, Date.now())).toBe(false);
  } finally {
    request.mockRestore();
    cooldown.mockRestore();
  }
});

test('a failed refresh keeps last usage visible and marks expired reset times unknown', () => {
  const now = Date.now();
  const markup = renderToStaticMarkup(
    createElement(AccountItem, {
      account,
      provider: providerFor('claude'),
      columns: [{ id: 'five-hour', kind: 'five-hour', model: null }],
      entry: {
        usage: {
          windows: [
            {
              id: 'five-hour',
              kind: 'five-hour',
              model: null,
              leftPercent: 61,
              resetAtMs: now - 1000,
            },
          ],
          planCode: null,
          bankedResets: 0,
        },
        fetchedAt: now - 600000,
        attemptedAt: now,
        loading: false,
        error: '401',
      },
      now,
      modeBusy: false,
      onMode: () => {},
      onReset: () => {},
      onRefresh: () => {},
    })
  );
  expect(markup).toContain(i18n.t('pools.stale_usage'));
  expect(markup).toContain(i18n.t('pools.left', { percent: 61 }));
  expect(markup).toContain(i18n.t('pools.reset_unknown'));
  expect(markup).not.toContain(i18n.t('pools.no_reset_pending'));
});
