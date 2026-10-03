/**
 * Time-zone helpers (Intl only, no tz database shipped).
 *
 * A schedule typed by a visitor in Rome means 09:00 *Rome time*, even when the
 * site's server runs in UTC. Every next-run / trigger function takes an optional
 * IANA `timezone`; without one it uses the runtime's local zone.
 */

export interface Wall {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
  dow: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The runtime's IANA zone (falls back to "UTC"). */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in `tz` (or local time when tz is undefined). */
export function wallClock(date: Date, tz?: string): Wall {
  if (!tz) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes(), s: date.getSeconds(), dow: date.getDay() };
  }
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    y: +parts.year,
    m: +parts.month,
    d: +parts.day,
    h: +parts.hour % 24,
    mi: +parts.minute,
    s: +parts.second,
    dow: WD[parts.weekday] ?? 0,
  };
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function offsetAt(t: number, tz: string): number {
  const w = wallClock(new Date(t), tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}

/**
 * Instant for a wall-clock time in `tz`; null when that time doesn't exist
 * (skipped by a DST jump). Ambiguous times (DST fall-back) resolve to the first.
 */
export function fromWall(y: number, m: number, d: number, h: number, mi: number, tz?: string): Date | null {
  if (!tz) {
    const t = new Date(y, m - 1, d, h, mi, 0, 0);
    return t.getHours() === h && t.getMinutes() === mi ? t : null;
  }
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  const o2 = offsetAt(t, tz);
  t = guess - o2;
  // fall-back ambiguity: prefer the earlier instant
  const earlier = t - 3600_000;
  const we = wallClock(new Date(earlier), tz);
  if (we.h === h && we.mi === mi && we.d === d) t = earlier;
  const w = wallClock(new Date(t), tz);
  return w.h === h && w.mi === mi && w.d === d ? new Date(t) : null;
}

/** Calendar helpers on plain y/m/d (time-zone free). */
export function addDays(y: number, m: number, d: number, n: number): { y: number; m: number; d: number; dow: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

export function daysInMonthOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
