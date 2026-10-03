/**
 * Step 4 of the pipeline: deterministic Semantics -> cron compilation.
 *
 * Always yields syntactically valid cron. When a schedule cannot be expressed
 * with a single cron line (e.g. 09:15 and 17:45), several lines are produced.
 * Anything cron fundamentally cannot express is approximated and reported in
 * `warnings`, and every default we pick is reported in `assumptions`.
 */
import { compressList } from './cron';
import type { Semantics, ClockTime, DayPart } from './interpret';
import { DAY_LABELS, formatClock } from './describe';

export interface CompileOutput {
  crons: string[];
  assumptions: string[];
  warnings: string[];
  nonStandard: boolean;
  /** > 1 when the schedule repeats every N weeks (cron itself runs weekly; see WeekGuard). */
  everyWeeks: number;
}

const DAYPART_POINT: Record<DayPart, number> = { morning: 9, afternoon: 14, evening: 18, night: 21 };
const DAYPART_HOURS: Record<DayPart, number[]> = {
  morning: [6, 7, 8, 9, 10, 11],
  afternoon: [12, 13, 14, 15, 16, 17],
  evening: [18, 19, 20, 21],
  night: [22, 23, 0, 1, 2, 3, 4, 5],
};

const DAYPART_LABEL: Record<DayPart, string> = {
  morning: 'Morning = 06:00-11:59',
  afternoon: 'Afternoon = 12:00-17:59',
  evening: 'Evening = 18:00-21:59',
  night: 'Night = 22:00-05:59',
};

const range = (a: number, b: number) => {
  const out: number[] = [];
  for (let x = a; x <= b; x++) out.push(x);
  return out;
};

function spread(count: number, lo: number, hi: number): number[] {
  if (count <= 1) return [lo];
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(Math.round(lo + (k * (hi - lo)) / (count - 1)));
  return [...new Set(out)];
}

/** Group clock times into (minutes x hours) cartesian blocks -> one cron each. */
export function groupTimes(times: ClockTime[]): { minutes: number[]; hours: number[] }[] {
  const byMinute = new Map<number, Set<number>>();
  for (const t of times) {
    if (!byMinute.has(t.m)) byMinute.set(t.m, new Set());
    byMinute.get(t.m)!.add(t.h);
  }
  const byHours = new Map<string, { minutes: number[]; hours: number[] }>();
  for (const [m, hs] of byMinute) {
    const hours = [...hs].sort((a, b) => a - b);
    const key = hours.join(',');
    if (!byHours.has(key)) byHours.set(key, { minutes: [], hours });
    byHours.get(key)!.minutes.push(m);
  }
  return [...byHours.values()].map((g) => ({ minutes: g.minutes.sort((a, b) => a - b), hours: g.hours }));
}

