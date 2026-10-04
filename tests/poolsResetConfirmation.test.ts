import { expect, test } from 'bun:test';
import { confirmPoolReset } from '@/features/pools/resetConfirmation';
import { toPoolAccount } from '@/features/pools/model';

for (const provider of ['claude', 'codex']) {
  test(`${provider} confirmation cannot send after the opening connection is replaced`, async () => {
    const account = toPoolAccount({ name: 'fixture.json', authIndex: 'fixture', provider })!;
    let calls = 0;
    const redeem = async () => {
      calls++;
      return { ok: true, messageKey: 'fixture' };
    };
    expect(
      await confirmPoolReset(account, 1, redeem, { revision: () => 2, connected: () => true })
    ).toBeNull();
    expect(
      await confirmPoolReset(account, 1, redeem, { revision: () => 1, connected: () => false })
    ).toBeNull();
    expect(calls).toBe(0);
    expect(
      await confirmPoolReset(account, 1, redeem, { revision: () => 1, connected: () => true })
    ).toEqual({ ok: true, messageKey: 'fixture' });
    expect(calls).toBe(1);
  });
}
