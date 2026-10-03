import { describe, expect, test } from 'bun:test';
import { writePoolMode } from '@/features/pools/mode';
import { toPoolAccount } from '@/features/pools/model';

const account = toPoolAccount({
  name: 'fixture.json',
  authIndex: 'one',
  pool_mode: 'auto',
  disabled: false,
})!;

describe('pool mode compensation', () => {
  test('restores mode and disabled after the status write fails', async () => {
    const patches: unknown[] = [];
    const statuses: boolean[] = [];
    const changed = await writePoolMode(account, 'off', {
      revision: () => 1,
      patchFields: async (_name, fields) => {
        patches.push(fields);
        return {};
      },
      setStatus: async (_name, disabled) => {
        statuses.push(disabled);
        if (statuses.length === 1) throw new Error('lost status response');
        return { status: 'ok', disabled };
      },
    });
    expect(changed).toBe(false);
    expect(patches).toEqual([{ pool_mode: 'off' }, { pool_mode: 'auto' }]);
    expect(statuses).toEqual([true, false]);
  });
  test('still restores disabled when mode restoration fails', async () => {
    const statuses: boolean[] = [];
    let patches = 0;
    await writePoolMode(account, 'off', {
      revision: () => 1,
      patchFields: async () => {
        patches++;
        throw new Error('timeout');
      },
      setStatus: async (_name, disabled) => {
        statuses.push(disabled);
        return { status: 'ok', disabled };
      },
    });
    expect(patches).toBe(2);
    expect(statuses).toEqual([false]);
  });
  test('never restores old account values against a replacement connection', async () => {
    let revision = 1;
    let statuses = 0;
    await writePoolMode(account, 'off', {
      revision: () => revision,
      patchFields: async () => {
        revision++;
        throw new Error('disconnected');
      },
      setStatus: async () => {
        statuses++;
        return { status: 'ok' };
      },
    });
    expect(statuses).toBe(0);
  });
});