export function compile(sem: Semantics, opts: { allowExtensions?: boolean } = {}): CompileOutput | null {
  const allowExt = opts.allowExtensions !== false;
  const assumptions = [...sem.assumptions];
  const warnings = [...sem.warnings];
  let nonStandard = false;

  const hasDay = sem.dow.size || sem.dowEx.size || sem.nth.length || sem.dom.size || sem.domEx.size || sem.domLast;
  const hasMonth = sem.months.size || sem.monthEx.size || sem.monthStart !== null;
  const hasTime = sem.times.length || sem.dayParts.length || sem.minuteOffsets.length || sem.window || sem.hourStart;
  if (!sem.interval && !sem.perPeriod && !hasDay && !hasMonth && !hasTime) return null;

  // ---------------------------------------------------------- normalise interval
  let interval = sem.interval ? { ...sem.interval } : null;
  if (interval?.unit === 'second') {
    warnings.push('Cron cannot run more often than once a minute; using every minute.');
    interval = { unit: 'minute', n: 1 };
  }
  if (interval?.unit === 'minute' && interval.n >= 60 && interval.n % 60 === 0) interval = { unit: 'hour', n: interval.n / 60 };
  if (interval?.unit === 'hour' && interval.n >= 24 && interval.n % 24 === 0) interval = { unit: 'day', n: interval.n / 24 };
  if (interval?.unit === 'hour' && interval.n > 24) {
    const days = Math.max(1, Math.round(interval.n / 24));
    warnings.push(`Cron can't repeat every ${interval.n} hours across days; using every ${days} day${days > 1 ? 's' : ''} instead.`);
    interval = { unit: 'day', n: days };
  }
  if (interval?.unit === 'day' && interval.n === 7) interval = { unit: 'week', n: 1 };
  if (interval?.unit === 'month' && interval.n >= 12 && interval.n % 12 === 0) interval = { unit: 'year', n: interval.n / 12 };
  // "every 2 weeks" / "every other saturday": cron runs weekly, a week guard skips the off weeks
  let everyWeeks = 0;
  if (interval?.unit === 'week' && interval.n > 1) {
    everyWeeks = interval.n;
    interval = { unit: 'week', n: 1 };
  }
  if (sem.biweekly) everyWeeks = Math.max(everyWeeks, 2);
  if (interval?.unit === 'year' && interval.n > 1) {
    warnings.push(`Cron has no year field; "every ${interval.n} years" runs yearly.`);
    interval = { unit: 'year', n: 1 };
  }

  // ---------------------------------------------------------- day-level fields
  // day of week
  let dowSet = new Set(sem.dow);
  if (!dowSet.size && sem.dowEx.size) dowSet = new Set(range(0, 6));
  for (const d of sem.dowEx) dowSet.delete(d);
  if (sem.businessHours && !sem.dow.size && !sem.dowEx.size && !sem.nth.length) {
    dowSet = new Set([1, 2, 3, 4, 5]);
    assumptions.push('Business hours = 09:00-17:00, Monday to Friday.');
  }
  let nth = sem.nth;
  if (nth.length && !allowExt) {
    warnings.push('"Nth weekday of the month" needs the # / L cron extension (disabled); using the plain weekday.');
    for (const n of nth) dowSet.add(parseInt(n, 10));
    nth = [];
  }
  if (interval?.unit === 'week' && !dowSet.size && !nth.length && !sem.dom.size && !sem.domLast) {
    dowSet.add(0);
    assumptions.push('Weekly runs on Sunday (crontab @weekly). Name a day to change it.');
  }
  const perWeek = sem.perPeriod?.unit === 'week' ? sem.perPeriod.count : 0;
  if (perWeek && !dowSet.size) {
    const table: Record<number, number[]> = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: range(0, 6) };
    const days = table[Math.min(perWeek, 7)];
    days.forEach((d) => dowSet.add(d));
    assumptions.push(`${perWeek}x a week = ${days.map((d) => DAY_LABELS[d]).join(', ')}.`);
  }
  let dowField = dowSet.size === 7 ? '*' : dowSet.size ? compressList(dowSet, 'dow') : '*';
  if (nth.length) {
    dowField = dowField === '*' ? nth.join(',') : `${dowField},${nth.join(',')}`;
    nonStandard = true;
  }

  // day of month
  let domSet = new Set(sem.dom);
  if (!domSet.size && sem.domEx.size) domSet = new Set(range(1, 31));
  for (const d of sem.domEx) domSet.delete(d);
  const perMonth = sem.perPeriod?.unit === 'month' ? sem.perPeriod.count : 0;
  if (perMonth && !domSet.size && !sem.domLast) {
    const table: Record<number, number[]> = { 1: [1], 2: [1, 15], 3: [1, 10, 20], 4: [1, 8, 15, 22] };
    const days = table[Math.min(perMonth, 4)];
    days.forEach((d) => domSet.add(d));
    assumptions.push(`${perMonth}x a month = on day ${days.join(', ')}.`);
  }
  let domField = domSet.size ? compressList(domSet, 'dom') : '*';
  if (sem.domLast) {
    if (allowExt) {
      domField = domField === '*' ? 'L' : `${domField},L`;
      nonStandard = true;
    } else {
      warnings.push('"Last day of the month" needs the L extension (disabled); using day 28-31 is NOT equivalent, so day 28 is used.');
      domField = domField === '*' ? '28' : `${domField},28`;
    }
  }
  if (interval?.unit === 'day' && interval.n > 1) {
    if (domField === '*') domField = `*/${interval.n}`;
    if (31 % interval.n !== 0) warnings.push(`"Every ${interval.n} days" restarts on the 1st of each month in cron, so gaps at month end can be shorter.`);
  }

  // month
  let monthSet = new Set(sem.months);
  if (!monthSet.size && sem.monthEx.size) monthSet = new Set(range(1, 12));
  for (const m of sem.monthEx) monthSet.delete(m);
  const perYear = sem.perPeriod?.unit === 'year' ? sem.perPeriod.count : 0;
  if (perYear && !monthSet.size) {
    const table: Record<number, number[]> = { 1: [1], 2: [1, 7], 3: [1, 5, 9], 4: [1, 4, 7, 10], 6: [1, 3, 5, 7, 9, 11], 12: range(1, 12) };
    const months = table[perYear] ?? [1];
    months.forEach((m) => monthSet.add(m));
  }
  let monthField = monthSet.size ? compressList(monthSet, 'month') : '*';
  if (interval?.unit === 'month' && interval.n > 1) {
    const start = sem.monthStart ?? 1;
    const vals: number[] = [];
    for (let m = start; m <= 12; m += interval.n) vals.push(m);
    if (sem.monthStart && sem.monthStart > 1) {
      // wrap around the year so the cycle stays regular when 12 % n === 0
      if (12 % interval.n === 0) for (let m = start - interval.n; m >= 1; m -= interval.n) vals.push(m);
    }
    monthField = compressList(vals, 'month');
    if (12 % interval.n !== 0) warnings.push(`"Every ${interval.n} months" restarts each January in cron.`);
  } else if (sem.monthStart && monthField === '*' && interval?.unit !== 'month') {
    assumptions.push('Cron has no start date; "starting in <month>" only affects month cycles.');
  }

  const needsDom = interval?.unit === 'month' || interval?.unit === 'year' || perYear > 0;
  if (needsDom && domField === '*' && dowField === '*') {
    domField = '1';
    assumptions.push('Runs on the 1st of the month (no day given).');
  }
  if ((interval?.unit === 'year' || perYear === 1) && monthField === '*') {
    monthField = '1';
    assumptions.push('Yearly runs in January (no month given).');
  }
  if (domField !== '*' && dowField !== '*') {
    warnings.push('Cron runs when EITHER the day-of-month OR the weekday matches (not both).');
  }

  // ---------------------------------------------------------- time-level fields
  const pairs: { minute: string; hour: string }[] = [];
  const windowHours = (): number[] | null => {
    if (sem.window) {
      const { sh, eh, em } = sem.window;
      const end = em === 0 ? eh - 1 : eh;
      const hs = sh <= end ? range(sh, Math.min(end, 23)) : [...range(sh, 23), ...range(0, end)];
      if (sem.window.sm !== 0) warnings.push(`Window starts at ${formatClock(sh, sem.window.sm)}; cron counts from the top of the hour.`);
      return hs;
    }
    if (sem.hourStart) return range(sem.hourStart.h, 23);
    if (sem.dayParts.length) {
      const hs = new Set<number>();
      for (const p of sem.dayParts) DAYPART_HOURS[p].forEach((h) => hs.add(h));
      assumptions.push(sem.dayParts.map((p) => DAYPART_LABEL[p]).join(', ') + '.');
      return [...hs].sort((a, b) => a - b);
    }
    return null;
  };

  const unit = interval?.unit;
  if (unit === 'minute' || sem.perPeriod?.unit === 'hour' || sem.perPeriod?.unit === 'minute') {
    let minuteField: string;
    if (sem.perPeriod?.unit === 'hour' || sem.perPeriod?.unit === 'minute') {
      const c = sem.perPeriod.count;
      if (sem.perPeriod.unit === 'minute') {
        warnings.push('Cron cannot run more than once a minute; using every minute.');
        minuteField = '*';
      } else {
        const step = Math.max(1, Math.round(60 / c));
        minuteField = compressList(range(0, 59).filter((m) => m % step === 0), 'minute');
        if (60 % c !== 0) warnings.push(`${c}x an hour isn't an even split of 60 minutes; using every ${step} minutes.`);
      }
    } else {
      const n = interval!.n;
      if (n >= 60) {
        // e.g. every 90 minutes -> enumerate a day and group
        const times: ClockTime[] = [];
        const startMin = sem.window ? sem.window.sh * 60 + sem.window.sm : sem.hourStart ? sem.hourStart.h * 60 + sem.hourStart.m : 0;
        const endMin = sem.window ? Math.min(sem.window.eh * 60 + sem.window.em, 1439) : 1439;
        for (let t = startMin; t <= endMin; t += n) times.push({ h: Math.floor(t / 60), m: t % 60 });
        if (1440 % n !== 0 && !sem.window) warnings.push(`Every ${n} minutes doesn't divide a day evenly; the cycle restarts at midnight.`);
        for (const g of groupTimes(times)) pairs.push({ minute: compressList(g.minutes, 'minute'), hour: compressList(g.hours, 'hour') });
        minuteField = '';
      } else {
        minuteField = n === 1 ? '*' : `*/${n}`;
        if (sem.minuteWindow) {
          const [lo, hi] = sem.minuteWindow;
          minuteField = n === 1 ? `${lo}-${hi}` : `${lo}-${hi}/${n}`;
        }
        if (n > 1 && 60 % n !== 0) warnings.push(`Every ${n} minutes restarts at the top of each hour in cron (…:${String(60 - (60 % n)).padStart(2, '0')} then :00).`);
        if (sem.hourStart && sem.hourStart.m && n > 1) minuteField = `${sem.hourStart.m % n}-59/${n}`;
      }
    }
    if (minuteField) {
      let hours = windowHours();
      if (sem.window && sem.window.em !== 0 && sem.window.eh !== 24) {
        warnings.push(`Window ends at ${formatClock(sem.window.eh, sem.window.em)}; cron keeps running until the end of that hour.`);
      }
      if (!hours && sem.times.length) hours = [...new Set(sem.times.map((t) => t.h))].sort((a, b) => a - b);
      pairs.push({ minute: minuteField, hour: hours ? compressList(hours, 'hour') : '*' });
    }
  } else if (unit === 'hour') {
    const n = interval!.n;
    let minutes = sem.minuteOffsets.length ? sem.minuteOffsets : sem.hourStart ? [sem.hourStart.m] : [];
    if (!minutes.length && sem.times.length) minutes = [...new Set(sem.times.map((t) => t.m))];
    if (!minutes.length) minutes = [0];
    let hourField: string;
    let wh = windowHours();
    if (sem.window && sem.window.em === 0) {
      // "every hour from 9 to 17" includes 17:00
      const e = sem.window.eh === 24 ? 23 : sem.window.eh;
      wh = sem.window.sh <= e ? range(sem.window.sh, e) : [...range(sem.window.sh, 23), ...range(0, e)];
    }
    if (!wh && sem.times.length && n > 1) wh = range(sem.times[0].h, 23);
    if (wh) {
      const picked = wh.filter((_, idx) => idx % n === 0);
      hourField = compressList(picked, 'hour');
    } else {
      hourField = n === 1 ? '*' : `*/${n}`;
      if (24 % n !== 0) warnings.push(`Every ${n} hours restarts at midnight in cron (${range(0, 23).filter((h) => h % n === 0).join(', ')}).`);
    }
    pairs.push({ minute: compressList(minutes, 'minute'), hour: hourField });
  } else if (!unit && sem.minuteOffsets.length && !sem.times.length) {
    const wh = windowHours();
    pairs.push({ minute: compressList(sem.minuteOffsets, 'minute'), hour: wh ? compressList(wh, 'hour') : '*' });
  } else {
    // day-level or coarser: concrete clock times
    let times: ClockTime[] = [...sem.times];
    if (!times.length && sem.dayParts.length) {
      times = sem.dayParts.map((p) => ({ h: DAYPART_POINT[p], m: 0 }));
      assumptions.push(sem.dayParts.map((p) => `"${p}" = ${formatClock(DAYPART_POINT[p], 0)}`).join(', ') + '.');
    }
    const perDay = sem.perPeriod?.unit === 'day' ? sem.perPeriod.count : 0;
    if (perDay && times.length < perDay) {
      if (sem.window) {
        const lo = sem.window.sh;
        const hi = sem.window.eh === 24 ? 23 : sem.window.eh;
        times = spread(perDay, lo, hi).map((h) => ({ h, m: 0 }));
      } else if (perDay === 1) {
        times = times.length ? times : [{ h: 0, m: 0 }];
      } else {
        const step = 24 / perDay;
        times = range(0, perDay - 1).map((k) => ({ h: Math.floor(k * step), m: Math.round((k * step - Math.floor(k * step)) * 60) }));
      }
      assumptions.push(`${perDay}x a day = ${times.map((t) => formatClock(t.h, t.m)).join(', ')}.`);
    }
    if (!times.length && sem.window && !perDay) {
      const wh = windowHours()!;
      pairs.push({ minute: '0', hour: compressList(wh, 'hour') });
      assumptions.push('A time window with no frequency runs hourly inside it.');
    } else {
      if (!times.length) {
        times = [{ h: 0, m: 0 }];
        assumptions.push('No time given, so it runs at midnight (00:00).');
      }
      for (const g of groupTimes(times)) pairs.push({ minute: compressList(g.minutes, 'minute'), hour: compressList(g.hours, 'hour') });
    }
  }

  const crons = [...new Set(pairs.map((p) => `${p.minute} ${p.hour} ${domField} ${monthField} ${dowField}`))];
  return { crons, assumptions: dedupe(assumptions), warnings: dedupe(warnings), nonStandard, everyWeeks };
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}
