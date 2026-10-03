/**
 * createTrigger: run your own code on a schedule, from a sentence, a parse result
 * or a SavedSchedule your visitors picked. Works in browsers, React Native and Node.
 *
 *   const t = createTrigger(savedSchedule, ({ date }) => sendReminder(userId));
 *   t.next();   // Date of the next run
 *   t.stop();
 *
 * It uses timers, so it only runs while the page / app / process is alive.
 */
import { parseSchedule, ParseResult } from './index';
import { readSchedule, SavedSchedule, scheduleNextRuns } from './schedule';

export interface TriggerFire {
  date: Date;
  cron: string;
  schedule: SavedSchedule;
  /** how many times this trigger has fired, including this one */
  count: number;
  /** true when the run was missed (device asleep, tab frozen) and fired on wake-up */
  late: boolean;
}

export interface TriggerOptions {
  /** IANA zone when `source` is text (SavedSchedule already carries one) */
  timezone?: string;
  /** week anchor when `source` is text with "every N weeks" */
  anchor?: number;
  /** what to do with a run missed while asleep: 'fire' it once on wake-up (default) or 'skip' it */
  missed?: 'fire' | 'skip';
  /** max timer chunk; smaller = faster recovery after sleep. Default 30 s. */
  checkEveryMs?: number;
  /** called when the source isn't a valid schedule */
  onError?: (message: string) => void;
}

export interface TriggerHandle {
  readonly schedule: SavedSchedule | null;
  /** next fire time, or null when stopped / invalid */
  next(): Date | null;
  stop(): void;
  readonly running: boolean;
  readonly count: number;
}

export function toSavedSchedule(source: SavedSchedule | ParseResult | string, opts: TriggerOptions = {}): SavedSchedule | null {
  if (typeof source === 'string') {
    const saved = readSchedule(source);
    if (saved) return saved;
    const r = parseSchedule(source, { timezone: opts.timezone, anchor: opts.anchor });
    return r.ok ? r.schedule : null;
  }
  if ('ok' in source) return source.ok ? source.schedule : null;
  return readSchedule(source);
}

export function createTrigger(
  source: SavedSchedule | ParseResult | string,
  onFire: (e: TriggerFire) => void,
  opts: TriggerOptions = {},
): TriggerHandle {
  const schedule = toSavedSchedule(source, opts);
  const chunk = opts.checkEveryMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = !!schedule;
  let count = 0;
  let upcoming: { date: Date; cron: string } | null = null;
  let lastFired = 0;

  if (!schedule) opts.onError?.('Not a schedule');

  const plan = () => {
    if (!running || !schedule) return;
    upcoming = scheduleNextRuns(schedule, 1, new Date(Math.max(Date.now(), lastFired)))[0] ?? null;
    if (!upcoming) {
      running = false;
      return;
    }
    const target = upcoming;
    timer = setTimeout(tick, Math.max(0, Math.min(target.date.getTime() - Date.now(), chunk)));
  };

  const tick = () => {
    if (!running || !schedule || !upcoming) return;
    const due = upcoming.date.getTime();
    const now = Date.now();
    if (now >= due - 25) {
      const late = now - due > Math.max(chunk, 60_000);
      lastFired = due;
      if (!late || opts.missed !== 'skip') {
        count++;
        try {
          onFire({ date: upcoming.date, cron: upcoming.cron, schedule, count, late });
        } catch (e) {
          // never let a user callback kill the trigger
          setTimeout(() => {
            throw e;
          });
        }
      }
      if (late) lastFired = now; // don't replay every run missed during a long sleep
    }
    plan();
  };

  plan();
  return {
    get schedule() {
      return schedule;
    },
    next: () => (running && upcoming ? upcoming.date : null),
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
      upcoming = null;
    },
    get running() {
      return running;
    },
    get count() {
      return count;
    },
  };
}
