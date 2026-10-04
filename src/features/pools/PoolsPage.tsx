/**
 * Account pools: every account's 5-hour and weekly limits on one always-dark
 * page. Full shows rows on wide screens and cards below 700px; Compact shows
 * cards at any width and keeps only the bars, for screenshots.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useDrawerStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import {
  VIEW_MODES,
  oldestFetch,
  parseViewMode,
  summarizeProvider,
  usageColumns,
  type PoolAccount,
  type PoolMode,
  type UsageEntry,
  type ViewMode,
} from './model';
import { accentStyle, compareProviders, providerFor, type PoolProvider } from './registry';
import { AccountItem } from './AccountItem';
import { useWindowLabel } from './useWindowLabel';
import { usePoolsData } from './usePoolsData';
import styles from './PoolsPage.module.scss';
import { apiClient } from '@/services/api/client';
import { hasPendingClaudeReset } from './usage';
import { confirmPoolReset } from './resetConfirmation';

const VIEW_STORAGE_KEY = 'cli-proxy-pools-view';

function useViewMode() {
  const [view, setView] = useState<ViewMode>(() => {
    try {
      return parseViewMode(window.localStorage.getItem(VIEW_STORAGE_KEY));
    } catch {
      return 'full';
    }
  });
  const choose = useCallback((next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies now.
    }
  }, []);
  return [view, choose] as const;
}

interface ProviderGroup {
  provider: PoolProvider;
  accounts: PoolAccount[];
}

function ProviderTotals({
  group,
  usage,
}: {
  group: ProviderGroup;
  usage: Record<string, UsageEntry>;
}) {
  const { t } = useTranslation();
  const windowLabel = useWindowLabel();
  const { provider, accounts } = group;
  const summary = summarizeProvider(accounts, (account) => usage[account.key]?.usage ?? null);
  const { Glyph } = provider;

  return (
    <div className={styles.prov} style={accentStyle(provider)}>
      <div className={styles.pname}>
        <b>
          <span className={styles.tile} style={{ background: provider.tile }} aria-hidden="true">
            <Glyph size={18} />
          </span>
          {provider.label}
        </b>
        <span>{t('pools.accounts_count', { count: accounts.length })}</span>
      </div>
      {summary.weekly ? (
        <div className={styles.pct}>
          {summary.weekly.left}
          <small>%</small>
          <span>{t('pools.of_capacity', { capacity: summary.weekly.capacity })}</span>
        </div>
      ) : (
        <div className={`${styles.pct} ${styles.pctPending}`}>
          {provider.fetchUsage ? t('pools.loading_quota') : t('pools.no_usage_source')}
        </div>
      )}
      <div className={styles.wl}>
        {summary.models.length > 0 ? t('pools.weekly_all_models') : t('pools.window_weekly')}
      </div>
      <div className={styles.segs} aria-hidden="true">
        {summary.weeklySegments.map((left, index) => (
          <span key={accounts[index].key} className={styles.seg}>
            <i style={{ width: `${left ?? 0}%` }} />
          </span>
        ))}
      </div>
      <div className={styles.subs}>
        {summary.fiveHour ? (
          <div className={styles.sub}>
            <span>{t('pools.window_five_hour')}</span>
            <span>
              <b>{summary.fiveHour.left}%</b>{' '}
              {t('pools.of_capacity', { capacity: summary.fiveHour.capacity })}
            </span>
          </div>
        ) : null}
        {summary.models.map((model) => (
          <div key={model.model} className={styles.sub}>
            <span>
              {windowLabel({ kind: 'model-weekly', model: model.model })}
              {model.everyone
                ? null
                : ` · ${t('pools.only_holders', { names: model.holders.join(', ') })}`}
            </span>
            <span>
              <b>{model.total.left}%</b>{' '}
              {t('pools.of_capacity', { capacity: model.total.capacity })}
            </span>
          </div>
        ))}
        {summary.banked !== null ? (
          <div className={styles.sub}>
            <span>{t('pools.banked_resets')}</span>
            <span>
              <b>{summary.banked}</b> {t('pools.available')}
            </span>
          </div>
        ) : null}
      </div>
      <div className={styles.pfoot}>
        <span>
          {t('pools.next_request')} <b>{summary.next?.label ?? t('pools.next_none')}</b>
        </span>
        {summary.active !== null ? (
          <span>
            <b>{summary.active}</b> {t('pools.active')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PanelIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6 3v10" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
    </svg>
  );
}

export function PoolsPage() {
  const { t } = useTranslation();
  const now = useNow();
  const keyless = useAuthStore((state) => state.keyless);
  const drawerOpen = useDrawerStore((state) => state.open);
  const openDrawer = useDrawerStore((state) => state.openDrawer);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const {
    accounts,
    usage,
    loaded,
    listError,
    modeBusy,
    refreshAll,
    refreshAccount,
    setMode,
    redeemReset,
  } = usePoolsData();
  const [view, setView] = useViewMode();
  const [filter, setFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const groups = useMemo<ProviderGroup[]>(() => {
    const byProvider = new Map<string, PoolAccount[]>();
    for (const account of accounts) {
      byProvider.set(account.provider, [...(byProvider.get(account.provider) ?? []), account]);
    }
    return [...byProvider.entries()]
      .sort(([a], [b]) => compareProviders(a, b))
      .map(([id, list]) => ({ provider: providerFor(id), accounts: list }));
  }, [accounts]);

  // Compact has no chips, so a filter picked in Full must not keep hiding sections there.
  const activeFilter =
    view === 'full' && groups.some((group) => group.provider.id === filter) ? filter : 'all';
  const visibleGroups =
    activeFilter === 'all' ? groups : groups.filter((group) => group.provider.id === activeFilter);

  const updatedAt = oldestFetch(accounts.map((account) => usage[account.key]));
  const minutesAgo =
    updatedAt === null ? null : Math.max(0, Math.floor((now - updatedAt) / 60_000));

  const handleRefreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const handleMode = useCallback(
    async (account: PoolAccount, mode: PoolMode) => {
      if (!(await setMode(account, mode))) {
        showNotification(t('pools.mode_failed', { name: account.label }), 'error');
      }
    },
    [setMode, showNotification, t]
  );

  const handleReset = useCallback(
    (account: PoolAccount) => {
      const openedRevision = apiClient.getConnectionRevision();
      const pending = hasPendingClaudeReset(account, Date.now());
      showConfirmation({
        title: t('pools.reset_confirm_title'),
        message: t(pending ? 'claude_reset.retry_confirm' : 'pools.reset_confirm_message', {
          name: account.label,
        }),
        confirmText: t(pending ? 'claude_reset.retry' : 'pools.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          try {
            const result = await confirmPoolReset(account, openedRevision, redeemReset);
            if (result) showNotification(t(result.messageKey), result.ok ? 'success' : 'error');
          } catch (error) {
            showNotification(
              t('pools.reset_failed', {
                message: getErrorMessage(error, t('common.unknown_error')),
              }),
              'error'
            );
          }
        },
      });
    },
    [redeemReset, showConfirmation, showNotification, t]
  );

  const handleRefresh = useCallback(
    (account: PoolAccount) => void refreshAccount(account),
    [refreshAccount]
  );

  const full = view === 'full';

  return (
    <div className={styles.frame}>
      <div className={styles.page} data-view={view}>
        <header className={styles.hd}>
          <div className={styles.hl}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={(event) => openDrawer(event.currentTarget)}
              aria-label={t('sidebar.open_menu')}
              aria-expanded={drawerOpen}
              aria-controls="app-drawer"
              aria-keyshortcuts="Meta+B Control+B"
            >
              <PanelIcon />
            </button>
            <h1 className={styles.title}>{t('pools.title')}</h1>
          </div>
          <div className={styles.hr}>
            {full && minutesAgo !== null ? (
              <span className={styles.upd}>
                {minutesAgo === 0
                  ? t('pools.updated_just_now')
                  : t('pools.updated_minutes', { count: minutesAgo })}
              </span>
            ) : null}
            <div className={styles.view} role="group" aria-label={t('pools.density')}>
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                >
                  {t(`pools.view_${mode}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`${styles.iconBtn} ${refreshing ? styles.spinning : ''}`}
              onClick={handleRefreshAll}
              aria-label={t('pools.refresh_all')}
              aria-busy={refreshing}
            >
              <RefreshIcon />
            </button>
          </div>
        </header>

        {full ? (
          <div className={styles.status}>
            <span>
              {listError && !loaded ? (
                <>
                  <b>{t('pools.gateway_unreachable')}</b> · {listError}
                </>
              ) : loaded ? (
                <>
                  <b>{t('pools.gateway_ready')}</b>
                  {keyless ? ` · ${t('pools.tailnet_only')}` : null}
                </>
              ) : (
                t('pools.loading_accounts')
              )}
            </span>
            <span>
              {groups
                .map((group) =>
                  t('pools.provider_count', {
                    count: group.accounts.length,
                    provider: group.provider.label,
                  })
                )
                .join(' · ')}
            </span>
          </div>
        ) : null}

        {full && groups.length > 0 ? (
          <div className={styles.provs}>
            {visibleGroups.map((group) => (
              <ProviderTotals key={group.provider.id} group={group} usage={usage} />
            ))}
          </div>
        ) : null}

        {full && groups.length > 0 ? (
          <div className={styles.filters}>
            <div className={styles.chips} role="group" aria-label={t('pools.filters')}>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={activeFilter === 'all'}
                onClick={() => setFilter('all')}
              >
                {t('pools.all_pools')}
              </button>
              {groups.map(({ provider }) => (
                <button
                  key={provider.id}
                  type="button"
                  className={styles.chip}
                  style={accentStyle(provider)}
                  aria-pressed={activeFilter === provider.id}
                  onClick={() => setFilter(provider.id)}
                >
                  <i aria-hidden="true" />
                  {provider.label}
                </button>
              ))}
            </div>
            <span>{t('pools.allowance_remaining')}</span>
          </div>
        ) : null}

        {loaded && accounts.length === 0 ? (
          <div className={styles.empty}>
            <b>{t('pools.empty')}</b>
            <span>{t('pools.empty_hint')}</span>
          </div>
        ) : null}

        {visibleGroups.map((group) => {
          const columns = usageColumns(
            group.accounts.map((account) => usage[account.key]?.usage ?? null)
          );
          const headingId = `pool-${group.provider.id}`;
          return (
            <section key={group.provider.id} aria-labelledby={headingId}>
              <h2
                id={headingId}
                className={styles.sectionTitle}
                style={accentStyle(group.provider)}
              >
                <i aria-hidden="true" />
                {group.provider.label}
              </h2>
              <div className={styles.list}>
                {group.accounts.map((account) => (
                  <AccountItem
                    key={account.key}
                    account={account}
                    provider={group.provider}
                    columns={columns}
                    entry={usage[account.key]}
                    now={now}
                    modeBusy={Boolean(modeBusy[account.key])}
                    onMode={handleMode}
                    onReset={handleReset}
                    onRefresh={handleRefresh}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
