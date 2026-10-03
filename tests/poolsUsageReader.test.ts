import { expect, test } from 'bun:test';
import { createUsageReader, fetchClaudeUsage } from '@/features/pools/usage';
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
