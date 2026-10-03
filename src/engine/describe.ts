/**
 * Cron -> plain English. Works on any valid 5-field expression (plus L / # / nL).
 */
import { FieldName, splitCron } from './cron';

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function formatClock(h: number, m: number, hour12 = false): string {
  if (!hour12) return `${pad2(h)}:${pad2(m)}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad2(m)} ${suffix}`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

type Atom =
  | { kind: 'all' }
  | { kind: 'step'; from: number; to: number | null; step: number }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'value'; v: number }
  | { kind: 'raw'; text: string };

function atoms(field: string, fname: FieldName): Atom[] {
  if (field === '*' || field === '?') return [{ kind: 'all' }];
  return field.split(',').map((p): Atom => {
    const norm = (x: string) => {
      const n = parseInt(x, 10);
      if (Number.isNaN(n)) return NaN;
      return fname === 'dow' && n === 7 ? 0 : n;
    };
    const step = /^(\*|\d+)(?:-(\d+))?\/(\d+)$/.exec(p);
    if (step) {
      const from = step[1] === '*' ? (fname === 'dom' || fname === 'month' ? 1 : 0) : norm(step[1]);
      return { kind: 'step', from, to: step[2] ? norm(step[2]) : null, step: parseInt(step[3], 10) };
    }
    const range = /^(\d+)-(\d+)$/.exec(p);
    if (range) return { kind: 'range', from: norm(range[1]), to: norm(range[2]) };
    if (/^\d+$/.test(p)) return { kind: 'value', v: norm(p) };
    return { kind: 'raw', text: p };
  });
}

function valuesOf(field: string, fname: FieldName): number[] | null {
  const out: number[] = [];
  for (const a of atoms(field, fname)) {
    if (a.kind === 'value') out.push(a.v);
    else if (a.kind === 'range') for (let v = a.from; v <= a.to; v++) out.push(v);
    else return null;
  }
  return out;
}

function describeTime(minute: string, hour: string, hour12: boolean): string {
  const mins = valuesOf(minute, 'minute');
  const hrs = valuesOf(hour, 'hour');

  // Concrete clock times
  if (mins && hrs && mins.length * hrs.length <= 8) {
    const times: string[] = [];
    for (const h of hrs) for (const m of mins) times.push(formatClock(h, m, hour12));
    return 'At ' + joinAnd(times);
  }

  const minAtoms = atoms(minute, 'minute');
  const hourAtoms = atoms(hour, 'hour');
  let minPart: string;
  if (minAtoms[0].kind === 'all') minPart = 'Every minute';
  else if (minAtoms.length === 1 && minAtoms[0].kind === 'step') {
    const a = minAtoms[0];
    minPart = `Every ${a.step} minutes` + (a.to !== null ? ` from :${pad2(a.from)} to :${pad2(a.to)}` : a.from ? ` starting at :${pad2(a.from)}` : '');
  } else if (mins && mins.length === 1 && hourAtoms.length === 1 && hourAtoms[0].kind === 'range') minPart = 'Runs';
  else if (mins) minPart = mins.length === 1 ? `At minute ${mins[0]}` : `At minutes ${joinAnd(mins.map((m) => ':' + pad2(m)))}`;
  else minPart = `At minute ${minute}`;

  let hourPart = '';
  if (hourAtoms[0].kind === 'all') {
    if (minAtoms[0].kind !== 'all' && !(minAtoms[0].kind === 'step')) hourPart = ' of every hour';
  } else if (hourAtoms.length === 1 && hourAtoms[0].kind === 'step') {
    const a = hourAtoms[0];
    hourPart = `, every ${a.step} hours` + (a.from || (a.to !== null && a.to < 23) ? ` from ${formatClock(a.from, 0, hour12)}` : '') + (a.to !== null && a.to < 23 ? ` to ${formatClock(a.to, 0, hour12)}` : '');
  } else if (hourAtoms.length === 1 && hourAtoms[0].kind === 'range') {
    const { from, to } = hourAtoms[0];
    const fixedMin = mins && mins.length === 1 ? mins[0] : null;
    hourPart = fixedMin !== null
      ? `, every hour from ${formatClock(from, fixedMin, hour12)} through ${formatClock(to, fixedMin, hour12)}`
      : `, between ${formatClock(from, 0, hour12)} and ${formatClock(to, 59, hour12)}`;
  } else if (hrs) {
    hourPart = `, during the ${joinAnd(hrs.map((h) => formatClock(h, 0, hour12)))} hour${hrs.length > 1 ? 's' : ''}`;
  } else hourPart = `, hours ${hour}`;
  return (minPart + hourPart).replace(/^Runs, /, 'Runs ');
}

function describeDom(dom: string): string {
  if (dom === '*' || dom === '?') return '';
  const parts: string[] = [];
  for (const a of atoms(dom, 'dom')) {
    if (a.kind === 'raw' && a.text.toUpperCase() === 'L') parts.push('the last day');
    else if (a.kind === 'value') parts.push(`the ${ordinal(a.v)}`);
    else if (a.kind === 'range') parts.push(`the ${ordinal(a.from)} through the ${ordinal(a.to)}`);
    else if (a.kind === 'step') return `every ${a.step} days (counting from the ${ordinal(a.from)} of each month)`;
    else if (a.kind === 'raw') parts.push(a.text);
  }
  return 'on ' + joinAnd(parts) + ' of the month';
}

