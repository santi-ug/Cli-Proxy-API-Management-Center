/**
 * Model providers the pools page knows, keyed by the auth file `provider`/`type`.
 * Adding Grok or Kimi is one entry here: the page derives sections, totals,
 * columns and colors from whatever windows an entry's `fetchUsage` returns.
 * Unknown providers still render their accounts through `providerFor`.
 */

import type { CSSProperties, ReactElement } from 'react';
import { ClaudeGlyph, CodexGlyph, GenericGlyph } from './glyphs';
import type { AccountUsage, PoolAccount } from './model';
import {
  fetchClaudeUsage,
  fetchCodexUsage,
  redeemClaudeReset,
  redeemCodexReset,
  type ResetResult,
} from './usage';

export interface PoolProvider {
  id: string;
  /** Brand name, shown as is in every language. */
  label: string;
  /** Bars, plan label and chip dot. */
  accent: string;
  /** Background of the logo tile in the provider totals. */
  tile: string;
  Glyph: (props: { size: number }) => ReactElement;
  /** How often the page re-reads usage while open; null never polls. */
  pollMs: number | null;
  /** Provider plan code → display label. Unknown codes show raw. */
  plans: Readonly<Record<string, string>>;
  fetchUsage: ((account: PoolAccount) => Promise<AccountUsage>) | null;
  redeemReset: ((account: PoolAccount) => Promise<ResetResult>) | null;
  /** i18n key for the line under a non-zero banked-resets count. */
  bankHintKey: string | null;
}

const MINUTE = 60_000;

export const POOL_PROVIDERS: Readonly<Record<string, PoolProvider>> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    accent: '#f2a46b',
    tile: '#3a2516',
    Glyph: ClaudeGlyph,
    // Anthropic's usage endpoint is touchy: at most every 10 minutes per account.
    pollMs: 10 * MINUTE,
    plans: {
      default_claude_max_5x: 'Max 5x ($100)',
      default_claude_max_20x: 'Max 20x ($200)',
      default_claude_ai: 'Pro ($20)',
    },
    fetchUsage: fetchClaudeUsage,
    redeemReset: redeemClaudeReset,
    bankHintKey: 'pools.bank_hint_claude',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    accent: '#5aa9ff',
    tile: '#16263d',
    Glyph: CodexGlyph,
    pollMs: 5 * MINUTE,
    plans: {
      plus: 'Plus ($20)',
      pro: 'Pro 20x ($200)',
    },
    fetchUsage: fetchCodexUsage,
    redeemReset: redeemCodexReset,
    bankHintKey: 'pools.bank_hint_codex',
  },
};

/** Section order: known providers as listed above, then the rest alphabetically. */
const KNOWN_ORDER = Object.keys(POOL_PROVIDERS);

export function compareProviders(a: string, b: string): number {
  const ai = KNOWN_ORDER.indexOf(a);
  const bi = KNOWN_ORDER.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  return a.localeCompare(b);
}

const titleCase = (id: string) => (id ? id[0].toUpperCase() + id.slice(1) : 'Other');

/** The registry entry, or a read-only fallback that shows identity, state and switches. */
export function providerFor(id: string): PoolProvider {
  return (
    POOL_PROVIDERS[id] ?? {
      id,
      label: titleCase(id),
      accent: '#8e8e93',
      tile: '#1d1d20',
      Glyph: GenericGlyph,
      pollMs: null,
      plans: {},
      fetchUsage: null,
      redeemReset: null,
      bankHintKey: null,
    }
  );
}

/** `pool_plan` beats the lookup; an unknown code shows as is until someone adds it. */
export function planLabel(
  provider: Pick<PoolProvider, 'plans'>,
  override: string | null,
  code: string | null
): string | null {
  if (override) return override;
  if (!code) return null;
  return provider.plans[code] ?? code;
}

/** Hands the provider color to the bars, dots and plan label underneath. */
export const accentStyle = (provider: Pick<PoolProvider, 'accent'>): CSSProperties => ({
  '--pool-accent': provider.accent,
});
