/**
 * Reset-time text for the pools page. `formatResetClock` is pure and locale
 * aware; the `t`-based helpers only pick translation keys.
 */

import type { TFunction } from 'i18next';
import { countdownParts } from './model';

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

/** `in 2 hr 47 min`, `in 6 d 4 hr`, `in 45 min`. */
export function formatResetIn(t: TFunction, resetAtMs: number, now: number): string {
  const parts = countdownParts(resetAtMs - now);
  switch (parts.kind) {
    case 'days_hours':
      return t('pools.in_days_hours', { days: parts.days, hours: parts.hours });
    case 'hours_minutes':
      return t('pools.in_hours_minutes', { hours: parts.hours, minutes: parts.minutes });
    case 'minutes':
      return t('pools.in_min', { count: parts.minutes });
  }
}

/** `2 d 4 hr`, `7 hr 12 min`, `45 min`, for the card footer. */
export function formatDuration(t: TFunction, ms: number): string {
  const parts = countdownParts(ms);
  switch (parts.kind) {
    case 'days_hours':
      return t('pools.duration_days_hours', { days: parts.days, hours: parts.hours });
    case 'hours_minutes':
      return t('pools.duration_hours_minutes', { hours: parts.hours, minutes: parts.minutes });
    case 'minutes':
      return t('pools.duration_minutes', { minutes: parts.minutes });
  }
}
