/**
 * Reset-time text for the pools page. `formatResetClock` is pure and locale
 * aware; the `t`-based helpers only pick translation keys.
 */

import type { TFunction } from 'i18next';
import { largestUnit, splitDuration } from './model';

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** `16:40` today, `10/06, 13:00` on any other day, in local time. */
export function formatResetClock(resetAtMs: number, now: number, locale?: string): string {
  const at = new Date(resetAtMs);
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  if (sameDay(at, new Date(now))) return time;
  const date = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(at);
  return `${date}, ${time}`;
}

/** `in 2 hr`, `in 3 d`. */
export function formatResetIn(t: TFunction, resetAtMs: number, now: number): string {
  const { unit, value } = largestUnit(resetAtMs - now);
  return t(`pools.in_${unit}`, { count: value });
}

/** `2 d 4 hr`, `7 hr`, `45 min`, for the card footer. */
export function formatDuration(t: TFunction, ms: number): string {
  const { days, hours, minutes } = splitDuration(ms);
  if (days > 0) {
    return hours > 0
      ? t('pools.duration_days_hours', { days, hours })
      : t('pools.duration_days', { days });
  }
  if (hours > 0) return t('pools.duration_hours', { hours });
  return t('pools.duration_minutes', { minutes: Math.max(1, minutes) });
}
