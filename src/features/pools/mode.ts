import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import type { PoolAccount, PoolMode } from './model';

const dependencies = {
  patchFields: authFilesApi.patchFields,
  revision: () => apiClient.getConnectionRevision(),
};

/** The backend applies mode, disabled state and manual priority in one mutation.
 * A lost response may still mean success, so the caller re-reads instead of rolling back.
 */
export async function writePoolMode(account: PoolAccount, mode: PoolMode, deps = dependencies) {
  const revision = deps.revision();
  try {
    await deps.patchFields(account.name, { pool_mode: mode });
    return revision === deps.revision();
  } catch {
    return false;
  }
}
