import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import type { PoolAccount } from './model';
import type { ResetResult } from './usage';

const dependencies = {
  revision: () => apiClient.getConnectionRevision(),
  connected: () => useAuthStore.getState().connectionStatus === 'connected',
};

/** The connection that opened the confirmation owns the reset. */
export async function confirmPoolReset(
  account: PoolAccount,
  openedRevision: number,
  redeem: (account: PoolAccount) => Promise<ResetResult | null>,
  deps = dependencies
) {
  if (openedRevision !== deps.revision() || !deps.connected()) return null;
  return redeem(account);
}
