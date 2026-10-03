/**
 * Account pools domain model. React-free and API-free so every rule the page
 * shows (labels, colors, totals, the next-request pick) is unit tested in
 * tests/poolsModel.test.ts.
 */

import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota/validators';

export const POOL_MODES = ['auto', 'on', 'off'] as const;
export type PoolMode = (typeof POOL_MODES)[number];

export const POOL_STATES = [
  'serving',
  'ready',
  'waiting',
  'limited',
  'off',
  'needs-login',
] as const;
export type PoolState = (typeof POOL_STATES)[number];

const isPoolMode = (value: unknown): value is PoolMode =>
  typeof value === 'string' && (POOL_MODES as readonly string[]).includes(value);

const isPoolState = (value: unknown): value is PoolState =>
  typeof value === 'string' && (POOL_STATES as readonly string[]).includes(value);

/** One auth file, read as a pool member. Every `pool_*` key is optional on the wire. */
export interface PoolAccount {
  /** Stable identity across list refreshes. */
  key: string;
  /** Auth file name: the key for PATCH /credentials/fields and /status. */
  name: string;
  authIndex: string | null;
  /** Registry key (`claude`, `codex`, ...), from `provider`/`type`. */
  provider: string;
  label: string;
  email: string | null;
  role: string | null;
  /** `pool_plan`: a display override that beats the plan lookup. */
  planOverride: string | null;
  mode: PoolMode;
  state: PoolState | null;
  note: string | null;
  disabled: boolean;
  unavailable: boolean;
  statusMessage: string | null;
  priority: number;
  activeRequests: number | null;
  file: AuthFileItem;
}

