/**
 * Cron expression model: parsing, validation, compression, next-run computation.
 *
 * Supports standard 5-field cron (minute hour day-of-month month day-of-week)
 * plus the widely supported extensions:
 *   - L   in day-of-month  (last day of month)
 *   - nL  in day-of-week   (last <weekday> of month, e.g. 5L = last Friday)
 *   - n#k in day-of-week   (k-th <weekday> of month, e.g. 1#1 = first Monday)
 *   - names (JAN-DEC, SUN-SAT) and macros (@hourly, @daily, @weekly, @monthly, @yearly)
 */

import { addDays, daysInMonthOf, fromWall, wallClock } from './tz';

export type FieldName = 'minute' | 'hour' | 'dom' | 'month' | 'dow';

export const FIELD_ORDER: FieldName[] = ['minute', 'hour', 'dom', 'month', 'dow'];

export const FIELD_META: Record<FieldName, { label: string; short: string; min: number; max: number }> = {
  minute: { label: 'Minute', short: 'MIN', min: 0, max: 59 },
  hour: { label: 'Hour', short: 'HOUR', min: 0, max: 23 },
  dom: { label: 'Day of month', short: 'DAY', min: 1, max: 31 },
  month: { label: 'Month', short: 'MONTH', min: 1, max: 12 },
  dow: { label: 'Day of week', short: 'WEEKDAY', min: 0, max: 6 },
};

export type CronFields = Record<FieldName, string>;

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function splitCron(expr: string): CronFields | null {
  const e = expr.trim();
  const macro = MACROS[e.toLowerCase()];
  const parts = (macro ?? e).split(/\s+/);
  if (parts.length !== 5) return null;
  return { minute: parts[0], hour: parts[1], dom: parts[2], month: parts[3], dow: parts[4] };
}

export function joinCron(f: CronFields): string {
  return FIELD_ORDER.map((k) => f[k]).join(' ');
}

/** Quick test: does the text look like a cron expression rather than English? */
export function looksLikeCron(text: string): boolean {
  const t = text.trim();
  if (MACROS[t.toLowerCase()]) return true;
  const parts = t.split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[\d*/,\-?LW#a-zA-Z]+$/.test(p) && /[\d*?]/.test(p));
}

// ---------------------------------------------------------------------------
// Parsing into matchers
// ---------------------------------------------------------------------------

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  months: Set<number>;
  dom: { any: boolean; days: Set<number>; last: boolean };
  dow: { any: boolean; days: Set<number>; nth: { dow: number; n: number }[]; last: Set<number> };
  nonStandard: boolean;
}

export class CronError extends Error {}

function nameToNum(tok: string, field: FieldName): string {
  const up = tok.toUpperCase();
  if (field === 'month') {
    const i = MONTH_ABBR.indexOf(up.slice(0, 3));
    if (i >= 0 && /^[A-Z]+$/.test(up)) return String(i + 1);
  }
  if (field === 'dow') {
    const i = DOW_ABBR.indexOf(up.slice(0, 3));
    if (i >= 0 && /^[A-Z]+$/.test(up)) return String(i);
  }
  return tok;
}

function num(tok: string, field: FieldName): number {
  const t = nameToNum(tok, field);
  if (!/^\d+$/.test(t)) throw new CronError(`"${tok}" is not a valid ${FIELD_META[field].label.toLowerCase()} value`);
  let n = parseInt(t, 10);
  if (field === 'dow' && n === 7) n = 0;
  const { min, max } = FIELD_META[field];
  if (n < min || n > (field === 'dow' ? 7 : max)) {
    throw new CronError(`${FIELD_META[field].label} value ${n} is out of range (${min}-${max})`);
  }
  return n;
}

