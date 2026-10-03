/**
 * Saved schedules: the small JSON you store per user/client, plus helpers to
 * compute its runs anywhere (browser, React Native, Node) in the right time zone.
 */
import { nextRunsGuarded, WeekGuard } from './cron';

export interface SavedSchedule {
  /** format version */
  v: 1;
  /** what the person typed */
  text: string;
  /** one or more cron lines (wall-clock times in `timezone`) */
  crons: string[];
  /** IANA zone the times are meant in, e.g. "Europe/Rome" */
  timezone: string;
  /** plain-English description, handy for emails / UI */
  description: string;
  /** "every N weeks": the cron lines run weekly, only every N-th week counts */
  everyWeeks?: number;
  /** week anchor (unix seconds) for everyWeeks */
  anchor?: number;
}

export function isSavedSchedule(x: unknown): x is SavedSchedule {
  return !!x && typeof x === 'object' && (x as SavedSchedule).v === 1 && Array.isArray((x as SavedSchedule).crons);
}

export function guardOf(s: SavedSchedule): WeekGuard | null {
  return s.everyWeeks && s.everyWeeks > 1 && typeof s.anchor === 'number' ? { everyWeeks: s.everyWeeks, anchor: s.anchor } : null;
}

/** Next runs of a saved schedule (respects time zone and every-N-weeks). */
export function scheduleNextRuns(s: SavedSchedule, count = 5, from: Date = new Date()): { date: Date; cron: string }[] {
  return nextRunsGuarded(s.crons, guardOf(s), count, from, s.timezone);
}

/** Parse a JSON string or object into a SavedSchedule (null if it isn't one). */
export function readSchedule(x: unknown): SavedSchedule | null {
  try {
    const o = typeof x === 'string' ? JSON.parse(x) : x;
    return isSavedSchedule(o) ? o : null;
  } catch {
    return null;
  }
}
