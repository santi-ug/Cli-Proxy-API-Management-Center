import { describe, expect, test } from 'bun:test';
import { writePoolMode } from '@/features/pools/mode';
import { POOL_MODES, toPoolAccount, type PoolMode } from '@/features/pools/model';

const account = toPoolAccount({
  name: 'fixture.json',
  authIndex: 'one',
  pool_mode: 'auto',
  disabled: false,
})!;

describe('atomic pool mode writes', () => {
  for (const mode of POOL_MODES) {
    test(`${mode} sends one mutation and lets the backend derive routing state`, async () => {
      const patches: unknown[] = [];
      expect(
        await writePoolMode(account, mode, {
          revision: () => 1,
          patchFields: async (name, fields) => {
            patches.push({ name, ...fields });
            return {};
          },
        })
      ).toBe(true);
      expect(patches).toEqual([{ name: account.name, pool_mode: mode }]);
    });
  }

  test('an applied mutation with a lost response is not rolled back', async () => {
    let remoteMode: PoolMode = 'auto';
    let writes = 0;
    const changed = await writePoolMode(account, 'off', {
      revision: () => 1,
      patchFields: async () => {
        writes++;
        remoteMode = 'off';
        throw new Error('lost response after apply');
      },
    });
    expect(changed).toBe(false);
    expect(writes).toBe(1);
    expect(remoteMode).toBe('off');
  });

  test('a delayed failure preserves a newer choice from another device', async () => {
    const response = Promise.withResolvers<Record<string, unknown>>();
    let remoteMode: PoolMode;
    let writes = 0;
    const pending = writePoolMode(account, 'off', {
      revision: () => 1,
      patchFields: () => {
        writes++;
        remoteMode = 'off';
        return response.promise;
      },
    });
    // Another device successfully changed the same account while our response was pending.
    remoteMode = 'on';
    response.reject(new Error('lost response'));
    expect(await pending).toBe(false);
    expect(writes).toBe(1);
    expect(remoteMode).toBe('on');
  });

  for (const failed of [false, true]) {
    test(`a stale ${failed ? 'failure' : 'success'} cannot act on a replacement connection`, async () => {
      const response = Promise.withResolvers<Record<string, unknown>>();
      let revision = 1;
      let writes = 0;
      const pending = writePoolMode(account, 'off', {
        revision: () => revision,
        patchFields: () => {
          writes++;
          return response.promise;
        },
      });
      revision++;
      if (failed) response.reject(new Error('old connection'));
      else response.resolve({});
      expect(await pending).toBe(false);
      expect(writes).toBe(1);
    });
  }
});
