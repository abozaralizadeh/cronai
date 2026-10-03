/**
 * CronAI engine: natural language -> cron, fully on-device.
 *
 *   text ─► tokenize ─► tiny neural normaliser (typos) ─► semantic interpreter ─► cron compiler
 *                                                                              └► describe + next runs
 */
import { tokenize, Piece, Correction } from './tokenize';
import { interpret } from './interpret';
import { compile } from './compile';
import { describeCron, describeMany } from './describe';
import { looksLikeCron, splitCron, validateCron, nextRunsMany, nextRunsGuarded, anchorFor, shellGuard, jsGuard, CronFields, joinCron, WeekGuard } from './cron';
import { DAY_LABELS, MONTH_LABELS, ordinal } from './describe';
import { MODEL_INFO } from './model/tinyModel';
import { isValidTimeZone, localTimeZone, wallClock } from './tz';
import type { SavedSchedule } from './schedule';

export interface ParseOptions {
  /** Allow L / # / nL cron extensions (Quartz, cron-parser, AWS, node-cron…). Default true. */
  allowExtensions?: boolean;
  /** 12-hour clock in descriptions. Default false. */
  hour12?: boolean;
  /**
   * IANA time zone the times are meant in (e.g. "Europe/Rome"). Default: the
   * runtime's zone. Set it on servers so a visitor's "9am" stays *their* 9am.
   */
  timezone?: string;
  /** Reference date for next runs. */
  now?: Date;
  /** How many upcoming runs to compute. Default 5. */
  nextCount?: number;
  /** Use the tiny neural model for typo-tolerant word understanding. Default true. */
  useModel?: boolean;
  /**
   * For "every N weeks": unix seconds of the week anchor (from a previously saved
   * result.guard.anchor) so the same weeks stay "on". Default: the first upcoming run's week.
   */
  anchor?: number;
}

export interface GuardInfo extends WeekGuard {
  /** First run that the guard lets through. */
  startsOn: Date | null;
  /** Prefix for a crontab line: `<cron> <shell> /path/to/command` (already escapes %). */
  shell: string;
  /** Ready-to-paste crontab lines with the guard and a placeholder command. */
  crontab: string[];
  /** Boolean JS expression for node-cron / croner / your own scheduler. */
  js: string;
}

