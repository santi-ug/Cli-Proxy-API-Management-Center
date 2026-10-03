import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import type { PoolAccount, PoolMode } from './model';

const dependencies = {
  patchFields: authFilesApi.patchFields,
  setStatus: authFilesApi.setStatus,
  revision: () => apiClient.getConnectionRevision(),
};

/** Compensate both writes on failure, including a timeout after the server applied one. */
export async function writePoolMode(account: PoolAccount, mode: PoolMode, deps = dependencies) {
  const revision = deps.revision();
  const current = () => revision === deps.revision();
  try {
    await deps.patchFields(account.name, { pool_mode: mode });
    if (!current()) return false;
    if (mode !== 'auto') {
      await deps.setStatus(account.name, mode === 'off', account.authIndex ?? undefined);
    }
    return current();
  } catch {
    if (!current()) return false;
    // Try each restoration even if the other one fails. A re-read exposes remaining drift.
    await Promise.allSettled([
      deps.patchFields(account.name, { pool_mode: account.mode }),
      deps.setStatus(account.name, account.disabled, account.authIndex ?? undefined),
    ]);
    return false;
  }
}