function describeDow(dow: string): string {
  if (dow === '*' || dow === '?') return '';
  const vals = valuesOf(dow, 'dow');
  if (vals) {
    const s = [...new Set(vals)].sort((a, b) => a - b);
    const key = s.join(',');
    if (key === '1,2,3,4,5') return 'on weekdays (Monday through Friday)';
    if (key === '0,6') return 'on weekends';
    if (key === '0,1,2,3,4,5,6') return '';
  }
  const parts: string[] = [];
  let ofMonth = false;
  for (const a of atoms(dow, 'dow')) {
    if (a.kind === 'value') parts.push(DAY_LABELS[a.v]);
    else if (a.kind === 'range') parts.push(`${DAY_LABELS[a.from]} through ${DAY_LABELS[a.to]}`);
    else if (a.kind === 'step') parts.push(`every ${a.step} days of the week`);
    else if (a.kind === 'raw') {
      const nth = /^(\d)#(\d)$/.exec(a.text);
      const last = /^(\d)L$/i.exec(a.text);
      if (nth) {
        parts.push(`the ${ORD[+nth[2]]} ${DAY_LABELS[+nth[1] % 7]}`);
        ofMonth = true;
      } else if (last) {
        parts.push(`the last ${DAY_LABELS[+last[1] % 7]}`);
        ofMonth = true;
      }
      else parts.push(a.text);
    }
  }
  return 'on ' + joinAnd(parts) + (ofMonth ? ' of the month' : '');
}

function describeMonth(month: string): string {
  if (month === '*' || month === '?') return '';
  const parts: string[] = [];
  for (const a of atoms(month, 'month')) {
    if (a.kind === 'value') parts.push(MONTH_LABELS[a.v - 1]);
    else if (a.kind === 'range') parts.push(`${MONTH_LABELS[a.from - 1]} through ${MONTH_LABELS[a.to - 1]}`);
    else if (a.kind === 'step') {
      return `every ${a.step} months` + (a.from > 1 ? ` starting in ${MONTH_LABELS[a.from - 1]}` : '');
    } else if (a.kind === 'raw') parts.push(a.text);
  }
  return 'in ' + joinAnd(parts);
}

function describeWith(f: CronFieldsLike, time: string): string {
  const dom = describeDom(f.dom);
  const dow = describeDow(f.dow);
  const month = describeMonth(f.month);
  const parts = [time];
  // "on December 25th" instead of "on the 25th of the month in December"
  const sd = /^\d+$/.test(f.dom) ? +f.dom : null;
  const sm = /^\d+$/.test(f.month) ? +f.month : null;
  if (sd && sm && (f.dow === '*' || f.dow === '?')) {
    return `${time} on ${MONTH_LABELS[sm - 1]} ${ordinal(sd)}`;
  }
  if (dom && dow) parts.push(`${dom} or ${dow}`);
  else if (dom) parts.push(dom);
  else if (dow) parts.push(dow);
  if (!dom && !dow && /^At \d/.test(time)) parts.push('every day');
  if (month) parts.push(month);
  return parts.join(', ').replace(/, (on|in|every day)/g, ' $1');
}

type CronFieldsLike = { minute: string; hour: string; dom: string; month: string; dow: string };

export function describeCron(expr: string, opts: { hour12?: boolean } = {}): string {
  const f = splitCron(expr);
  if (!f) return 'Invalid cron expression';
  return describeWith(f, describeTime(f.minute, f.hour, !!opts.hour12));
}

export function describeMany(exprs: string[], opts: { hour12?: boolean } = {}): string {
  if (!exprs.length) return '';
  if (exprs.length === 1) return describeCron(exprs[0], opts);
  const fs = exprs.map(splitCron);
  // Same days for every line and concrete clock times -> "At 09:15 and 17:45 on weekdays"
  if (fs.every((f) => f && f.dom === fs[0]!.dom && f.month === fs[0]!.month && f.dow === fs[0]!.dow)) {
    const times: [number, number][] = [];
    let concrete = true;
    for (const f of fs) {
      const ms = valuesOf(f!.minute, 'minute');
      const hs = valuesOf(f!.hour, 'hour');
      if (!ms || !hs) {
        concrete = false;
        break;
      }
      for (const h of hs) for (const m of ms) times.push([h, m]);
    }
    if (concrete && times.length <= 8) {
      times.sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
      return describeWith(fs[0]!, 'At ' + joinAnd(times.map(([h, m]) => formatClock(h, m, !!opts.hour12))));
    }
  }
  return exprs
    .map((e, i) => {
      const d = describeCron(e, opts);
      return i === 0 ? d : d[0].toLowerCase() + d.slice(1);
    })
    .join('; and ');
}
