/**
 * Step 3 of the pipeline: semantic interpretation.
 *
 * Walks the normalised token stream with a set of pattern matchers and builds a
 * structured "schedule meaning" (Semantics). No cron is produced here; see
 * compile.ts for the deterministic Semantics -> cron step.
 */
import type { Tok, Role, Tokenized } from './tokenize';

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const UNITS = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const;
export type Unit = (typeof UNITS)[number];

const SEASONS: Record<string, number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
};

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ClockTime {
  h: number;
  m: number;
}

export interface Semantics {
  times: ClockTime[];
  dayParts: DayPart[];
  minuteOffsets: number[];
  minuteWindow: [number, number] | null;
  window: { sh: number; sm: number; eh: number; em: number } | null;
  hourStart: ClockTime | null;
  interval: { unit: Unit; n: number } | null;
  perPeriod: { count: number; unit: Unit } | null;
  dow: Set<number>;
  dowEx: Set<number>;
  nth: string[];
  dom: Set<number>;
  domEx: Set<number>;
  domLast: boolean;
  months: Set<number>;
  monthEx: Set<number>;
  monthStart: number | null;
  businessHours: boolean;
  biweekly: boolean;
  assumptions: string[];
  warnings: string[];
  signals: number;
}

interface TP {
  h: number;
  m: number;
  mer: 'am' | 'pm' | null;
  /** noon: never re-read by a day part */
  fixed?: boolean;
  end: number;
  clock: boolean; // written like a clock (colon / am-pm / noon) rather than a bare number
}

