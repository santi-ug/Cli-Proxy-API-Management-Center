import { normalizePlanType } from './parsers';

/**
 * Codex 套餐档位 → 徽章样式的纯映射。
 *
 * - elite   → 最高档徽章（Pro 200，plan=pro）
 * - premium → 高档徽章（Pro 100；Antigravity ultra / xAI paid 亦复用该类名）
 * - plain   → 普通文字徽章（plus/team/free/未知）
 */
export type CodexPlanTier = 'elite' | 'premium' | 'plain';

export const PREMIUM_CODEX_PLAN_TYPES = new Set([
  'pro',
  'prolite',
  'pro-lite',
  'pro_lite',
  'self_serve_business_prolite',
]);

// Pro 200（plan=pro）在 premium 之上再进一档：最高档徽章，
// 见各宿主样式（如 AuthFileQuota.module.scss）的 .elitePlanValue。
export const ELITE_CODEX_PLAN_TYPE = 'pro';

/**
 * 顺序敏感：'pro' 同时命中 PREMIUM_CODEX_PLAN_TYPES，elite 判断必须在最前，
 * 否则 Pro 200 会静默退回 premium。契约由 tests/quotaPlanTier.test.ts 守护。
 */
export function resolvePlanTier(planType: string | null | undefined): CodexPlanTier {
  const normalized = normalizePlanType(planType);
  if (!normalized) return 'plain';
  if (normalized === ELITE_CODEX_PLAN_TYPE) return 'elite';
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return 'premium';
  return 'plain';
}