const readText = (file: AuthFileItem, key: string): string | null => {
  const value = file[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

export const emailLocalPart = (email: string): string => email.split('@')[0] ?? email;

/** `account@example.com` → `a•••@e•••.com`. Anything that is not an address is fully hidden. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}•••@${domain[0]}•••${tld}`;
}

const stripExtension = (name: string) => name.replace(/\.json$/i, '');

export const accountKey = (name: string, authIndex: string | null) => `${name}::${authIndex ?? ''}`;

export function toPoolAccount(file: AuthFileItem): PoolAccount | null {
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  if (!name) return null;
  const authIndex = normalizeAuthIndex(file.authIndex ?? file['auth_index']);
  const email = readText(file, 'email');
  const rawMode = file['pool_mode'];
  const rawState = file['pool_state'];
  return {
    key: accountKey(name, authIndex),
    name,
    authIndex,
    provider: resolveAuthProvider(file) || 'unknown',
    label:
      readText(file, 'pool_label') ?? (email ? maskEmail(email) : maskEmail(stripExtension(name))),
    email,
    role: readText(file, 'pool_role'),
    planOverride: readText(file, 'pool_plan'),
    mode: isPoolMode(rawMode) ? rawMode : 'auto',
    state: isPoolState(rawState) ? rawState : null,
    note: readText(file, 'pool_note'),
    disabled: isDisabledAuthFile(file),
    unavailable: file.unavailable === true,
    statusMessage: readText(file, 'statusMessage') ?? readText(file, 'status_message'),
    priority: typeof file.priority === 'number' ? file.priority : 0,
    activeRequests: readCount(file['active_requests']),
    file,
  };
}

/** Highest priority first; ties keep a stable order by name. */
export const compareAccounts = (a: PoolAccount, b: PoolAccount) =>
  b.priority - a.priority || a.name.localeCompare(b.name);

/**
 * The account the gateway should pick next for a provider: not disabled, not
 * unavailable, not switched off, then highest priority, ties by name.
 */
export function pickNextRequest(accounts: readonly PoolAccount[]): PoolAccount | null {
  const eligible = accounts.filter(
    (account) => !account.disabled && !account.unavailable && account.mode !== 'off'
  );
  return eligible.sort(compareAccounts)[0] ?? null;
}

export type StatusTone = 'on' | 'off' | 'alert';

/** What the status line under an account says, before translation. */
export type AccountStatus =
  | { kind: 'mode'; mode: 'on' | 'off'; tone: StatusTone }
  | { kind: 'note'; text: string; tone: StatusTone }
  | { kind: 'state'; state: PoolState | 'disabled' | 'unavailable' | 'ready'; tone: StatusTone };

const stateTone = (state: PoolState): StatusTone =>
  state === 'serving' || state === 'ready'
    ? 'on'
    : state === 'limited' || state === 'needs-login'
      ? 'alert'
      : 'off';

/**
 * A manual On/Off wins (it is what the switch just did); on Auto the routing
 * script's note wins, then its state, then the credential flags.
 */
export function accountStatus(account: PoolAccount): AccountStatus {
  if (account.mode !== 'auto') {
    return { kind: 'mode', mode: account.mode, tone: account.mode === 'on' ? 'on' : 'off' };
  }
  const tone: StatusTone = account.state
    ? stateTone(account.state)
    : account.disabled
      ? 'off'
      : account.unavailable
        ? 'alert'
        : 'on';
  if (account.note) return { kind: 'note', text: account.note, tone };
  if (account.state) return { kind: 'state', state: account.state, tone };
  if (account.disabled) return { kind: 'state', state: 'disabled', tone };
  if (account.unavailable) return { kind: 'state', state: 'unavailable', tone };
  return { kind: 'state', state: 'ready', tone };
}

// ---------------------------------------------------------------------------
// Usage windows

export const WINDOW_KINDS = ['five-hour', 'weekly', 'model-weekly', 'monthly'] as const;
export type UsageWindowKind = (typeof WINDOW_KINDS)[number];

export interface UsageWindow {
  /** `five-hour`, `weekly`, `monthly`, or `weekly:<model>` for model-specific weeklies. */
  id: string;
  kind: UsageWindowKind;
  /** Display name of the model for `model-weekly` windows, e.g. `Fable`. */
  model: string | null;
  /** 0 to 100, what is left, not what is used. */
  leftPercent: number;
  resetAtMs: number | null;
}

export interface AccountUsage {
  windows: UsageWindow[];
  /** Raw plan code from the provider, looked up for display. */
  planCode: string | null;
  /** Banked resets the provider reported; null when the provider did not say. */
  bankedResets: number | null;
}

export const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export const modelWindowId = (model: string) => `weekly:${model.toLowerCase()}`;

/** Windows in display order: 5-hour, weekly (all models), model weeklies by name, monthly. */
export function orderWindows<T extends Pick<UsageWindow, 'kind' | 'model'>>(windows: readonly T[]) {
  return [...windows].sort(
    (a, b) =>
      WINDOW_KINDS.indexOf(a.kind) - WINDOW_KINDS.indexOf(b.kind) ||
      (a.model ?? '').localeCompare(b.model ?? '')
  );
}

export type UsageColumn = Pick<UsageWindow, 'id' | 'kind' | 'model'>;

/**
 * Every window any account of a provider reports, in display order. An account
 * missing a column renders "not on this plan" instead of silently shifting cells.
 */
export function usageColumns(usages: ReadonlyArray<AccountUsage | null>): UsageColumn[] {
  const columns = new Map<string, UsageColumn>();
  for (const usage of usages) {
    for (const { id, kind, model } of usage?.windows ?? []) {
      if (!columns.has(id)) columns.set(id, { id, kind, model });
    }
  }
  return orderWindows([...columns.values()]);
}

export type PercentTone = 'good' | 'mid' | 'low';

/** Green at 60% left or more, yellow from 25%, red below 25%. */
export const percentTone = (leftPercent: number): PercentTone =>
  leftPercent >= 60 ? 'good' : leftPercent >= 25 ? 'mid' : 'low';

/** A sum of what is left against `accounts × 100%`. */
export interface PoolTotal {
  left: number;
  capacity: number;
}

export interface ModelTotal {
  model: string;
  total: PoolTotal;
  /** Labels of the accounts that have this window. */
  holders: string[];
  everyone: boolean;
}

export interface ProviderSummary {
  weekly: PoolTotal | null;
  /** One entry per account, in account order: weekly % left, or null while unknown. */
  weeklySegments: Array<number | null>;
  fiveHour: PoolTotal | null;
  models: ModelTotal[];
  banked: number | null;
  next: PoolAccount | null;
  active: number | null;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const sumWindows = (lefts: number[]): PoolTotal | null =>
  lefts.length === 0 ? null : { left: sum(lefts), capacity: lefts.length * 100 };

const findWindow = (usage: AccountUsage | null, id: string) =>
  usage?.windows.find((window) => window.id === id) ?? null;

/** Percentages are rounded per account first so totals add up to the numbers on screen. */
export function summarizeProvider(
  accounts: readonly PoolAccount[],
  usageOf: (account: PoolAccount) => AccountUsage | null
): ProviderSummary {
  const usages = accounts.map(usageOf);
  const rounded = (id: string) =>
    usages.flatMap((usage) => {
      const window = findWindow(usage, id);
      return window ? [Math.round(window.leftPercent)] : [];
    });

  const models = usageColumns(usages)
    .filter((column) => column.kind === 'model-weekly' && column.model)
    .flatMap((column): ModelTotal[] => {
      const total = sumWindows(rounded(column.id));
      if (!total || !column.model) return [];
      const holders = accounts.filter((_, index) => findWindow(usages[index], column.id));
      return [
        {
          model: column.model,
          total,
          holders: holders.map((account) => account.label),
          everyone: holders.length === accounts.length,
        },
      ];
    });

  const bankedCounts = usages.flatMap((usage) =>
    usage && usage.bankedResets !== null ? [usage.bankedResets] : []
  );
  const activeCounts = accounts.flatMap((account) =>
    account.activeRequests !== null ? [account.activeRequests] : []
  );

  return {
    weekly: sumWindows(rounded('weekly')),
    weeklySegments: usages.map((usage) => {
      const window = findWindow(usage, 'weekly');
      return window ? Math.round(window.leftPercent) : null;
    }),
    fiveHour: sumWindows(rounded('five-hour')),
    models,
    banked: bankedCounts.length > 0 ? sum(bankedCounts) : null,
    next: pickNextRequest(accounts),
    active: activeCounts.length > 0 ? sum(activeCounts) : null,
  };
}

// ---------------------------------------------------------------------------
// Time

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
}

export function splitDuration(ms: number): DurationParts {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}

/** The single largest unit, rounded down, never below one minute: `in 2 hr`, `in 3 d`. */
export function largestUnit(ms: number): { unit: 'min' | 'hr' | 'd'; value: number } {
  const { days, hours, minutes } = splitDuration(ms);
  if (days > 0) return { unit: 'd', value: days };
  if (hours > 0) return { unit: 'hr', value: hours };
  return { unit: 'min', value: Math.max(1, minutes) };
}

// ---------------------------------------------------------------------------
// Polling and view state

export interface UsageEntry {
  usage: AccountUsage | null;
  /** Last successful read. */
  fetchedAt: number | null;
  /** Last attempt, successful or not; failures wait a full interval too. */
  attemptedAt: number | null;
  loading: boolean;
  error: string | null;
}

export function isUsageDue(entry: UsageEntry | undefined, pollMs: number, now: number): boolean {
  if (!entry) return true;
  if (entry.loading) return false;
  return entry.attemptedAt === null || now - entry.attemptedAt >= pollMs;
}

/** The stalest successful read across accounts, for "Quotas updated N min ago". */
export function oldestFetch(entries: ReadonlyArray<UsageEntry | undefined>): number | null {
  const times = entries.flatMap((entry) => (entry?.fetchedAt ? [entry.fetchedAt] : []));
  return times.length > 0 ? Math.min(...times) : null;
}

export const VIEW_MODES = ['full', 'compact'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Reads the persisted Full/Compact choice; anything unexpected falls back to Full. */
export const parseViewMode = (raw: unknown): ViewMode => (raw === 'compact' ? 'compact' : 'full');