export function interpret(tk: Tokenized): Semantics {
  const T = tk.toks;
  const sem: Semantics = {
    times: [],
    dayParts: [],
    minuteOffsets: [],
    minuteWindow: null,
    window: null,
    hourStart: null,
    interval: null,
    perPeriod: null,
    dow: new Set(),
    dowEx: new Set(),
    nth: [],
    dom: new Set(),
    domEx: new Set(),
    domLast: false,
    months: new Set(),
    monthEx: new Set(),
    monthStart: null,
    businessHours: false,
    biweekly: false,
    assumptions: [],
    warnings: [],
    signals: 0,
  };
  let exclude = false;

  // ---------------------------------------------------------------- helpers
  const mark = (from: number, to: number, role: Role) => {
    for (let x = from; x < to && x < T.length; x++) {
      const p = tk.pieces[T[x].src];
      if (p && (p.role === 'filler' || p.role === 'connector')) p.role = role;
    }
  };
  const w = (i: number): string | null => {
    const t = T[i];
    return t && t.k === 'w' ? t.v : null;
  };
  const isW = (i: number, ...vs: string[]) => {
    const v = w(i);
    return v !== null && vs.includes(v);
  };
  const isThe = (i: number) => {
    const t = T[i];
    return !!t && t.k === 'unk' && t.raw === 'the';
  };
  const skipThe = (i: number) => (isThe(i) ? i + 1 : i);
  const isSep = (i: number) => isW(i, 'and') || T[i]?.k === 'comma' || (isW(i, 'or'));
  const dayIdx = (i: number) => {
    const v = w(i);
    return v ? DAYS.indexOf(v) : -1;
  };
  const monthIdx = (i: number) => {
    const v = w(i);
    return v ? MONTHS.indexOf(v) : -1;
  };
  const unitAt = (i: number): Unit | null => {
    const v = w(i);
    return v && (UNITS as readonly string[]).includes(v) ? (v as Unit) : null;
  };
  const numAt = (i: number) => {
    const t = T[i];
    return t && t.k === 'num' ? t.v : null;
  };
  const ordAt = (i: number) => {
    const t = T[i];
    return t && t.k === 'ord' ? t.v : null;
  };
  const addDow = (d: number) => (exclude ? sem.dowEx : sem.dow).add(d);
  const addMonth = (m: number) => (exclude ? sem.monthEx : sem.months).add(m);
  const addDom = (d: number) => (exclude ? sem.domEx : sem.dom).add(d);
  const to24 = (h: number, mer: 'am' | 'pm' | null) => {
    if (h === 24) return 0;
    if (mer === 'pm' && h < 12) return h + 12;
    if (mer === 'am' && h === 12) return 0;
    return h;
  };

  /** Hour reference used by "half past 9", "quarter to 10" */
  const hourAt = (j: number): { h: number; mer: 'am' | 'pm' | null; end: number } | null => {
    if (isW(j, 'noon')) return { h: 12, mer: 'pm', end: j + 1 };
    if (isW(j, 'midnight')) return { h: 0, mer: 'am', end: j + 1 };
    const n = numAt(j);
    if (n === null || n > 24) return null;
    let end = j + 1;
    let mer: 'am' | 'pm' | null = null;
    if (isW(end, 'oclock')) end++;
    if (isW(end, 'am') || isW(end, 'pm')) {
      mer = w(end) as 'am' | 'pm';
      end++;
    }
    return { h: n, mer, end };
  };

  const parseTime = (i: number, allowBare: boolean): TP | null => {
    const t = T[i];
    if (!t) return null;
    if (isW(i, 'noon')) return { h: 12, m: 0, mer: null, end: i + 1, clock: true, fixed: true };
    if (isW(i, 'midnight')) return { h: 0, m: 0, mer: null, end: i + 1, clock: true };
    if (isW(i, 'half') && isW(i + 1, 'past')) {
      const h = hourAt(i + 2);
      if (h) return { h: h.h, m: 30, mer: h.mer, end: h.end, clock: true };
    }
    if (isW(i, 'quarter') && isW(i + 1, 'past')) {
      const h = hourAt(i + 2);
      if (h) return { h: h.h, m: 15, mer: h.mer, end: h.end, clock: true };
    }
    if (isW(i, 'quarter') && isW(i + 1, 'to')) {
      const h = hourAt(i + 2);
      if (h) return { h: (h.h + 23) % 24, m: 45, mer: h.mer, end: h.end, clock: true };
    }
    if (t.k === 'num' && t.v < 60) {
      let j = i + 1;
      if (isW(j, 'minute')) j++;
      if (isW(j, 'past')) {
        const h = hourAt(j + 1);
        if (h) return { h: h.h, m: t.v, mer: h.mer, end: h.end, clock: true };
      }
    }
    if (t.k === 'time') {
      if (t.h > 24 || t.m > 59) return null;
      let end = i + 1;
      let mer: 'am' | 'pm' | null = null;
      if (isW(end, 'am') || isW(end, 'pm')) {
        mer = w(end) as 'am' | 'pm';
        end++;
      }
      return { h: t.h, m: t.m, mer, end, clock: true };
    }
    if (t.k === 'num' && t.v <= 24) {
      let end = i + 1;
      let oclock = false;
      let mer: 'am' | 'pm' | null = null;
      if (isW(end, 'oclock')) {
        oclock = true;
        end++;
      }
      if (isW(end, 'am') || isW(end, 'pm')) {
        mer = w(end) as 'am' | 'pm';
        end++;
      }
      // don't steal "5 minutes", "3 days", "15 march"
      if (!mer && !oclock && (unitAt(end) || monthIdx(end) >= 0 || isW(end, 'times'))) return null;
      if (mer || oclock || allowBare) return { h: t.v, m: 0, mer, end, clock: !!mer };
    }
    return null;
  };

  /**
   * AM/PM implied by a day part for a 12-hour clock value. "night" covers both
   * late evening and the small hours: "11 at night" is 23:00, "2:30 every night" is 02:30.
   */
  const merFor = (h: number, part: DayPart): 'am' | 'pm' | null => {
    if (h > 12) return null; // already 24-hour
    if (part === 'morning') return 'am';
    if (part === 'afternoon') return 'pm';
    if (part === 'evening') return h === 12 ? 'am' : 'pm';
    return h === 12 || h <= 5 ? 'am' : 'pm'; // night
  };
  /** Say so when "night" turned an ambiguous hour into the small hours. */
  const noteNight = (h: number, m: number, part: DayPart) => {
    if (part !== 'night' || h > 5 || h === 0) return;
    const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const said = m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`;
    sem.assumptions.push(`Read "${said}" at night as ${hm} (early morning). Say "${said}pm" for the afternoon.`);
  };

  /** "in the evening", "at night", "in the morning" right after a time */
  const contextPart = (j: number): { part: DayPart; end: number } | null => {
    let k = j;
    let guard = 0;
    while ((isW(k, 'in', 'at', 'every', 'each') || isThe(k)) && guard++ < 3) k++;
    const v = w(k);
    if (v === 'morning' || v === 'afternoon' || v === 'evening' || v === 'night') return { part: v, end: k + 1 };
    return null;
  };

  const ambiguous: number[] = []; // indexes into sem.times of 1-12 hours without am/pm
  const clockIdx = new Set<number>(); // of those, the ones written as clock times (9:30), which read as 24-hour without a note
  const pushTimes = (tps: TP[]) => {
    for (const tp of tps) {
      const h = to24(tp.h, tp.mer);
      // bare or clock-style 1-12 without am/pm: a day part elsewhere in the sentence may resolve it
      if (!tp.mer && !tp.fixed && tp.h >= 1 && tp.h <= 12) {
        if (tp.clock) clockIdx.add(sem.times.length);
        ambiguous.push(sem.times.length);
      }
      if (h > 23 || tp.m > 59) {
        sem.warnings.push(`Ignored invalid time ${tp.h}:${tp.m}`);
        continue;
      }
      sem.times.push({ h, m: tp.m });
    }
  };

  // ---------------------------------------------------------------- matchers
  type Matcher = (i: number) => number; // returns next index, or -1 if no match

  const mExcept: Matcher = (i) => {
    if (!isW(i, 'except')) return -1;
    exclude = true;
    mark(i, i + 1, 'except');
    let j = i + 1;
    if (isW(j, 'on', 'in', 'during')) j++;
    return j;
  };

  const mSpecial: Matcher = (i) => {
    // business / working / office hours|days
    if (isW(i, 'business')) {
      const u = unitAt(i + 1);
      if (u === 'hour') {
        sem.window = { sh: 9, sm: 0, eh: 17, em: 0 };
        sem.businessHours = true;
        sem.signals++;
        mark(i, i + 2, 'time');
        return i + 2;
      }
      if (u === 'day' || u === 'week') {
        for (const d of [1, 2, 3, 4, 5]) addDow(d);
        sem.signals++;
        mark(i, i + 2, 'day');
        return i + 2;
      }
    }
    // holidays
    const hol: Record<string, [number, number]> = { christmas: [25, 12], halloween: [31, 10], valentine: [14, 2] };
    const hv = w(i);
    if (hv && hol[hv]) {
      sem.dom.add(hol[hv][0]);
      sem.months.add(hol[hv][1]);
      sem.signals++;
      mark(i, i + 1, 'day');
      let j = i + 1;
      if (isW(j, 'day')) j++;
      return j;
    }
    if (isW(i, 'new') && unitAt(i + 1) === 'year') {
      sem.dom.add(1);
      sem.months.add(1);
      sem.signals++;
      mark(i, i + 2, 'day');
      let j = i + 2;
      if (isW(j, 'day')) j++;
      return j;
    }
    // end/start of the month|week|year
    if (isW(i, 'end', 'start')) {
      let j = i + 1;
      if (!isW(j, 'of')) return -1;
      j = skipThe(j + 1);
      if (isW(j, 'every')) j++;
      const u = unitAt(j);
      const isEnd = isW(i, 'end');
      if (u === 'month') {
        if (isEnd) sem.domLast = true;
        else sem.dom.add(1);
        sem.signals++;
        mark(i, j + 1, 'day');
        return j + 1;
      }
      if (u === 'week') {
        sem.dow.add(isEnd ? 5 : 1);
        sem.assumptions.push(isEnd ? 'End of the week = Friday.' : 'Start of the week = Monday.');
        sem.signals++;
        mark(i, j + 1, 'day');
        return j + 1;
      }
      if (u === 'year') {
        sem.months.add(isEnd ? 12 : 1);
        if (isEnd) sem.dom.add(31);
        else sem.dom.add(1);
        sem.signals++;
        mark(i, j + 1, 'day');
        return j + 1;
      }
      if (u === 'day') {
        sem.times.push(isEnd ? { h: 17, m: 0 } : { h: 9, m: 0 });
        sem.assumptions.push(isEnd ? 'End of day = 17:00.' : 'Start of day = 09:00.');
        sem.signals++;
        mark(i, j + 1, 'time');
        return j + 1;
      }
      return -1;
    }
    // last / first day of the month
    if (isW(i, 'last') || ordAt(i) === 1) {
      let j = i + 1;
      const what = w(j);
      if (unitAt(j) === 'day' || what === 'weekday' || what === 'business') {
        if (what === 'business') j++;
        j++;
        let k = j;
        if (isW(k, 'of', 'in')) {
          k = skipThe(k + 1);
          if (isW(k, 'every')) k++;
          if (unitAt(k) === 'month') k++;
          else if (monthIdx(k) < 0) return -1;
        }
        const last = isW(i, 'last');
        if (what === 'weekday' || what === 'business') {
          sem.warnings.push(`"${last ? 'last' : 'first'} weekday of the month" isn't expressible in standard cron; using the ${last ? 'last' : 'first'} calendar day instead.`);
        }
        if (last) sem.domLast = true;
        else addDom(1);
        sem.signals++;
        mark(i, k, 'day');
        return k;
      }
    }
    // Nth week of the month -> day ranges
    const o = ordAt(i);
    if (o !== null && o >= 1 && o <= 4 && unitAt(i + 1) === 'week') {
      let j = i + 2;
      if (isW(j, 'of', 'in')) {
        j = skipThe(j + 1);
        if (isW(j, 'every')) j++;
        if (unitAt(j) === 'month') j++;
      }
      for (let d = (o - 1) * 7 + 1; d <= o * 7; d++) addDom(d);
      sem.signals++;
      mark(i, j, 'day');
      return j;
    }
    // on the hour / on the half hour
    if (isW(i, 'on')) {
      let j = skipThe(i + 1);
      let off = 0;
      if (isW(j, 'half')) {
        off = 30;
        j++;
      } else if (isW(j, 'quarter')) {
        off = 15;
        j++;
      }
      if (unitAt(j) === 'hour') {
        sem.minuteOffsets.push(off);
        sem.signals++;
        mark(i, j + 1, 'time');
        return j + 1;
      }
    }
    // seasons
    const sv = w(i);
    if (sv && SEASONS[sv]) {
      for (const m of SEASONS[sv]) addMonth(m);
      sem.assumptions.push(`Seasons use the northern hemisphere (${sv}).`);
      sem.signals++;
      mark(i, i + 1, 'month');
      return i + 1;
    }
    return -1;
  };

  const ADVERB: Record<string, [Unit, number]> = {
    minutely: ['minute', 1],
    hourly: ['hour', 1],
    daily: ['day', 1],
    weekly: ['week', 1],
    monthly: ['month', 1],
    quarterly: ['month', 3],
    yearly: ['year', 1],
  };

  const mPerPeriod: Matcher = (i) => {
    let count: number | null = null;
    let j = i;
    if (isW(i, 'once')) count = 1;
    else if (isW(i, 'twice')) count = 2;
    else if (isW(i, 'thrice')) count = 3;
    else if (numAt(i) !== null && isW(i + 1, 'times')) {
      count = numAt(i);
      j++;
    }
    if (count === null) return -1;
    j++;
    if (isW(j, 'a', 'every')) j++;
    let unit = unitAt(j);
    const adv = w(j);
    if (!unit && adv && ADVERB[adv]) unit = ADVERB[adv][0];
    if (!unit) {
      if (isW(i, 'once')) return -1;
      return -1;
    }
    sem.perPeriod = { count, unit };
    sem.signals++;
    exclude = false;
    mark(i, j + 1, 'interval');
    return j + 1;
  };

  const mEvery: Matcher = (i) => {
    if (!isW(i, 'every')) return -1;
    let j = i + 1;
    let n = 1;
    const nv = numAt(j);
    const ov = ordAt(j);
    // "every other monday" / "every second tuesday" (biweekly, not expressible)
    if ((isW(j, 'other') || ov === 2 || isW(j, 'second')) && dayIdx(j + 1) >= 0 && !isW(j + 2, 'of', 'in')) {
      const d = dayIdx(j + 1);
      sem.dow.add(d);
      sem.biweekly = true;
      sem.signals++;
      mark(i, j + 2, 'interval');
      return j + 2;
    }
    if ((ov !== null || isW(j, 'second', 'last')) && dayIdx(j + 1) >= 0) {
      // "every first monday of the month" -> let the Nth-weekday matcher handle it
      mark(i, i + 1, 'interval');
      return i + 1;
    }
    if (nv !== null) {
      n = nv;
      j++;
      if (isW(j, 'of')) j++;
    } else if (isW(j, 'other')) {
      n = 2;
      j++;
    } else if (ov !== null && unitAt(j + 1)) {
      n = ov;
      j++;
    } else if (isW(j, 'second') && unitAt(j + 1)) {
      n = 2;
      j++;
    }
    if (isW(j, 'half')) {
      let k = j + 1;
      if (isW(k, 'a')) k++;
      const u = unitAt(k);
      if (u === 'hour') {
        sem.interval = { unit: 'minute', n: 30 };
        sem.signals++;
        exclude = false;
        mark(i, k + 1, 'interval');
        return k + 1;
      }
      if (u === 'day') {
        sem.interval = { unit: 'hour', n: 12 };
        sem.signals++;
        mark(i, k + 1, 'interval');
        return k + 1;
      }
    }
    if (isW(j, 'quarter')) {
      let k = j + 1;
      if (isW(k, 'of')) k++;
      if (isW(k, 'a')) k++;
      if (unitAt(k) === 'hour') {
        sem.interval = { unit: 'minute', n: 15 };
        sem.signals++;
        exclude = false;
        mark(i, k + 1, 'interval');
        return k + 1;
      }
      sem.interval = { unit: 'month', n: 3 };
      sem.signals++;
      mark(i, j + 1, 'interval');
      return j + 1;
    }
    const u = unitAt(j);
    if (u) {
      const prev = sem.interval;
      if (!prev || UNITS.indexOf(u) <= UNITS.indexOf(prev.unit)) sem.interval = { unit: u, n: Math.max(1, n) };
      sem.signals++;
      exclude = false;
      mark(i, j + 1, 'interval');
      return j + 1;
    }
    // "every 15th" (of the month) handled by dom matcher; "every monday" by day matcher
    mark(i, i + 1, 'interval');
    return i + 1;
  };

  const mAdverb: Matcher = (i) => {
    const v = w(i);
    if (!v || !ADVERB[v]) return -1;
    const [unit, n] = ADVERB[v];
    if (!sem.interval || sem.interval.unit === unit) sem.interval = { unit, n };
    sem.signals++;
    exclude = false;
    mark(i, i + 1, 'interval');
    return i + 1;
  };

  /** "15 minutes past every hour", "quarter past the hour", "at minute 5", "at :45" */
  const mMinuteOffset: Matcher = (i) => {
    let j = isW(i, 'at') ? i + 1 : i;
    let off: number | null = null;
    if (numAt(j) !== null && numAt(j)! < 60) {
      off = numAt(j);
      j++;
      if (unitAt(j) === 'minute') j++;
    } else if (isW(j, 'quarter')) {
      off = 15;
      j++;
    } else if (isW(j, 'half')) {
      off = 30;
      j++;
    }
    if (off !== null && isW(j, 'past', 'to')) {
      const to = isW(j, 'to');
      let k = skipThe(j + 1);
      if (isW(k, 'every', 'a')) k++;
      if (unitAt(k) === 'hour') {
        sem.minuteOffsets.push(to ? (60 - off) % 60 : off);
        if (!sem.interval) sem.interval = { unit: 'hour', n: 1 };
        sem.signals++;
        exclude = false;
        mark(i, k + 1, 'time');
        return k + 1;
      }
    }
    // at :15 [and :45]
    j = i;
    if (isW(j, 'at')) j++;
    if (unitAt(j) === 'minute' && numAt(j + 1) !== null && numAt(j + 1)! < 60) {
      sem.minuteOffsets.push(numAt(j + 1)!);
      sem.signals++;
      mark(i, j + 2, 'time');
      return j + 2;
    }
    if (T[j]?.k === 'minmark') {
      let k = j;
      while (T[k]?.k === 'minmark') {
        sem.minuteOffsets.push((T[k] as { v: number }).v);
        k++;
        if (isSep(k) && T[k + 1]?.k === 'minmark') k++;
      }
      sem.signals++;
      mark(i, k, 'time');
      return k;
    }
    return -1;
  };

  /** "for the first 15 minutes of every hour", "during the last 10 minutes of the hour" */
  const mMinuteWindow: Matcher = (i) => {
    let j = skipThe(i);
    const first = ordAt(j) === 1;
    const last = isW(j, 'last');
    if (!first && !last) return -1;
    const n = numAt(j + 1);
    if (n === null || n < 1 || n > 59 || unitAt(j + 2) !== 'minute') return -1;
    let k = j + 3;
    if (!isW(k, 'of', 'in')) return -1;
    k = skipThe(k + 1);
    if (isW(k, 'every', 'a')) k++;
    if (unitAt(k) !== 'hour') return -1;
    sem.minuteWindow = first ? [0, n - 1] : [60 - n, 59];
    sem.signals++;
    mark(i, k + 1, 'time');
    return k + 1;
  };

  const mNth: Matcher = (i) => {
    let j = skipThe(i);
    const ns: number[] = [];
    while (j < T.length) {
      const o = ordAt(j);
      if (o !== null && o >= 1 && o <= 5) ns.push(o);
      else if (isW(j, 'second')) ns.push(2);
      else if (isW(j, 'last')) ns.push(-1);
      else break;
      j++;
      if (isSep(j) && (ordAt(j + 1) !== null || isW(j + 1, 'last', 'second'))) j++;
      else break;
    }
    if (!ns.length) return -1;
    const days: number[] = [];
    while (dayIdx(j) >= 0) {
      days.push(dayIdx(j));
      j++;
      if (isSep(j) && dayIdx(j + 1) >= 0) j++;
      else break;
    }
    if (!days.length) return -1;
    if (isW(j, 'of', 'in')) {
      let k = skipThe(j + 1);
      if (isW(k, 'every')) k++;
      if (unitAt(k) === 'month') j = k + 1;
      else if (monthIdx(k) >= 0) j = j + 1;
    }
    for (const d of days) for (const n of ns) sem.nth.push(n === -1 ? `${d}L` : `${d}#${n}`);
    sem.signals++;
    mark(i, j, 'day');
    return j;
  };

  type Item =
    | { cat: 'day'; v: number; end: number }
    | { cat: 'month'; v: number; end: number }
    | { cat: 'dom'; v: number; end: number }
    | { cat: 'time'; tp: TP; end: number };

  const item = (j: number, allowBare: boolean): Item | null => {
    j = skipThe(j);
    const d = dayIdx(j);
    if (d >= 0) return { cat: 'day', v: d, end: j + 1 };
    const m = monthIdx(j);
    if (m >= 0) return { cat: 'month', v: m + 1, end: j + 1 };
    const o = ordAt(j);
    if (o !== null && o >= 1 && o <= 31) return { cat: 'dom', v: o, end: j + 1 };
    const tp = parseTime(j, allowBare);
    if (tp) return { cat: 'time', tp, end: tp.end };
    return null;
  };

  const applyWindow = (a: TP, b: TP) => {
    let am = a.mer;
    let bm = b.mer;
    let ah = a.h;
    let bh = b.h;
    if (!am && !bm && !a.clock && !b.clock) {
      // "9 to 5", "between 8 and 6"
      if (bh < ah && bh <= 12 && ah <= 12) bh += 12;
    } else if (!am && bm) {
      const b24 = to24(bh, bm);
      if (bm === 'pm' && ah < 12 && ah + 12 < b24) am = 'pm';
    } else if (am && !bm && !b.clock) {
      if (am === 'pm' && bh < 12) bm = 'pm';
      else if (am === 'am' && bh < ah) bm = 'pm';
    }
    const sh = a.clock || am ? to24(ah, am) : ah;
    const eh = b.clock || bm ? to24(bh, bm) : bh;
    sem.window = { sh, sm: a.m, eh: eh === 0 && b.m === 0 ? 24 : eh, em: b.m };
    sem.signals++;
  };

  const mRange: Matcher = (i) => {
    let j = i;
    let explicit = false;
    if (isW(j, 'between', 'from')) {
      j++;
      explicit = true;
    }
    const A = item(j, true);
    if (!A) return -1;
    let k = A.end;
    const conn = isW(k, 'to', 'until', 'through') || T[k]?.k === 'dash' || (explicit && isW(k, 'and'));
    if (!conn) return -1;
    const B = item(k + 1, true);
    if (!B || B.cat !== A.cat) return -1;
    if (A.cat === 'time' && !explicit && !A.tp.clock && !(B as { tp: TP }).tp.clock && T[k]?.k !== 'dash' && !isW(k, 'to', 'until')) return -1;
    const end = B.end;
    if (A.cat === 'time') {
      applyWindow(A.tp, (B as { tp: TP }).tp);
      exclude = false;
      mark(i, end, 'time');
      return end;
    }
    const a = A.v;
    const b = (B as { v: number }).v;
    if (A.cat === 'day') {
      for (let d = a, guard = 0; guard < 7; d = (d + 1) % 7, guard++) {
        addDow(d);
        if (d === b) break;
      }
      mark(i, end, 'day');
    } else if (A.cat === 'month') {
      for (let m = a, guard = 0; guard < 12; m = (m % 12) + 1, guard++) {
        addMonth(m);
        if (m === b) break;
      }
      mark(i, end, 'month');
    } else {
      for (let d = Math.min(a, b); d <= Math.max(a, b); d++) addDom(d);
      mark(i, end, 'day');
    }
    sem.signals++;
    return end;
  };

  /** "starting at 8am", "after 6pm", "until 17:00", "starting in march" */
  const mBoundary: Matcher = (i) => {
    if (isW(i, 'start') || (isW(i, 'from') && !isW(i + 1, 'the'))) {
      let j = i + 1;
      if (isW(j, 'at', 'from', 'on', 'in')) j++;
      const m = monthIdx(j);
      if (m >= 0) {
        sem.monthStart = m + 1;
        sem.signals++;
        mark(i, j + 1, 'month');
        return j + 1;
      }
      const tp = parseTime(j, true);
      if (tp) {
        const h = to24(tp.h, tp.mer);
        sem.hourStart = { h, m: tp.m };
        sem.signals++;
        exclude = false;
        mark(i, tp.end, 'time');
        return tp.end;
      }
      return isW(i, 'start') ? i + 1 : -1;
    }
    if (isW(i, 'past') && (i === 0 || (numAt(i - 1) === null && !isW(i - 1, 'half', 'quarter', 'minute')))) {
      const tp = parseTime(i + 1, true);
      if (tp) {
        const ctx = !tp.mer ? contextPart(tp.end) : null;
        const h = to24(tp.h, tp.mer ?? (ctx ? merFor(tp.h, ctx.part) : null));
        if (ctx && !tp.mer) noteNight(tp.h, tp.m, ctx.part);
        sem.window = { sh: h, sm: tp.m, eh: 24, em: 0 };
        sem.signals++;
        exclude = false;
        mark(i, ctx?.end ?? tp.end, 'time');
        return ctx?.end ?? tp.end;
      }
    }
    if (isW(i, 'until')) {
      const tp = parseTime(i + 1, true);
      if (tp) {
        const h = to24(tp.h, tp.mer);
        if (sem.hourStart) {
          sem.window = { sh: sem.hourStart.h, sm: sem.hourStart.m, eh: h, em: tp.m };
          sem.hourStart = null;
        } else sem.window = { sh: 0, sm: 0, eh: h, em: tp.m };
        sem.signals++;
        mark(i, tp.end, 'time');
        return tp.end;
      }
    }
    return -1;
  };

  const mTimes: Matcher = (i) => {
    let j = i;
    let bare = false;
    if (isW(j, 'at')) {
      j++;
      bare = true;
    }
    const first = parseTime(j, bare);
    if (!first) return bare ? i + 1 : -1;
    // "every hour at 15" -> minute offset
    if (bare && sem.interval?.unit === 'hour' && !first.clock && !first.mer && T[j]?.k === 'num' && first.end === j + 1) {
      sem.minuteOffsets.push(first.h);
      sem.signals++;
      mark(i, first.end, 'time');
      return first.end;
    }
    const tps: TP[] = [first];
    let k = first.end;
    while (isSep(k)) {
      const nx = parseTime(k + 1, true);
      if (!nx) break;
      tps.push(nx);
      k = nx.end;
    }
    const ctx = contextPart(k);
    if (ctx) {
      for (const tp of tps) {
        if (tp.mer || tp.fixed) continue;
        tp.mer = merFor(tp.h, ctx.part);
        if (tp.mer) noteNight(tp.h, tp.m, ctx.part);
      }
      k = ctx.end;
    }
    // shared trailing meridiem: "at 9 and 11 pm"
    const lastMer = tps[tps.length - 1].mer;
    if (lastMer) for (const tp of tps) if (!tp.mer && !tp.clock && tp.h <= tps[tps.length - 1].h) tp.mer = lastMer;
    pushTimes(tps);
    sem.signals++;
    exclude = false;
    mark(i, k, 'time');
    return k;
  };

  const mMonth: Matcher = (i) => {
    const m = monthIdx(i);
    if (m < 0) return -1;
    addMonth(m + 1);
    let j = i + 1;
    const n = numAt(j) ?? ordAt(j);
    if (n !== null && n >= 1 && n <= 31 && !isW(j + 1, 'am', 'pm', 'oclock', 'minute', 'hour')) {
      addDom(n);
      j++;
    }
    // "march, june and september"
    sem.signals++;
    mark(i, j, 'month');
    return j;
  };

  const mNumMonth: Matcher = (i) => {
    const n = numAt(i) ?? ordAt(i);
    if (n === null || n < 1 || n > 31) return -1;
    let j = i + 1;
    if (isW(j, 'of')) j++;
    if (monthIdx(j) < 0) return -1;
    addDom(n);
    sem.signals++;
    mark(i, j, 'day');
    return j; // month itself picked up by mMonth
  };

  const mDom: Matcher = (i) => {
    let j = i;
    const o = ordAt(j);
    if (o !== null && numAt(j + 1) === null) {
      if (o < 1 || o > 31) {
        sem.warnings.push(`There is no day ${o} in a month; ignored.`);
        return j + 1;
      }
      addDom(o);
      j++;
      if (unitAt(j) === 'day') j++;
      if (isW(j, 'of', 'in')) {
        let k = skipThe(j + 1);
        if (isW(k, 'every', 'a')) k++;
        if (unitAt(k) === 'month') j = k + 1;
      }
      sem.signals++;
      mark(i, j, 'day');
      return j;
    }
    // "day 15", "on the 15", "on day 15"
    if (unitAt(j) === 'day' && numAt(j + 1) !== null && numAt(j + 1)! >= 1 && numAt(j + 1)! <= 31) {
      addDom(numAt(j + 1)!);
      sem.signals++;
      mark(i, j + 2, 'day');
      return j + 2;
    }
    if (isW(j, 'on') && isThe(j + 1) && numAt(j + 2) !== null && !isW(j + 3, 'am', 'pm', 'oclock')) {
      const v = numAt(j + 2)!;
      if (v >= 1 && v <= 31) {
        addDom(v);
        sem.signals++;
        mark(i, j + 3, 'day');
        return j + 3;
      }
    }
    return -1;
  };

  const mDays: Matcher = (i) => {
    const v = w(i);
    if (v === 'weekday') {
      for (const d of [1, 2, 3, 4, 5]) addDow(d);
    } else if (v === 'weekend') {
      addDow(0);
      addDow(6);
    } else if (dayIdx(i) >= 0) {
      addDow(dayIdx(i));
    } else return -1;
    sem.signals++;
    mark(i, i + 1, 'day');
    return i + 1;
  };

  const mDayPart: Matcher = (i) => {
    const v = w(i);
    if (v === 'morning' || v === 'afternoon' || v === 'evening' || v === 'night') {
      sem.dayParts.push(v);
      sem.signals++;
      exclude = false;
      mark(i, i + 1, 'time');
      return i + 1;
    }
    if (v === 'noon' || v === 'midnight') return mTimes(i);
    return -1;
  };

  const mConnector: Matcher = (i) => {
    const t = T[i];
    if (t.k === 'w' && ['and', 'on', 'in', 'of', 'at', 'a', 'to', 'from', 'every', 'other', 'past'].includes(t.v)) {
      mark(i, i + 1, 'connector');
      return i + 1;
    }
    if (t.k === 'comma' || t.k === 'dash') {
      mark(i, i + 1, 'connector');
      return i + 1;
    }
    if (t.k === 'w' && unitAt(i)) {
      // lone unit word, e.g. "a day" inside "once a day" already consumed; otherwise informational
      mark(i, i + 1, 'connector');
      return i + 1;
    }
    return -1;
  };

  const matchers: Matcher[] = [
    mExcept, mSpecial, mPerPeriod, mEvery, mAdverb, mMinuteOffset, mMinuteWindow, mNth, mRange,
    mBoundary, mTimes, mMonth, mNumMonth, mDom, mDays, mDayPart, mConnector,
  ];

  let i = 0;
  while (i < T.length) {
    let next = -1;
    for (const m of matchers) {
      next = m(i);
      if (next > i) break;
    }
    i = next > i ? next : i + 1;
  }

  // Resolve bare hours like "at 11" using day-part context ("every night at 11" -> 23:00)
  if (ambiguous.length) {
    const part = sem.dayParts.find((p) => p !== 'morning') ?? sem.dayParts[0];
    for (const idx of ambiguous) {
      const t = sem.times[idx];
      if (part) {
        sem.times[idx] = { h: to24(t.h, merFor(t.h, part)), m: t.m };
        noteNight(t.h, t.m, part);
      } else if (t.h <= 11 && !clockIdx.has(idx)) {
        const hh = String(t.h).padStart(2, '0');
        sem.assumptions.push(`Read "${t.h}" as ${hh}:${String(t.m).padStart(2, '0')} (24-hour). Say "${t.h}pm" for the afternoon.`);
      }
    }
    // the day part only served as AM/PM context
    if (sem.dayParts.length) sem.dayParts = [];
  }
  return sem;
}
