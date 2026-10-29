/**
 * Calendar-day helpers for user-facing daily features.
 *
 * A "day" in this product means the user's local calendar day, not a UTC day.
 * Using `toISOString().slice(0, 10)` silently gives UTC, which makes a streak
 * reset for anyone whose evening is already tomorrow in UTC (and double-count
 * for the opposite timezone). Every daily boundary goes through here instead.
 */

export const DEFAULT_TIME_ZONE = 'UTC';

/** Returns the YYYY-MM-DD calendar date of `date` in `timeZone`. */
export function dateKeyInTimeZone(date: Date, timeZone?: string | null): string {
  const zone = timeZone?.trim() || DEFAULT_TIME_ZONE;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';

    const year = value('year');
    const month = value('month');
    const day = value('day');
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Invalid/unknown IANA zone: fall back to UTC rather than crashing a page.
  }

  if (zone !== DEFAULT_TIME_ZONE) return dateKeyInTimeZone(date, DEFAULT_TIME_ZONE);
  return date.toISOString().slice(0, 10);
}

/** Adds whole calendar days to a YYYY-MM-DD key without timezone drift. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;

  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
