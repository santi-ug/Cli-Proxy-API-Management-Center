import { useSyncExternalStore } from 'react';
import { resetGrantOperations } from '@/features/quota/providers/claude/resetGrantOperations';
import { hasPendingClaudeReset } from './usage';
import { useTranslation } from 'react-i18next';
import {
  POOL_MODES,
  accountStatus,
  maskEmail,
  percentTone,
  type PoolAccount,
  type PoolMode,
  type UsageColumn,
  type UsageEntry,
  type UsageWindow,
} from './model';
import { accentStyle, planLabel, type PoolProvider } from './registry';
import { useWindowLabel } from './useWindowLabel';
import { formatDuration, formatResetClock, formatResetIn } from './format';
import styles from './PoolsPage.module.scss';

const TONE_CLASS = { good: styles.good, mid: styles.mid, low: styles.low } as const;
const DOT_CLASS = { on: '', off: styles.dotOff, alert: styles.dotAlert } as const;

interface MeterProps {
  label: string;
  window: UsageWindow;
  stale: boolean;
  now: number;
}

function Meter({ label, window, now, stale }: MeterProps) {
  const { t, i18n } = useTranslation();
  const left = Math.round(window.leftPercent);
  return (
    <div className={styles.m}>
      <div className={styles.t}>
        {label}{' '}
        <b className={TONE_CLASS[percentTone(left)]}>{t('pools.left', { percent: left })}</b>
      </div>
      <div className={styles.track} aria-hidden="true">
        <i style={{ width: `${left}%` }} />
      </div>
      <div className={styles.r}>
        {window.resetAtMs !== null && window.resetAtMs > now ? (
          <>
            <b>{formatResetIn(t, window.resetAtMs, now)}</b> ·{' '}
            {formatResetClock(window.resetAtMs, now, i18n.resolvedLanguage)}
          </>
        ) : (
          t(stale ? 'pools.reset_unknown' : 'pools.no_reset_pending')
        )}
      </div>
    </div>
  );
}

interface AccountItemProps {
  account: PoolAccount;
  provider: PoolProvider;
  columns: UsageColumn[];
  entry: UsageEntry | undefined;
  now: number;
  modeBusy: boolean;
  onMode: (account: PoolAccount, mode: PoolMode) => void;
  onReset: (account: PoolAccount) => void;
  onRefresh: (account: PoolAccount) => void;
}

/** One account: a row in Full on wide screens, a card in Compact and on phones. */
export function AccountItem({
  account,
  provider,
  columns,
  entry,
  now,
  modeBusy,
  onMode,
  onReset,
  onRefresh,
}: AccountItemProps) {
  const { t } = useTranslation();
  useSyncExternalStore(
    resetGrantOperations.subscribe,
    resetGrantOperations.snapshot,
    resetGrantOperations.snapshot
  );
  const pendingReset = hasPendingClaudeReset(account, now);
  const windowLabel = useWindowLabel();
  const usage = entry?.usage ?? null;
  const plan = planLabel(provider, account.planOverride, usage?.planCode ?? null);
  const status = accountStatus(account);
  const weekly = usage?.windows.find((window) => window.id === 'weekly') ?? null;
  const weeklyResetMs = weekly?.resetAtMs && weekly.resetAtMs > now ? weekly.resetAtMs - now : null;
  const banked = usage?.bankedResets ?? null;
  const { Glyph } = provider;

  const cells = usage
    ? columns.map((column) => {
        const window = usage.windows.find((candidate) => candidate.id === column.id);
        return window ? (
          <Meter
            key={column.id}
            label={windowLabel(column)}
            window={window}
            now={now}
            stale={Boolean(entry?.error)}
          />
        ) : (
          <div key={column.id} className={`${styles.m} ${styles.none}`}>
            <div className={styles.t}>{windowLabel(column)}</div>
            <div className={styles.r}>{t('pools.not_on_plan')}</div>
          </div>
        );
      })
    : null;

  return (
    <article className={styles.acct} style={accentStyle(provider)}>
      <div className={styles.ctop}>
        <div className={styles.who}>
          <div className={styles.idLine}>
            <b className={styles.name}>{account.label}</b>
            {plan ? <span className={styles.plan}>{plan}</span> : null}
            {account.role ? <span className={styles.role}>{account.role}</span> : null}
          </div>
          {account.email ? <div className={styles.mask}>{maskEmail(account.email)}</div> : null}
          {usage && entry?.error ? (
            <div className={styles.quotaError} role="status">
              {t('pools.stale_usage')}
            </div>
          ) : null}
          <div className={styles.state}>
            <span className={`${styles.dot} ${DOT_CLASS[status.tone]}`} aria-hidden="true" />
            {status.kind === 'mode' ? (
              <span>
                <b>{t(`pools.mode_${status.mode}_strong`)}</b> {t(`pools.mode_${status.mode}_rest`)}
              </span>
            ) : status.kind === 'note' ? (
              <span>{status.text}</span>
            ) : (
              <span>
                {status.state === 'unavailable' && account.statusMessage
                  ? account.statusMessage
                  : t(`pools.state.${status.state}`)}
              </span>
            )}
          </div>
        </div>
        <span className={styles.glyph}>
          <Glyph size={18} />
        </span>
      </div>

      <div className={styles.ms}>
        {cells ?? (
          <div className={`${styles.m} ${styles.placeholder}`}>
            <div className={styles.r} title={entry?.error ?? undefined}>
              {!provider.fetchUsage
                ? t('pools.no_usage_source')
                : entry?.error
                  ? t('pools.quota_unavailable')
                  : t('pools.loading_quota')}
            </div>
          </div>
        )}
        {usage && banked !== null ? (
          <div className={`${styles.m} ${styles.bank}`}>
            <div className={styles.t}>
              {t('pools.banked_resets')} <b>{banked}</b>
            </div>
            <div className={styles.r}>
              {banked > 0 && provider.bankHintKey
                ? t(provider.bankHintKey)
                : t('pools.none_available')}
            </div>
          </div>
        ) : null}
      </div>

      {weeklyResetMs !== null || account.activeRequests !== null ? (
        <div className={styles.foot}>
          {weeklyResetMs !== null ? (
            <div>
              {t('pools.weekly_reset')}
              <b>{formatDuration(t, weeklyResetMs)}</b>
            </div>
          ) : null}
          {account.activeRequests !== null ? (
            <div>
              {t('pools.active_requests')}
              <b>{account.activeRequests}</b>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.ctl}>
        <div
          className={styles.mode}
          role="group"
          aria-label={t('pools.mode_group', { name: account.label, provider: provider.label })}
        >
          {POOL_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={account.mode === mode}
              disabled={modeBusy}
              onClick={() => {
                if (account.mode !== mode) onMode(account, mode);
              }}
            >
              {t(`pools.mode_${mode}`)}
            </button>
          ))}
        </div>
        <div className={styles.acts}>
          {account.activeRequests !== null ? (
            <span>{t('pools.active_count', { count: account.activeRequests })}</span>
          ) : null}
          {provider.redeemReset ? (
            <button
              type="button"
              disabled={!banked && !pendingReset}
              onClick={() => onReset(account)}
            >
              {t(pendingReset ? 'claude_reset.retry' : 'pools.use_reset')}
            </button>
          ) : null}
          {provider.fetchUsage ? (
            <button
              type="button"
              disabled={entry?.loading === true}
              onClick={() => onRefresh(account)}
            >
              {t('pools.refresh_quota')}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