export interface ParseResult {
  ok: boolean;
  input: string;
  source: 'natural' | 'cron' | 'none';
  crons: string[];
  fields: CronFields[];
  description: string;
  descriptions: string[];
  confidence: number;
  pieces: Piece[];
  corrections: Correction[];
  assumptions: string[];
  warnings: string[];
  nonStandard: boolean;
  nextRuns: { date: Date; cron: string }[];
  /** Set for "every N weeks" schedules: cron runs weekly, the guard skips the off weeks. */
  guard: GuardInfo | null;
  /** IANA zone used for next runs (and to store with the schedule). */
  timezone: string;
  /** Small JSON to store per user and run later with createTrigger / scheduleNextRuns. Null when not understood. */
  schedule: SavedSchedule | null;
  /** Pure-cron alternatives worth offering (e.g. 1st & 3rd Saturday for "every 2 weeks"). */
  alternatives: { cron: string; description: string }[];
  elapsedMs: number;
  error?: string;
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function fail(input: string, error: string, t0: number, extra: Partial<ParseResult> = {}): ParseResult {
  return {
    ok: false,
    input,
    source: 'none',
    crons: [],
    fields: [],
    description: '',
    descriptions: [],
    confidence: 0,
    pieces: [],
    corrections: [],
    assumptions: [],
    warnings: [],
    nonStandard: false,
    nextRuns: [],
    guard: null,
    alternatives: [],
    timezone: localTimeZone(),
    schedule: null,
    elapsedMs: now() - t0,
    error,
    ...extra,
  };
}

export function parseSchedule(input: string, opts: ParseOptions = {}): ParseResult {
  const t0 = now();
  const text = (input ?? '').trim();
  const nextCount = opts.nextCount ?? 5;
  const tz = isValidTimeZone(opts.timezone) ? opts.timezone : undefined;
  const timezone = tz ?? localTimeZone();
  if (!text) return fail(input, 'Describe a schedule, e.g. "every weekday at 9am".', t0);

  // Already a cron expression? Validate + explain it.
  if (looksLikeCron(text)) {
    const v = validateCron(text);
    if (!v.ok) return fail(input, v.error, t0, { source: 'cron' });
    const expr = joinCron(splitCron(text)!);
    return {
      ok: true,
      input,
      source: 'cron',
      crons: [expr],
      fields: [splitCron(expr)!],
      description: describeCron(expr, opts),
      descriptions: [describeCron(expr, opts)],
      confidence: 1,
      pieces: [{ text, role: 'time' }],
      corrections: [],
      assumptions: [],
      warnings: [],
      nonStandard: v.parsed.nonStandard,
      nextRuns: nextRunsMany([expr], nextCount, opts.now, tz),
      guard: null,
      alternatives: [],
      timezone,
      schedule: { v: 1, text, crons: [expr], timezone, description: describeCron(expr, opts) },
      elapsedMs: now() - t0,
    };
  }

  const tk = tokenize(text, { useModel: opts.useModel });
  const sem = interpret(tk);
  const out = compile(sem, opts);
  if (!out || !out.crons.length) {
    return fail(input, "I couldn't find a schedule in that. Try something like \"every 15 minutes during business hours\".", t0, {
      pieces: tk.pieces,
      corrections: tk.corrections,
    });
  }

  // Safety net: every produced line must be valid cron.
  for (const c of out.crons) {
    const v = validateCron(c);
    if (!v.ok) return fail(input, `Internal error building cron (${v.error})`, t0, { pieces: tk.pieces });
  }

  // Confidence: model certainty on corrected words x penalties for guesses.
  let conf = 0.98;
  for (const c of tk.corrections) conf *= Math.sqrt(c.prob);
  conf *= Math.pow(0.93, out.assumptions.length);
  conf *= Math.pow(0.85, out.warnings.length);
  const unknown = tk.toks.filter((t) => t.k === 'unk' && !t.stop).length;
  const meaningful = tk.pieces.filter((p) => p.role !== 'filler').length;
  if (unknown > 0) conf *= Math.max(0.75, meaningful / (meaningful + unknown * 0.35));
  conf = Math.max(0.05, Math.min(0.99, conf));

  const descriptions = out.crons.map((c) => describeCron(c, opts));
  let description = describeMany(out.crons, opts);
  const assumptions = [...out.assumptions];

  // every N weeks: weekly cron + week guard
  let guard: GuardInfo | null = null;
  const alternatives: { cron: string; description: string }[] = [];
  if (out.everyWeeks >= 2) {
    const n = out.everyWeeks;
    const first = nextRunsMany(out.crons, 1, opts.now, tz)[0];
    const anchor = opts.anchor ?? (first ? anchorFor(first.date, tz) : Math.floor(Date.now() / 1000));
    const g: WeekGuard = { everyWeeks: n, anchor };
    const startsOn = nextRunsGuarded(out.crons, g, 1, opts.now, tz)[0]?.date ?? null;
    guard = {
      ...g,
      startsOn,
      shell: shellGuard(g),
      crontab: out.crons.map((c) => `${c} ${shellGuard(g)} /path/to/your-command`),
      js: jsGuard(g),
    };
    const sw = startsOn ? wallClock(startsOn, tz) : null;
    const start = sw ? ` starting ${DAY_LABELS[sw.dow].slice(0, 3)} ${sw.d} ${MONTH_LABELS[sw.m - 1].slice(0, 3)}` : '';
    description = `${description}, every ${n === 2 ? 'other week' : `${n} weeks`}${start}`;
    assumptions.unshift(
      `Cron can't skip weeks: the cron line runs weekly and a week guard keeps every ${ordinal(n)} week${start ? `,${start}` : ''}. Use the guarded crontab line.`,
    );
    // a pure-cron look-alike for "every 2 weeks on <one day>"
    const f = splitCron(out.crons[0])!;
    if (n === 2 && out.crons.length === 1 && /^\d$/.test(f.dow) && f.dom === '*' && opts.allowExtensions !== false) {
      const alt = `${f.minute} ${f.hour} * ${f.month} ${f.dow}#1,${f.dow}#3`;
      alternatives.push({ cron: alt, description: `No guard needed: ${describeCron(alt, opts)} (twice a month, close to every 2 weeks; uses the # extension).` });
    }
  }

  return {
    ok: true,
    input,
    source: 'natural',
    crons: out.crons,
    fields: out.crons.map((c) => splitCron(c)!),
    description,
    descriptions,
    confidence: Math.round(conf * 100) / 100,
    pieces: tk.pieces,
    corrections: tk.corrections,
    assumptions,
    warnings: out.warnings,
    nonStandard: out.nonStandard,
    nextRuns: nextRunsGuarded(out.crons, guard, nextCount, opts.now, tz),
    guard,
    alternatives,
    timezone,
    schedule: {
      v: 1,
      text,
      crons: out.crons,
      timezone,
      description,
      ...(guard ? { everyWeeks: guard.everyWeeks, anchor: guard.anchor } : {}),
    },
    elapsedMs: now() - t0,
  };
}

export { describeCron, describeMany, MODEL_INFO };
export { validateCron, nextRuns, nextRunsMany, nextRunsGuarded, guardAllows, anchorFor, shellGuard, jsGuard, parseCron, splitCron, joinCron, compressList, FIELD_META, FIELD_ORDER } from './cron';
export type { CronFields, FieldName, WeekGuard } from './cron';
export type { Piece, Correction, Role } from './tokenize';
export { localTimeZone, isValidTimeZone, wallClock, fromWall } from './tz';
export { scheduleNextRuns, readSchedule, isSavedSchedule, guardOf } from './schedule';
export type { SavedSchedule } from './schedule';
export { createTrigger, toSavedSchedule } from './trigger';
export type { TriggerFire, TriggerOptions, TriggerHandle } from './trigger';
export { predictToken } from './model/tinyModel';
export { formatClock, ordinal, DAY_LABELS, MONTH_LABELS } from './describe';
