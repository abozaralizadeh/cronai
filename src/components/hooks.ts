import { useEffect, useMemo, useRef, useState } from 'react';
import { createTrigger, parseSchedule, ParseOptions, ParseResult, SavedSchedule } from '../engine';

/** Debounced value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (ms <= 0) {
      setV(value);
      return;
    }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Parse a natural language schedule (or cron) with the on-device engine. */
export function useCronSchedule(text: string, opts: ParseOptions = {}): ParseResult {
  const { allowExtensions, hour12, nextCount, anchor, timezone } = opts;
  // recompute next runs once a minute so relative times stay fresh
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(
    () => parseSchedule(text, { allowExtensions, hour12, nextCount, anchor, timezone }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, allowExtensions, hour12, nextCount, anchor, timezone, tick],
  );
}

export interface TriggerEvent {
  date: Date;
  cron: string;
  schedule: SavedSchedule;
  count: number;
  late: boolean;
}

/**
 * Runs `onTrigger` on a schedule while the app is alive (foreground). Pass the
 * `schedule` from a parse result or one you saved for a user: time zone and
 * "every N weeks" are honoured. Built on the engine's createTrigger.
 */
export function useCronTrigger(
  schedule: SavedSchedule | null | undefined,
  { enabled, onTrigger }: { enabled: boolean; onTrigger?: (e: TriggerEvent) => void },
) {
  const [next, setNext] = useState<{ date: Date; cron: string } | null>(null);
  const [fired, setFired] = useState<TriggerEvent[]>([]);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const cb = useRef(onTrigger);
  cb.current = onTrigger;
  const key = schedule ? JSON.stringify([schedule.crons, schedule.timezone, schedule.everyWeeks, schedule.anchor]) : '';

  useEffect(() => {
    if (!enabled || !schedule) {
      setNext(null);
      setArmedAt(null);
      return;
    }
    setArmedAt(Date.now());
    const t = createTrigger(schedule, (e) => {
      setFired((f) => [e, ...f].slice(0, 20));
      setArmedAt(Date.now());
      cb.current?.(e);
      // createTrigger plans the following run right after this callback returns
      setTimeout(() => {
        const n = t.next();
        setNext(n ? { date: n, cron: e.cron } : null);
      }, 0);
    });
    const n = t.next();
    setNext(n ? { date: n, cron: schedule.crons[0] } : null);
    return () => t.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return { next, fired, armedAt };
}

/** Re-render every `ms` while `active`. Returns current time. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function relativeTime(target: Date, now = Date.now()): string {
  let s = Math.max(0, Math.round((target.getTime() - now) / 1000));
  if (s < 60) return `in ${s}s`;
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m ${s % 60}s`;
}

export function countdown(target: Date, now = Date.now()): string {
  let s = Math.max(0, Math.floor((target.getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return (d ? `${d}d ` : '') + `${p(h)}:${p(m)}:${p(s)}`;
}
