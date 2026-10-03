/**
 * Accounts and live usage for the pools page. Lists auth files every 30s and
 * re-reads each account's usage on its provider's cadence (Codex 5 min, Claude
 * 10 min) while the tab is visible. Stale responses from an older connection
 * are dropped.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getErrorMessage } from '@/utils/helpers';
import {
  compareAccounts,
  isUsageDue,
  toPoolAccount,
  type PoolAccount,
  type PoolMode,
  type UsageEntry,
} from './model';
import { providerFor } from './registry';
import type { ResetResult } from './usage';
import { writePoolMode } from './mode';

const LIST_POLL_MS = 30_000;
const SCHEDULER_TICK_MS = 15_000;

const EMPTY_ENTRY: UsageEntry = {
  usage: null,
  fetchedAt: null,
  attemptedAt: null,
  loading: false,
  error: null,
};

type ModeOverride = Pick<PoolAccount, 'mode' | 'disabled'>;

export function usePoolsData() {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [files, setFiles] = useState<AuthFileItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, UsageEntry>>({});
  const [overrides, setOverrides] = useState<Record<string, ModeOverride>>({});
  const [tick, setTick] = useState(0);
  const inFlight = useRef(new Set<string>());
  const listRequest = useRef(0);

  const loadFiles = useCallback(async () => {
    const request = ++listRequest.current;
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      request === listRequest.current && revision === apiClient.getConnectionRevision();
    try {
      const response = await authFilesApi.list();
      if (!current()) return;
      setFiles(response.files);
      setListError(null);
    } catch (error) {
      if (current()) setListError(getErrorMessage(error, 'Request failed'));
    }
  }, []);

  const accounts = useMemo(
    () =>
      (files ?? [])
        .flatMap((file) => {
          const account = toPoolAccount(file);
          if (!account) return [];
          const override = overrides[account.key];
          return [override ? { ...account, ...override } : account];
        })
        .sort(compareAccounts),
    [files, overrides]
  );

  const fetchAccount = useCallback(async (account: PoolAccount) => {
    const { fetchUsage } = providerFor(account.provider);
    if (!fetchUsage || !account.authIndex || inFlight.current.has(account.key)) return;
    inFlight.current.add(account.key);
    const revision = apiClient.getConnectionRevision();
    const attemptedAt = Date.now();
    setUsage((entries) => ({
      ...entries,
      [account.key]: { ...(entries[account.key] ?? EMPTY_ENTRY), loading: true, attemptedAt },
    }));
    try {
      const result = await fetchUsage(account);
      if (revision !== apiClient.getConnectionRevision()) return;
      setUsage((entries) => ({
        ...entries,
        [account.key]: {
          usage: result,
          fetchedAt: Date.now(),
          attemptedAt,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      if (revision !== apiClient.getConnectionRevision()) return;
      // Keep the last good reading on screen; the error explains why it is not newer.
      setUsage((entries) => ({
        ...entries,
        [account.key]: {
          ...(entries[account.key] ?? EMPTY_ENTRY),
          loading: false,
          error: getErrorMessage(error, 'Request failed'),
        },
      }));
    } finally {
      inFlight.current.delete(account.key);
    }
  }, []);

  // Account list: on connect, every 30s while visible, and whenever auth files change.
  useEffect(() => {
    if (!connected) return;
    void loadFiles();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadFiles();
    }, LIST_POLL_MS);
    const onChanged = () => void loadFiles();
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(AUTH_FILES_CHANGED_EVENT, onChanged);
    };
  }, [connected, loadFiles]);

  // Scheduler clock: paused while the tab is hidden, catches up when it returns.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setTick((value) => value + 1);
    }, SCHEDULER_TICK_MS);
    const onVisibility = () => {
      if (document.hidden) return;
      setTick((value) => value + 1);
      void loadFiles();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadFiles]);

  // Read every account whose provider interval has passed since its last attempt.
  useEffect(() => {
    if (!connected) return;
    const now = Date.now();
    for (const account of accounts) {
      const { pollMs } = providerFor(account.provider);
      if (pollMs !== null && isUsageDue(usage[account.key], pollMs, now)) {
        void fetchAccount(account);
      }
    }
  }, [accounts, usage, tick, connected, fetchAccount]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadFiles(), ...accounts.map((account) => fetchAccount(account))]);
  }, [accounts, fetchAccount, loadFiles]);

  /**
   * Optimistic switch: the row changes at once and falls back to the server's
   * state if either PATCH fails. On/Off also flip `disabled` so routing obeys now.
   */
  const setMode = useCallback(
    async (account: PoolAccount, mode: PoolMode): Promise<boolean> => {
      setOverrides((current) => ({
        ...current,
        [account.key]: {
          mode,
          disabled: mode === 'auto' ? account.disabled : mode === 'off',
        },
      }));
      try {
        const changed = await writePoolMode(account, mode);
        await loadFiles();
        return changed;
      } finally {
        setOverrides((current) => {
          const next = { ...current };
          delete next[account.key];
          return next;
        });
      }
    },
    [loadFiles]
  );

  const redeemReset = useCallback(
    async (account: PoolAccount): Promise<ResetResult | null> => {
      const { redeemReset: redeem } = providerFor(account.provider);
      if (!redeem) return null;
      const result = await redeem(account);
      if (result.ok) void fetchAccount(account);
      return result;
    },
    [fetchAccount]
  );

  return {
    accounts,
    usage,
    loaded: files !== null,
    listError,
    modeBusy: overrides,
    refreshAll,
    refreshAccount: fetchAccount,
    setMode,
    redeemReset,
  };
}
