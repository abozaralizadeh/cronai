/**
 * Shared UI configuration for the React Native component and the <cron-ai> web widget:
 * which sections show, in which mode, and every visible string (so sites can
 * re-word or translate everything).
 */

export type Mode = 'developer' | 'user';
export type Size = 'mini' | 'compact' | 'full';

export const SECTIONS = [
  'badge', // "CronLex · on-device AI"
  'title', // heading
  'themes', // theme picker (React Native only)
  'input', // the text box
  'status', // "Understood in 2 ms" + Clear
  'chips', // colour-coded "what I understood"
  'tiles', // the 5 cron fields
  'cron', // the cron expression line
  'copy', // copy / share buttons
  'guard', // "every N weeks" crontab guard
  'description', // plain-English sentence
  'confidence', // confidence meter
  'notes', // assumptions + warnings
  'runs', // next run(s)
  'timezone', // "Times in Europe/Rome"
  'trigger', // arm switch + countdown
  'examples', // example chips
] as const;
export type Section = (typeof SECTIONS)[number];

const D: Record<Mode, Record<Size, Section[]>> = {
  developer: {
    mini: ['input', 'cron', 'copy', 'description'],
    compact: ['badge', 'input', 'status', 'chips', 'tiles', 'guard', 'description', 'confidence', 'runs'],
    full: ['badge', 'title', 'themes', 'input', 'status', 'chips', 'tiles', 'cron', 'copy', 'guard', 'description', 'confidence', 'notes', 'runs', 'trigger', 'examples'],
  },
  // for end users picking a frequency on your site: no cron jargon
  user: {
    mini: ['input', 'description', 'runs'],
    compact: ['input', 'chips', 'description', 'notes', 'runs'],
    full: ['title', 'input', 'status', 'chips', 'description', 'notes', 'runs', 'timezone', 'examples'],
  },
};

const asList = (v: string | readonly string[] | null | undefined): string[] =>
  !v ? [] : (typeof v === 'string' ? v.split(/[\s,|]+/) : [...v]).map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Default sections for a mode/size, then `show` adds and `hide` removes ("all" / "none" work too). */
export function resolveSections(mode: Mode, size: Size, show?: string | readonly string[] | null, hide?: string | readonly string[] | null): Set<Section> {
  const out = new Set<Section>(D[mode][size]);
  const sh = asList(show);
  const hi = asList(hide);
  if (sh.includes('only')) out.clear();
  for (const s of sh) if (s === 'all') SECTIONS.forEach((x) => out.add(x)); else if ((SECTIONS as readonly string[]).includes(s)) out.add(s as Section);
  for (const s of hi) if (s === 'all') out.clear(); else out.delete(s as Section);
  return out;
}

export const DEFAULT_STRINGS = {
  heading: 'Schedule',
  placeholder: 'Describe when it should run…',
  inputLabel: 'Schedule in plain English',
  badge: '{model} · on-device AI',
  understood: 'What I understood',
  nextRuns: 'Next runs',
  nextRun: 'Next run',
  trigger: 'Trigger',
  triggerArmed: 'Trigger armed',
  triggerHint: 'Fires a crontrigger event while this page is open',
  nextFire: 'Next fire {date}',
  fired: 'Fired {n}× · last {date}',
  try: 'Try',
  copy: 'Copy',
  copied: 'Copied',
  share: 'Share',
  copyLine: 'Copy line',
  selectCopy: 'Select + copy',
  clear: 'Clear',
  confidence: 'Confidence',
  waiting: 'Waiting for a description',
  understoodIn: 'Understood in {ms} ms',
  notUnderstood: 'Not understood yet',
  typeSchedule: 'type a schedule',
  example: 'e.g. every weekday at 9am',
  cronLines: '{n} cron lines',
  everyOtherWeek: 'Every other week',
  everyNWeeks: 'Every {n} weeks',
  from: 'from {date}',
  guardText: "Cron alone can't skip weeks, so this crontab line adds a week check. The trigger and next runs here already apply it.",
  guardLine: 'Cron runs weekly + a week guard keeps every {nth} week.',
  timezone: 'Times in {tz}',
  extNote: 'Uses the L / # extension (Quartz, cron-parser, AWS, node-cron). Not plain crontab.',
  roleInterval: 'frequency',
  roleTime: 'time',
  roleDay: 'day',
  roleMonth: 'month',
  roleExcept: 'except',
};
export type Strings = typeof DEFAULT_STRINGS;

const USER_STRINGS: Partial<Strings> = {
  heading: 'How often?',
  placeholder: 'e.g. every Monday at 9am',
  understood: 'Understood as',
  nextRuns: 'Coming up',
  nextRun: 'Next',
  understoodIn: 'Got it',
  waiting: 'Type how often, in your own words',
  notUnderstood: "Hmm, try something like 'every weekday at 9am'",
  try: 'Examples',
};

/** Defaults for the mode, then the site's overrides (any subset, e.g. a translation). */
export function resolveStrings(mode: Mode, overrides?: Partial<Strings> | string | null): Strings {
  let o: Partial<Strings> = {};
  if (typeof overrides === 'string') {
    try {
      o = JSON.parse(overrides);
    } catch {
      o = {};
    }
  } else if (overrides) o = overrides;
  return { ...DEFAULT_STRINGS, ...(mode === 'user' ? USER_STRINGS : {}), ...o };
}

/** "{n} cron lines" + {n: 2} -> "2 cron lines" */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Notes for end users: drop the technical ones and say "the schedule" instead of "cron". */
export function notesFor(mode: Mode, r: { assumptions: string[]; warnings: string[]; guard: unknown; nonStandard: boolean }, s: Strings): { text: string; warn: boolean }[] {
  const out: { text: string; warn: boolean }[] = [];
  if (mode === 'developer') {
    if (r.nonStandard) out.push({ text: s.extNote, warn: false });
    for (const w of r.warnings) out.push({ text: w, warn: true });
    for (const a of r.guard ? r.assumptions.slice(1) : r.assumptions) out.push({ text: a, warn: false });
    return out;
  }
  const plain = (t: string) =>
    t
      .replace(/\(crontab @weekly\)/g, '')
      .replace(/^Cron\b/, 'The schedule')
      .replace(/\b[Cc]ron\b/g, 'the schedule')
      .replace(/\s+\./g, '.')
      .replace(/\s{2,}/g, ' ');
  for (const w of r.warnings) if (!/day-of-month OR the weekday/.test(w)) out.push({ text: plain(w), warn: true });
  for (const a of r.guard ? r.assumptions.slice(1) : r.assumptions) if (!/extension|crontab line/i.test(a)) out.push({ text: plain(a), warn: false });
  return out;
}
