import axios from 'axios';
import { computeApiUrl } from '@/utils/connection';
import { isRecord } from '@/utils/helpers';

export type KeylessProbeResult = 'granted' | 'denied' | 'unavailable';

/**
 * Asks the gateway for its config without a management key. A gateway that
 * trusts loopback (Tailscale Serve forwards from there) answers 200; any other
 * gateway answers 401/403 and the normal login flow applies.
 *
 * Uses plain axios on purpose: a 401 here must not fire the shared client's
 * `unauthorized` event, which would log out a stored key session.
 */
export async function probeKeylessAccess(apiBase: string): Promise<KeylessProbeResult> {
  const url = computeApiUrl(apiBase);
  if (!url) return 'unavailable';
  try {
    const response = await axios.get<unknown>(`${url}/config`, {
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    if (response.status === 401 || response.status === 403) return 'denied';
    return response.status >= 200 && response.status < 300 && isRecord(response.data)
      ? 'granted'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