function expandSimple(part: string, field: FieldName): number[] {
  const { min, max } = FIELD_META[field];
  let [range, stepStr] = part.split('/');
  const step = stepStr !== undefined ? parseInt(stepStr, 10) : 1;
  if (stepStr !== undefined && (!/^\d+$/.test(stepStr) || step < 1)) {
    throw new CronError(`Invalid step "/${stepStr}" in ${FIELD_META[field].label.toLowerCase()}`);
  }
  let lo: number;
  let hi: number;
  if (range === '*' || range === '?') {
    lo = min;
    hi = max;
  } else if (range.includes('-')) {
    const [a, b] = range.split('-');
    lo = num(a, field);
    hi = num(b, field);
    if (field === 'dow' && b === '7') {
      // 7 is Sunday too: 1-7 = Monday..Sunday, 5-7 = Friday..Sunday
      const out: number[] = [];
      for (let v = lo; v <= 7; v += step) out.push(v % 7);
      return out;
    }
    if (hi < lo) {
      // wrap-around ranges like FRI-MON or 22-2
      const out: number[] = [];
      for (let v = lo; v <= max; v += step) out.push(v);
      for (let v = min; v <= hi; v += step) out.push(v);
      return out;
    }
  } else {
    lo = num(range, field);
    hi = stepStr !== undefined ? max : lo;
  }
  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

export function parseCron(expr: string): ParsedCron {
  const f = splitCron(expr);
  if (!f) throw new CronError('A cron expression needs exactly 5 fields: minute hour day month weekday');
  let nonStandard = false;

  const listOf = (field: FieldName) => {
    const set = new Set<number>();
    for (const part of f[field].split(',')) {
      if (!part) throw new CronError(`Empty value in ${FIELD_META[field].label.toLowerCase()}`);
      for (const v of expandSimple(part, field)) set.add(v);
    }
    return [...set].sort((a, b) => a - b);
  };

  const minutes = listOf('minute');
  const hours = listOf('hour');
  const months = new Set(listOf('month'));

  // day of month
  const dom = { any: f.dom === '*' || f.dom === '?', days: new Set<number>(), last: false };
  if (!dom.any) {
    for (const part of f.dom.split(',')) {
      if (part.toUpperCase() === 'L') {
        dom.last = true;
        nonStandard = true;
      } else for (const v of expandSimple(part, 'dom')) dom.days.add(v);
    }
  }

  // day of week
  const dow = { any: f.dow === '*' || f.dow === '?', days: new Set<number>(), nth: [] as { dow: number; n: number }[], last: new Set<number>() };
  if (!dow.any) {
    for (const part of f.dow.split(',')) {
      const nth = /^(\w+)#([1-5])$/.exec(part);
      const last = /^(\w+)L$/i.exec(part);
      if (nth) {
        dow.nth.push({ dow: num(nth[1], 'dow'), n: parseInt(nth[2], 10) });
        nonStandard = true;
      } else if (last) {
        dow.last.add(num(last[1], 'dow'));
        nonStandard = true;
      } else for (const v of expandSimple(part, 'dow')) dow.days.add(v);
    }
  }
  return { minutes, hours, months, dom, dow, nonStandard };
}

export function validateCron(expr: string): { ok: true; parsed: ParsedCron } | { ok: false; error: string } {
  try {
    return { ok: true, parsed: parseCron(expr) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Next runs
// ---------------------------------------------------------------------------

function dayMatches(p: ParsedCron, y: number, m: number, date: number, wd: number): boolean {
  if (!p.months.has(m)) return false;
  const dim = daysInMonthOf(y, m);
  const domHit = p.dom.days.has(date) || (p.dom.last && date === dim);
  const dowHit =
    p.dow.days.has(wd) ||
    p.dow.nth.some((n) => n.dow === wd && Math.ceil(date / 7) === n.n) ||
    (p.dow.last.has(wd) && date + 7 > dim);
  if (p.dom.any && p.dow.any) return true;
  if (p.dom.any) return dowHit;
  if (p.dow.any) return domHit;
  return domHit || dowHit; // classic cron OR-semantics
}

/**
 * Next `count` fire times strictly after `from`.
 * Times are wall-clock times in `timezone` (IANA, e.g. "Europe/Rome"), or local time when omitted.
 * Wall times skipped by a DST jump are skipped, like most cron daemons.
 */
export function nextRuns(expr: string | ParsedCron, count = 5, from: Date = new Date(), timezone?: string): Date[] {
  const p = typeof expr === 'string' ? parseCron(expr) : expr;
  const out: Date[] = [];
  const w = wallClock(from, timezone);
  const limit = 366 * 8; // a valid cron always fires within 8 years (Feb 29 etc.)
  for (let i = 0; i < limit && out.length < count; i++) {
    const day = addDays(w.y, w.m, w.d, i);
    if (!dayMatches(p, day.y, day.m, day.d, day.dow)) continue;
    for (const h of p.hours) {
      for (const m of p.minutes) {
        const t = fromWall(day.y, day.m, day.d, h, m, timezone);
        if (t && t > from) {
          out.push(t);
          if (out.length >= count) return out;
        }
      }
    }
  }
  return out;
}

/** Earliest next run across several cron expressions. */
export function nextRunsMany(exprs: string[], count = 5, from: Date = new Date(), timezone?: string): { date: Date; cron: string }[] {
  const all: { date: Date; cron: string }[] = [];
  for (const c of exprs) {
    try {
      for (const d of nextRuns(c, count, from, timezone)) all.push({ date: d, cron: c });
    } catch {
      /* ignore invalid */
    }
  }
  all.sort((a, b) => a.date.getTime() - b.date.getTime());
  const dedup: { date: Date; cron: string }[] = [];
  for (const r of all) {
    if (!dedup.length || dedup[dedup.length - 1].date.getTime() !== r.date.getTime()) dedup.push(r);
    if (dedup.length >= count) break;
  }
  return dedup;
}

// ---------------------------------------------------------------------------
// Compression: number set -> compact cron field
// ---------------------------------------------------------------------------

export function compressList(values: Iterable<number>, field: FieldName): string {
  const { min, max } = FIELD_META[field];
  const v = [...new Set(values)].sort((a, b) => a - b);
  if (!v.length) return '*';
  if (v.length === max - min + 1 && v[0] === min) return '*';
  if (v.length === 1) return String(v[0]);

  // arithmetic progression with >= 3 elements
  if (v.length >= 3 && field !== 'dow') {
    const step = v[1] - v[0];
    let ap = step > 1;
    for (let i = 2; i < v.length && ap; i++) if (v[i] - v[i - 1] !== step) ap = false;
    if (ap) {
      const last = v[v.length - 1];
      if (v[0] === min && last + step > max) return `*/${step}`;
      if (v.length >= 4) {
        return `${v[0]}-${last}/${step}`;
      }
    }
  }
  // runs of consecutive values
  const parts: string[] = [];
  let i = 0;
  while (i < v.length) {
    let j = i;
    while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++;
    if (j - i >= 2) parts.push(`${v[i]}-${v[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(v[k]));
    i = j + 1;
  }
  return parts.join(',');
}

// ---------------------------------------------------------------------------
// Week guard: "every N weeks" (cron can't skip weeks, so the cron line runs
// weekly and the guard keeps only every N-th week).
// ---------------------------------------------------------------------------

export interface WeekGuard {
  /** Repeat every N weeks (N >= 2). */
  everyWeeks: number;
  /** Unix seconds. Week k = floor((t - anchor) / 604800); runs only when k % everyWeeks == 0. */
  anchor: number;
}

export const WEEK_SECONDS = 604800;

export function guardAllows(g: WeekGuard | null | undefined, d: Date): boolean {
  if (!g || g.everyWeeks < 2) return true;
  const k = Math.floor((d.getTime() / 1000 - g.anchor) / WEEK_SECONDS);
  return ((k % g.everyWeeks) + g.everyWeeks) % g.everyWeeks === 0;
}

/**
 * Anchor for a guard so that the week containing `firstRun` is an "on" week.
 * Weeks start Monday 00:00 local, shifted 3h earlier so jobs at midnight never sit
 * on a week boundary (which would flip the parity across a DST change).
 */
export function anchorFor(firstRun: Date, timezone?: string): number {
  const w = wallClock(firstRun, timezone);
  const monday = addDays(w.y, w.m, w.d, -((w.dow + 6) % 7));
  const t = fromWall(monday.y, monday.m, monday.d, 0, 0, timezone) ?? fromWall(monday.y, monday.m, monday.d, 1, 0, timezone)!;
  return Math.floor(t.getTime() / 1000) - 3 * 3600;
}

/** Next runs across several cron lines, honouring an optional week guard. */
export function nextRunsGuarded(
  exprs: string[],
  guard: WeekGuard | null | undefined,
  count = 5,
  from: Date = new Date(),
  timezone?: string,
): { date: Date; cron: string }[] {
  if (!guard || guard.everyWeeks < 2) return nextRunsMany(exprs, count, from, timezone);
  const out: { date: Date; cron: string }[] = [];
  let cursor = from;
  for (let i = 0; i < 40 && out.length < count; i++) {
    const batch = nextRunsMany(exprs, Math.max(10, count * guard.everyWeeks * 2), cursor, timezone);
    if (!batch.length) break;
    for (const r of batch) {
      if (guardAllows(guard, r.date)) out.push(r);
      if (out.length >= count) break;
    }
    cursor = batch[batch.length - 1].date;
  }
  return out;
}

/** Crontab-ready guard prefix (note: % must be escaped as \% inside crontab). */
export function shellGuard(g: WeekGuard): string {
  return `[ $(( ($(date +\\%s) - ${g.anchor}) / ${WEEK_SECONDS} \\% ${g.everyWeeks} )) -eq 0 ] &&`;
}

/** Same check for JS schedulers (node-cron, croner, bree…). */
export function jsGuard(g: WeekGuard): string {
  return `Math.floor((Date.now() / 1000 - ${g.anchor}) / ${WEEK_SECONDS}) % ${g.everyWeeks} === 0`;
}
