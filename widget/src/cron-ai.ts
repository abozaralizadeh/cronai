/**
 * <cron-ai>: embeddable, framework-free CronAI gadget.
 *
 *   <script src="cronai-widget.js"></script>
 *
 *   <!-- developers: get a cron line -->
 *   <cron-ai size="compact" value="every weekday at 9am"></cron-ai>
 *
 *   <!-- your visitors: pick a frequency, you get a schedule (no cron jargon) -->
 *   <cron-ai mode="user" size="compact" name="reminder" timezone="auto"></cron-ai>
 *
 * Everything is configurable: size, mode, which sections show (show / hide),
 * every string (strings='{"heading":"Wie oft?"}'), theme + CSS variables, time zone,
 * what the form submits, and an optional live trigger (crontrigger event).
 */
import {
  parseSchedule,
  ParseResult,
  FIELD_META,
  FIELD_ORDER,
  MODEL_INFO,
  formatClock,
  DAY_LABELS,
  MONTH_LABELS,
  createTrigger,
  readSchedule,
  wallClock,
  isValidTimeZone,
  localTimeZone,
  ordinal,
} from '../../src/engine';
import type { Piece, Role, SavedSchedule, TriggerHandle } from '../../src/engine';
import { fill, Mode, notesFor, resolveSections, resolveStrings, Section, Strings } from '../../src/ui/config';
import { BASE_CSS, themeCss } from './styles';

export type WidgetSize = 'mini' | 'compact' | 'full';

export interface CronChangeDetail {
  ok: boolean;
  text: string;
  /** first cron line (null when not understood) */
  cron: string | null;
  crons: string[];
  description: string;
  confidence: number;
  /** IANA zone the times are meant in */
  timezone: string;
  /** small JSON to store per user; run it later with CronAI.createTrigger(schedule, fn) */
  schedule: SavedSchedule | null;
  /** next run times */
  nextRuns: Date[];
  /** set for "every N weeks": cron runs weekly; guard.crontab / guard.js skip off weeks */
  guard: ParseResult['guard'];
  alternatives: ParseResult['alternatives'];
  result: ParseResult;
}

export interface TriggerDetail {
  date: Date;
  cron: string;
  schedule: SavedSchedule;
  count: number;
  late: boolean;
}

export const DEFAULT_EXAMPLES = [
  'every 15 minutes during business hours',
  'at 9:15 and 17:45 on weekdays',
  'last friday of every month at 6pm',
  'evrey wensday at half past 4 in the afternoon',
  'every two weeks on saturday at 10am',
  'first monday of each quarter at 9am',
  'twice a day on weekends',
];
export const USER_EXAMPLES = ['every morning', 'every weekday at 9am', 'every monday at 8:30', 'every other friday at 5pm', 'first day of every month', 'twice a week'];

const DOW3 = DAY_LABELS.map((d) => d.slice(0, 3));
const MON3 = MONTH_LABELS.map((m) => m.slice(0, 3));
/** Used by the time-zone picker when the browser can't list its zones. */
const FALLBACK_ZONES = [
  'UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Zurich', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Kyiv',
  'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Tehran',
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Shanghai',
  'Asia/Hong_Kong', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'America/Bogota', 'America/Toronto',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage',
  'Pacific/Honolulu',
];

type Attrs = Record<string, string | boolean | undefined | ((e: Event) => void)>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

function formatRun(d: Date, hour12: boolean, tz?: string): string {
  const w = wallClock(d, tz);
  const now = wallClock(new Date(), tz);
  const y = w.y !== now.y ? ` ${w.y}` : '';
  return `${DOW3[w.dow]} ${w.d} ${MON3[w.m - 1]}${y} · ${formatClock(w.h, w.mi, hour12)}`;
}

function relative(target: Date, now = Date.now()): string {
  let s = Math.max(0, Math.round((target.getTime() - now) / 1000));
  if (s < 60) return `in ${s}s`;
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const hr = Math.floor(s / 3600);
  s -= hr * 3600;
  const m = Math.floor(s / 60);
  if (d) return `in ${d}d ${hr}h`;
  if (hr) return `in ${hr}h ${m}m`;
  return `in ${m}m ${s % 60}s`;
}

function countdown(target: Date, now = Date.now()): string {
  let s = Math.max(0, Math.floor((target.getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const p = (n: number) => String(n).padStart(2, '0');
  return (d ? `${d}d ` : '') + `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const Base: typeof HTMLElement = typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as typeof HTMLElement);

export class CronAIElement extends Base {
  static formAssociated = true;
  static get observedAttributes() {
    return [
      'value', 'size', 'mode', 'theme', 'show', 'hide', 'strings', 'timezone', 'schedule', 'placeholder', 'heading',
      'hour12', 'extensions', 'examples', 'armed', 'next-count', 'disabled', 'required', 'must-understand', 'anchor', 'form-value',
    ];
  }

  private root: ShadowRoot;
  private internals: ElementInternals | null = null;
  private themeStyle: HTMLStyleElement;
  private card!: HTMLDivElement;
  private refs: Record<string, HTMLElement> = {};
  private text = '';
  private debounceT: ReturnType<typeof setTimeout> | undefined;
  private _result!: ParseResult;
  private activeLine = 0;
  private lastTiles: string[] = [];
  private armed = false;
  private armedAt = 0;
  private trigger: TriggerHandle | null = null;
  private tickT: ReturnType<typeof setInterval> | undefined;
  private fired: { date: Date; cron: string }[] = [];
  private built = false;
  private anchors = new Map<string, number>();
  private _strings: Partial<Strings> = {};
  private vis = new Set<Section>();
  private S: Strings = resolveStrings('developer');

  constructor() {
    super();
    // delegatesFocus: label clicks, el.focus() and clicks on the card land in the text box
    this.root = this.attachShadow({ mode: 'open', delegatesFocus: true });
    try {
      this.internals = (this as unknown as { attachInternals(): ElementInternals }).attachInternals();
    } catch {
      this.internals = null;
    }
    const base = document.createElement('style');
    base.textContent = BASE_CSS;
    this.themeStyle = document.createElement('style');
    this.root.append(base, this.themeStyle);
  }

  // ================================================================== public API
  /** The text the visitor typed. */
  get value(): string {
    return this.text;
  }
  set value(v: string) {
    this.setText(String(v ?? ''), true);
  }
  get result(): ParseResult {
    return this._result;
  }
  get crons(): string[] {
    return this._result?.ok ? this._result.crons : [];
  }
  get cron(): string | null {
    return this.crons[0] ?? null;
  }
  /** Storable JSON for this choice (null when not understood). Assign a saved one to restore it. */
  get schedule(): SavedSchedule | null {
    return this._result?.ok ? this._result.schedule : null;
  }
  set schedule(s: SavedSchedule | string | null) {
    const saved = readSchedule(s);
    if (!saved) return;
    this.restoring = saved;
    this.anchors.clear();
    if (saved.anchor) this.anchors.set(saved.text, saved.anchor);
    this.setText(saved.text, true);
  }
  get timezone(): string {
    return this.tz() ?? localTimeZone();
  }
  set timezone(tz: string) {
    this.setAttribute('timezone', tz);
  }
  get nextRuns(): Date[] {
    return this._result?.nextRuns.map((r) => r.date) ?? [];
  }
  get size(): WidgetSize {
    const s = this.getAttribute('size');
    return s === 'mini' || s === 'full' ? s : 'compact';
  }
  set size(s: WidgetSize) {
    this.setAttribute('size', s);
  }
  get mode(): Mode {
    return this.getAttribute('mode') === 'user' ? 'user' : 'developer';
  }
  set mode(m: Mode) {
    this.setAttribute('mode', m);
  }
  get theme(): string {
    return this.getAttribute('theme') ?? 'auto';
  }
  set theme(t: string) {
    this.setAttribute('theme', t);
  }
  /** Override any visible text (merged with the `strings` attribute). */
  get strings(): Strings {
    return this.S;
  }
  set strings(s: Partial<Strings>) {
    this._strings = { ...(s ?? {}) };
    if (this.built) this.rebuild();
  }
  get armedState(): boolean {
    return this.armed;
  }
  arm() {
    this.setArmed(true);
  }
  disarm() {
    this.setArmed(false);
  }
  override focus(options?: FocusOptions) {
    const input = this.refs.input as HTMLInputElement | undefined;
    if (input && !input.hidden && !input.disabled) input.focus(options);
    else super.focus(options);
  }

  /** A click on a non-interactive part of the card (padding, labels, chips) focuses the text box. */
  private onCardClick = (e: MouseEvent) => {
    for (const n of e.composedPath()) {
      if (n === this.card) break;
      if (n instanceof Element && n.matches('button, a, input, textarea, select, label, summary, [tabindex], code, .expr, .guard')) return;
    }
    const sel = (this.root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? document.getSelection();
    if (sel && !sel.isCollapsed && sel.toString()) return; // the visitor is selecting text
    this.focus({ preventScroll: true });
  };
  checkValidity() {
    return this.internals?.checkValidity() ?? true;
  }
  get validity(): ValidityState | undefined {
    return this.internals?.validity;
  }
  get validationMessage(): string {
    return this.internals?.validationMessage ?? '';
  }
  get willValidate(): boolean {
    return this.internals?.willValidate ?? false;
  }
  get form(): HTMLFormElement | null {
    return this.internals?.form ?? null;
  }
  reportValidity() {
    return this.internals?.reportValidity() ?? true;
  }

  private restoring: SavedSchedule | null = null;

  // ================================================================== lifecycle
  connectedCallback() {
    if (!this.built) {
      // parser-created elements get their attributes after the constructor runs
      const saved = readSchedule(this.getAttribute('schedule'));
      if (saved) {
        this.restoring = saved;
        if (saved.anchor) this.anchors.set(saved.text, saved.anchor);
        this.text = saved.text;
      } else {
        const attr = this.getAttribute('value');
        this.text = attr ?? (this.text || (this.size === 'mini' || this.mode === 'user' ? '' : 'every 15 minutes during business hours'));
      }
      this._result = this.parse();
    }
    this.applyTheme();
    this.rebuild();
    this.syncForm();
    if (this.hasAttribute('armed')) this.setArmed(true);
    // initial event, after listeners attached right after mount() / in the same tick
    queueMicrotask(() => this.emitChange());
  }

  disconnectedCallback() {
    this.stopTrigger();
    if (this.debounceT) clearTimeout(this.debounceT);
  }

  attributeChangedCallback(name: string, old: string | null, val: string | null) {
    if (old === val || !this.built) return;
    switch (name) {
      case 'value':
        if ((val ?? '') !== this.text) this.setText(val ?? '', false);
        break;
      case 'schedule':
        this.schedule = val;
        break;
      case 'theme':
        this.applyTheme();
        break;
      case 'size':
      case 'mode':
      case 'show':
      case 'hide':
      case 'strings':
      case 'heading':
      case 'examples':
      case 'placeholder':
        this._result = this.parse();
        this.rebuild();
        break;
      case 'anchor':
      case 'timezone':
        this.anchors.clear();
        this.reparse(false);
        break;
      case 'armed':
        this.setArmed(val !== null);
        break;
      case 'disabled':
        if (this.refs.input) (this.refs.input as HTMLInputElement).disabled = val !== null;
        if (this.refs.zoneSel) (this.refs.zoneSel as HTMLSelectElement).disabled = val !== null;
        break;
      case 'form-value':
      case 'required':
      case 'must-understand':
        this.syncForm();
        break;
      default:
        this.reparse(false);
    }
  }

  formResetCallback() {
    this.setText(this.getAttribute('value') ?? '', true);
  }

  formStateRestoreCallback(state: unknown) {
    if (typeof state === 'string') this.setText(state, true);
  }

  // ================================================================== parsing
  private tz(): string | undefined {
    if (this.restoring && !this.hasAttribute('timezone')) return this.restoring.timezone;
    const t = this.getAttribute('timezone');
    if (!t || t === 'auto' || t === 'local') return undefined;
    return isValidTimeZone(t) ? t : undefined;
  }

  /** Parse, pinning the "every N weeks" anchor per sentence so on-weeks never drift. */
  private parse(): ParseResult {
    const attr = Number(this.getAttribute('anchor'));
    const anchor = this.anchors.get(this.text) ?? (Number.isFinite(attr) && attr > 0 ? attr : undefined);
    const r = parseSchedule(this.text, { ...this.opts(), anchor, timezone: this.tz() });
    if (r.guard && !this.anchors.has(this.text)) this.anchors.set(this.text, r.guard.anchor);
    if (this.restoring && this.restoring.text !== this.text) this.restoring = null;
    return r;
  }

  private opts() {
    const def = this.size === 'full' ? 5 : this.size === 'compact' && this.mode === 'user' ? 3 : 1;
    return {
      allowExtensions: this.getAttribute('extensions') !== 'false',
      hour12: this.hasAttribute('hour12'),
      nextCount: Number(this.getAttribute('next-count') ?? def) || 1,
    };
  }

  private applyTheme() {
    this.themeStyle.textContent = themeCss(this.theme);
  }

  private setText(t: string, emitImmediately: boolean) {
    this.text = t;
    const input = this.refs.input as HTMLInputElement | HTMLTextAreaElement | undefined;
    if (input && input.value !== t) input.value = t;
    this.reparse(!emitImmediately);
  }

  private onInput = (e: Event) => {
    this.text = (e.target as HTMLInputElement).value;
    this.card.querySelector('.inbox')?.classList.add('thinking');
    this.reparse(true);
  };

  private reparse(debounced: boolean) {
    if (this.debounceT) clearTimeout(this.debounceT);
    const run = () => {
      this.card?.querySelector('.inbox')?.classList.remove('thinking');
      this._result = this.parse();
      this.activeLine = 0;
      this.render(true);
      this.syncForm();
      if (this.armed) this.startTrigger();
      this.emitChange();
    };
    if (debounced) this.debounceT = setTimeout(run, 180);
    else run();
  }

  private emitChange() {
    const r = this._result;
    this.dispatchEvent(
      new CustomEvent<CronChangeDetail>('cronchange', {
        bubbles: true,
        composed: true,
        detail: {
          ok: r.ok,
          text: this.text,
          cron: r.ok ? r.crons[0] : null,
          crons: r.ok ? r.crons : [],
          description: r.description,
          confidence: r.confidence,
          timezone: r.timezone,
          schedule: r.ok ? r.schedule : null,
          nextRuns: r.nextRuns.map((x) => x.date),
          guard: r.guard,
          alternatives: r.alternatives,
          result: r,
        },
      }),
    );
  }

  /**
   * Form value. `name` gets form-value="cron" (default: cron line(s)), "json" (the
   * SavedSchedule), "text" (what was typed) or "description". With a `name`, the form
   * also always gets `<name>-text` (what was typed, even when empty or not understood)
   * and, when understood, `<name>-json` (the full SavedSchedule).
   *
   * Validation: `required` = must be filled in AND understood. `must-understand` =
   * may stay empty, but if something is typed it has to be understood.
   */
  private syncForm() {
    if (!this.internals) return;
    const r = this._result;
    try {
      const name = this.getAttribute('name');
      const kind = this.getAttribute('form-value') ?? 'cron';
      const primary = !r.ok ? '' : kind === 'json' ? JSON.stringify(r.schedule) : kind === 'text' ? this.text : kind === 'description' ? r.description : r.crons.join('\n');
      if (name) {
        const fd = new FormData();
        fd.append(name, primary);
        fd.append(`${name}-text`, this.text);
        if (r.ok && kind !== 'json') fd.append(`${name}-json`, JSON.stringify(r.schedule));
        this.internals.setFormValue(fd, this.text);
      } else this.internals.setFormValue(primary, this.text);
      const empty = !this.text.trim();
      const anchor = this.refs.input;
      if (empty && this.hasAttribute('required')) {
        this.internals.setValidity({ valueMissing: true }, this.S.requiredMsg, anchor);
      } else if (!empty && !r.ok && (this.hasAttribute('required') || this.hasAttribute('must-understand'))) {
        this.internals.setValidity({ badInput: true }, r.error ?? this.S.notUnderstood, anchor);
      } else this.internals.setValidity({});
    } catch {
      /* older browsers */
    }
  }

  /** Optional time-zone picker (section "zone"): changing it re-times the schedule and the form value. */
  private zonePicker(disabled: boolean): HTMLElement {
    const S = this.S;
    const local = localTimeZone();
    let zones: string[] = [];
    try {
      zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      zones = [];
    }
    if (!zones.length) zones = FALLBACK_ZONES;
    const cur = this.tz();
    const list = [...new Set(['UTC', ...zones, ...(cur ? [cur] : [])])].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
    const sel = h('select', {
      part: 'zone-select',
      'aria-label': S.zone,
      disabled,
      onchange: (e: Event) => this.setAttribute('timezone', (e.target as HTMLSelectElement).value || 'auto'),
    }) as HTMLSelectElement;
    sel.append(h('option', { value: '' }, fill(S.zoneLocal, { tz: local.replace(/_/g, ' ') })));
    for (const z of list) sel.append(h('option', { value: z }, z.replace(/_/g, ' ')));
    sel.value = cur ?? '';
    this.refs.zoneSel = sel;
    return h('label', { class: 'zone', part: 'zone' }, h('span', { class: 'label' }, S.zone), sel);
  }

  // ================================================================== DOM
  private rebuild() {
    this.S = resolveStrings(this.mode, { ...this.attrStrings(), ...this._strings });
    this.vis = resolveSections(this.mode, this.size, this.getAttribute('show'), this.getAttribute('hide'));
    this.build();
    this.card.addEventListener('click', this.onCardClick);
    this.render(false);
    this.renderTrigger();
  }

  private attrStrings(): Partial<Strings> {
    const out: Partial<Strings> = {};
    try {
      Object.assign(out, JSON.parse(this.getAttribute('strings') ?? '{}'));
    } catch {
      /* invalid JSON: ignore */
    }
    const hd = this.getAttribute('heading');
    const ph = this.getAttribute('placeholder');
    if (hd) out.heading = hd;
    if (ph) out.placeholder = ph;
    return out;
  }

  private on(s: Section) {
    return this.vis.has(s);
  }

  private build() {
    this.card?.remove();
    this.refs = {};
    this.lastTiles = [];
    const S = this.S;
    const size = this.size;
    const r = this.refs;
    const disabled = this.hasAttribute('disabled');
    const user = this.mode === 'user';

    // ---------------------------------------------------------------- mini
    if (size === 'mini') {
      r.input = h('input', { class: 'line', type: 'text', placeholder: S.placeholder, 'aria-label': S.inputLabel, autocomplete: 'off', spellcheck: 'false', part: 'input', disabled, oninput: this.onInput, hidden: !this.on('input') });
      (r.input as HTMLInputElement).value = this.text;
      r.copy = h('button', { class: 'copy', type: 'button', part: 'copy', onclick: () => this.copy() }, S.copy);
      r.code = h('code', { part: 'cron' });
      r.mdesc = h('span', { class: `md${user ? ' strong' : ''}`, part: 'description' });
      r.mrun = h('span', { class: 'mrun', part: 'runs' });
      r.out = h('div', { class: 'out', 'aria-live': 'polite' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
        this.on('cron') ? r.code : null, this.on('description') ? r.mdesc : null, this.on('runs') ? r.mrun : null);
      this.card = h('div', { class: `card mini inbox ${this.mode}`, part: 'card' },
        h('div', { class: 'inrow' }, r.input, this.on('copy') ? r.copy : null), r.out, this.on('zone') ? this.zonePicker(disabled) : null);
      this.root.append(this.card);
      this.built = true;
      return;
    }

    // ---------------------------------------------------------------- compact / full
    const full = size === 'full';
    r.input = h('textarea', { rows: '2', placeholder: S.placeholder, 'aria-label': S.inputLabel, spellcheck: 'false', part: 'input', disabled, oninput: this.onInput });
    (r.input as HTMLTextAreaElement).value = this.text;
    r.statusMsg = h('span', { class: 'msg' });
    r.status = h('div', { class: 'status', part: 'status' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), r.statusMsg,
      h('button', { class: 'linkbtn', type: 'button', onclick: () => { this.setText('', true); this.focus(); } }, S.clear));
    r.chips = h('div', { class: 'chips' });
    r.chipsSec = h('div', { class: 'section', part: 'chips' }, full ? h('div', { class: 'label' }, S.understood) : null, r.chips);
    r.lines = h('div', { class: 'head', hidden: true });
    r.tiles = h('div', { class: 'tiles', part: 'tiles' });
    r.desc = h('div', { class: `desc${user ? ' big' : ''}`, part: 'description' });
    r.bar = h('i');
    r.confVal = h('b');
    r.notes = h('div', { class: 'notes', part: 'notes' });
    r.tzLine = h('div', { class: 'tzline', part: 'timezone' });

    const badge = h('span', { class: 'badge', part: 'badge', title: `${MODEL_INFO.name}: ${MODEL_INFO.params.toLocaleString()} parameters, runs in your browser` }, h('span', { class: 'dot' }), fill(S.badge, { model: MODEL_INFO.name }));
    const title = h('h3', { class: 'title', part: 'title' }, S.heading);
    const headKids = [this.on('title') ? title : null, this.on('badge') ? badge : null].filter(Boolean) as Node[];
    const head = headKids.length ? h('div', { class: 'head' }, ...headKids) : null;

    const kids: (Node | null)[] = [head];
    if (this.on('input')) kids.push(h('div', { class: 'inbox' }, r.input, this.on('status') ? r.status : null));
    if (this.on('zone')) kids.push(this.zonePicker(disabled));
    if (this.on('chips')) kids.push(r.chipsSec);

    // result block
    const res: (Node | null)[] = [r.lines];
    if (this.on('tiles')) res.push(r.tiles);
    if (this.on('cron') || (this.on('copy') && full)) {
      r.code = h('code', { part: 'cron' });
      r.copy = h('button', { class: 'pill', type: 'button', part: 'copy', onclick: () => this.copy() }, S.copy);
      res.push(h('div', { class: 'expr' }, this.on('cron') ? r.code : h('span', { style: 'flex:1' }), this.on('copy') ? r.copy : null));
    }
    if (this.on('guard')) {
      if (full) {
        r.guardLbl = h('span', { class: 'label', style: 'color:var(--cai-f4);flex:1' });
        r.guardCopy = h('button', { class: 'pill', type: 'button', onclick: () => this.copy('guard') }, S.copyLine);
        r.guardCode = h('code', { class: 'gcode' });
        r.guard = h('div', { class: 'guard', part: 'guard', hidden: true }, h('div', { class: 'ghead' }, r.guardLbl, r.guardCopy), h('div', { class: 'gtext' }, S.guardText), r.guardCode);
      } else r.guard = h('div', { class: 'gline', part: 'guard', hidden: true });
      res.push(r.guard);
    }
    if (this.on('description')) res.push(r.desc);
    if (this.on('confidence')) res.push(h('div', { class: 'conf', part: 'confidence' }, h('span', {}, S.confidence), h('span', { class: 'bar' }, r.bar), r.confVal));
    if (this.on('notes')) res.push(r.notes);
    if (this.on('timezone')) res.push(r.tzLine);
    r.out = h('div', { class: 'section' }, ...res);
    kids.push(r.out);

    if (this.on('runs')) {
      const many = (this.opts().nextCount ?? 1) > 1;
      if (many) {
        r.runs = h('ol', { class: 'runs' });
        kids.push(h('div', { class: 'section', part: 'runs' }, h('div', { class: 'label' }, S.nextRuns), r.runs));
      } else {
        r.next = h('div', { class: 'nextline', part: 'runs' });
        kids.push(r.next);
      }
    }

    if (this.on('trigger')) {
      r.trigT = h('span', { class: 't' }, S.trigger);
      r.trigS = h('span', { class: 's' }, S.triggerHint);
      r.switch = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': S.trigger, onclick: () => this.setArmed(!this.armed) });
      r.count = h('div', { class: 'count', hidden: true });
      r.progI = h('i');
      r.prog = h('div', { class: 'prog', hidden: true }, r.progI);
      r.fired = h('div', { class: 'fired', hidden: true });
      r.trig = h('div', { class: 'trig', part: 'trigger' }, h('div', { class: 'row' }, h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:2px' }, r.trigT, r.trigS), r.switch), r.count, r.prog, r.fired);
      kids.push(r.trig);
    }

    if (this.on('examples')) {
      const ex = this.examples();
      if (ex.length) {
        kids.push(h('div', { class: 'section', part: 'examples' }, h('div', { class: 'label' }, S.try),
          h('div', { class: 'ex' }, ...ex.map((e) => h('button', { type: 'button', onclick: () => this.setText(e, true) }, e)))));
      }
    }

    this.card = h('div', { class: `card ${size} ${this.mode}`, part: 'card' }, ...kids);
    this.root.append(this.card);
    this.built = true;
  }

  private examples(): string[] {
    const a = this.getAttribute('examples');
    if (a === 'false' || a === 'none') return [];
    if (a) return a.split('|').map((s) => s.trim()).filter(Boolean);
    return this.mode === 'user' ? USER_EXAMPLES : DEFAULT_EXAMPLES;
  }

  private render(animate: boolean) {
    if (!this.built) return;
    const r = this.refs;
    const res = this._result;
    const S = this.S;
    const hour12 = this.hasAttribute('hour12');
    const tz = this.tz();
    const empty = !this.text.trim();
    if (r.zoneSel && (r.zoneSel as HTMLSelectElement).value !== (tz ?? '')) (r.zoneSel as HTMLSelectElement).value = tz ?? '';

    if (this.size === 'mini') {
      r.out.classList.toggle('err', !res.ok && !empty);
      r.code.textContent = res.ok ? res.crons.join('  |  ') : empty ? S.typeSchedule : S.notUnderstood;
      r.mdesc.textContent = res.ok ? res.description : empty ? S.example : this.on('cron') ? '' : S.notUnderstood;
      const n = res.ok ? res.nextRuns[0] : null;
      r.mrun.textContent = n ? `${S.nextRun}: ${formatRun(n.date, hour12, tz)}` : '';
      r.out.title = res.ok ? `${res.crons.join('\n')}\n${res.description}${res.guard ? `\n\n${res.guard.crontab.join('\n')}` : ''}` : res.error ?? '';
      (r.copy as HTMLButtonElement).disabled = !res.ok;
      return;
    }

    // status line
    if (r.status) {
      r.status.classList.toggle('err', !res.ok && !empty);
      r.statusMsg.textContent = empty ? S.waiting : res.ok ? fill(S.understoodIn, { ms: Math.max(1, Math.round(res.elapsedMs)) }) : this.mode === 'user' ? S.notUnderstood : res.error ?? S.notUnderstood;
    }

    // chips
    r.chips.replaceChildren(...this.chipNodes(res.pieces));
    r.chipsSec.hidden = !(res.source === 'natural' && res.pieces.length);

    r.out.style.opacity = res.ok ? '1' : '0.45';
    if (!res.ok) {
      if (this.mode === 'user') {
        r.desc.textContent = empty ? '' : S.notUnderstood;
        r.out.style.opacity = '1';
      }
      if (r.runs) r.runs.replaceChildren();
      if (r.next) r.next.replaceChildren();
      return;
    }

    // multiple cron lines (developer view)
    const idx = Math.min(this.activeLine, res.crons.length - 1);
    const showLines = res.crons.length > 1 && (this.on('tiles') || this.on('cron'));
    r.lines.hidden = !showLines;
    if (showLines) {
      const kids: Node[] = [h('span', { class: 'label' }, fill(S.cronLines, { n: res.crons.length }))];
      if (this.on('tiles')) {
        kids.push(h('span', { style: 'display:flex;gap:6px' }, ...res.crons.map((_, i) =>
          h('button', { class: `pill${i === idx ? ' on' : ''}`, type: 'button', onclick: () => { this.activeLine = i; this.render(false); } }, `#${i + 1}`))));
      }
      r.lines.replaceChildren(...kids);
    }

    // tiles
    if (this.on('tiles')) {
      const f = res.fields[idx];
      const vals = FIELD_ORDER.map((k) => f[k]);
      r.tiles.replaceChildren(
        ...FIELD_ORDER.map((k, i) => {
          const v = vals[i];
          const tile = h('div', { class: `tile${v === '*' ? ' any' : ''}`, style: `--tc:var(--cai-f${i})`, title: FIELD_META[k].label },
            h('span', { class: 'v', style: v.length > 6 ? `font-size:${v.length > 9 ? 11 : 13}px` : undefined }, v), h('span', { class: 'k' }, FIELD_META[k].short));
          if (animate && this.lastTiles[i] !== undefined && this.lastTiles[i] !== v) {
            tile.classList.add('pop');
            tile.style.animationDelay = `${i * 35}ms`;
          }
          return tile;
        }),
      );
      this.lastTiles = vals;
    }

    if (r.code) r.code.textContent = res.crons.join('\n');
    r.desc.textContent = res.description;

    // every N weeks
    const g = res.guard;
    if (r.guard) {
      r.guard.hidden = !g;
      if (g) {
        const lbl = (g.everyWeeks === 2 ? S.everyOtherWeek : fill(S.everyNWeeks, { n: g.everyWeeks })) + (g.startsOn ? ` · ${fill(S.from, { date: formatRun(g.startsOn, hour12, tz) })}` : '');
        if (r.guardCode) {
          r.guardLbl.textContent = lbl;
          r.guardCode.textContent = g.crontab.join('\n');
        } else r.guard.textContent = fill(S.guardLine, { nth: ordinal(g.everyWeeks), n: g.everyWeeks });
      }
    }

    // confidence
    if (r.bar) {
      const c = res.confidence;
      r.bar.style.width = `${Math.round(c * 100)}%`;
      r.bar.style.background = c >= 0.9 ? 'var(--cai-success)' : c >= 0.7 ? 'var(--cai-warning)' : 'var(--cai-danger)';
      r.confVal.textContent = `${Math.round(c * 100)}%`;
      r.confVal.style.color = r.bar.style.background;
    }

    // notes (+ alternatives for developers)
    const notes = notesFor(this.mode, res, S).map((n) => this.note(n.text, n.warn));
    if (this.mode === 'developer' && this.size === 'full') for (const a of res.alternatives) notes.push(this.note(`${a.cron} · ${a.description}`, false));
    r.notes.replaceChildren(...notes);
    r.notes.hidden = !notes.length;

    r.tzLine.textContent = fill(S.timezone, { tz: res.timezone.replace(/_/g, ' ') });

    // runs
    if (r.next) {
      const n = res.nextRuns[0];
      r.next.replaceChildren(...(n ? [h('span', {}, S.nextRun), h('b', {}, formatRun(n.date, hour12, tz)), h('span', {}, relative(n.date))] : []));
    }
    if (r.runs) {
      const now = Date.now();
      r.runs.replaceChildren(
        ...res.nextRuns.map((run, i) =>
          h('li', {}, h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'd' }, formatRun(run.date, hour12, tz)),
            res.crons.length > 1 && this.mode === 'developer' ? h('span', { style: `color:var(--cai-f${res.crons.indexOf(run.cron) % 5});font:600 11px var(--cai-mono)` }, `#${res.crons.indexOf(run.cron) + 1}`) : null,
            h('span', { class: 'rel' }, relative(run.date, now)))),
      );
    }
    if (r.switch) (r.switch as HTMLButtonElement).disabled = !res.ok;
  }

  private note(text: string, warn: boolean): HTMLElement {
    return h('div', { class: `note${warn ? ' warn' : ''}` }, h('i', {}, warn ? '!' : 'i'), h('span', {}, text));
  }

  private chipNodes(pieces: Piece[]): Node[] {
    const S = this.S;
    const roleLabel: Partial<Record<Role, string>> = { interval: S.roleInterval, time: S.roleTime, day: S.roleDay, month: S.roleMonth, except: S.roleExcept };
    const roleAt = (i: number, dir: 1 | -1): Role | null => {
      for (let k = i + dir; k >= 0 && k < pieces.length; k += dir) if (pieces[k].role !== 'connector') return pieces[k].role;
      return null;
    };
    const groups: { role: Role; items: Piece[] }[] = [];
    pieces.forEach((p, i) => {
      let role: Role = p.role;
      if (role === 'connector') {
        const a = roleAt(i, -1);
        role = a && a === roleAt(i, 1) && a !== 'filler' ? a : 'filler';
      }
      const last = groups[groups.length - 1];
      if (last && last.role === role && role !== 'filler') last.items.push(p);
      else groups.push({ role, items: [p] });
    });
    const out: Node[] = [];
    for (const g of groups) {
      if (g.role === 'filler') {
        for (const p of g.items) out.push(h('span', { class: 'filler' }, p.text));
        continue;
      }
      const words: (Node | string)[] = [];
      g.items.forEach((p, j) => {
        if (j) words.push(' ');
        if (p.corrected) words.push(h('s', {}, p.text), ' ', h('span', { class: 'fix' }, p.corrected));
        else words.push(p.text);
      });
      out.push(h('span', { class: 'chip', style: `--rc:var(--cai-r-${g.role})` }, h('span', {}, ...words), h('span', { class: 'role' }, roleLabel[g.role] ?? '')));
    }
    return out;
  }

  private async copy(what: 'cron' | 'guard' = 'cron') {
    const text = what === 'guard' && this._result.guard ? this._result.guard.crontab.join('\n') : this.crons.join('\n');
    if (!text) return;
    const btn = what === 'guard' ? this.refs.guardCopy : this.refs.copy;
    const label = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = this.S.copied;
      btn.classList.add('on');
    } catch {
      const code = what === 'guard' ? this.refs.guardCode : this.refs.code;
      if (code) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      btn.textContent = this.S.selectCopy;
    }
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove('on');
    }, 1400);
  }

  // ================================================================== trigger
  private setArmed(on: boolean) {
    on = on && !!this._result?.ok;
    if (on === this.armed) return;
    this.armed = on;
    if (on) {
      this.startTrigger();
      if (this.refs.trig) this.tickT = setInterval(() => this.renderTrigger(), 1000);
    } else this.stopTrigger();
    this.renderTrigger();
  }

  private startTrigger() {
    this.trigger?.stop();
    this.armedAt = Date.now();
    if (!this._result.ok || !this._result.schedule) return;
    this.trigger = createTrigger(this._result.schedule, (e) => {
      this.fired.unshift({ date: e.date, cron: e.cron });
      this.fired.length = Math.min(this.fired.length, 20);
      this.armedAt = Date.now();
      this.card.classList.remove('flash');
      void this.card.offsetWidth;
      this.card.classList.add('flash');
      this.dispatchEvent(new CustomEvent<TriggerDetail>('crontrigger', { bubbles: true, composed: true, detail: { date: e.date, cron: e.cron, schedule: e.schedule, count: e.count, late: e.late } }));
      this.renderTrigger();
    });
  }

  private stopTrigger() {
    this.trigger?.stop();
    this.trigger = null;
    if (this.tickT) clearInterval(this.tickT);
    this.tickT = undefined;
  }

  private renderTrigger() {
    const r = this.refs;
    if (!r.trig) return;
    const S = this.S;
    const hour12 = this.hasAttribute('hour12');
    const tz = this.tz();
    const next = this.trigger?.next() ?? null;
    r.trig.classList.toggle('armed', this.armed);
    r.switch.setAttribute('aria-checked', String(this.armed));
    r.trigT.textContent = this.armed ? S.triggerArmed : S.trigger;
    r.trigS.textContent = this.armed && next ? fill(S.nextFire, { date: formatRun(next, hour12, tz) }) : S.triggerHint;
    const show = this.armed && !!next;
    r.count.hidden = r.prog.hidden = !show;
    if (show && next) {
      const now = Date.now();
      r.count.textContent = countdown(next, now);
      const total = next.getTime() - this.armedAt;
      r.progI.style.width = `${total <= 0 ? 100 : Math.min(100, Math.max(0, ((now - this.armedAt) / total) * 100))}%`;
    }
    r.fired.hidden = !this.fired.length;
    if (this.fired.length) r.fired.textContent = fill(S.fired, { n: this.fired.length, date: formatRun(this.fired[0].date, hour12, tz) });
  }
}

/** Register <cron-ai> (idempotent). */
export function define(tag = 'cron-ai') {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) customElements.define(tag, CronAIElement);
}

export interface MountOptions {
  size?: WidgetSize;
  mode?: Mode;
  theme?: string;
  value?: string;
  /** restore a saved choice (SavedSchedule or its JSON) */
  schedule?: SavedSchedule | string;
  name?: string;
  formValue?: 'cron' | 'json' | 'text' | 'description';
  /** must be filled in and understood */
  required?: boolean;
  /** may stay empty, but typed text must be understood */
  mustUnderstand?: boolean;
  timezone?: string;
  placeholder?: string;
  heading?: string;
  hour12?: boolean;
  extensions?: boolean;
  examples?: string[] | false;
  /** sections to add / remove, e.g. show: ['runs'], hide: ['badge', 'confidence'] */
  show?: string[];
  hide?: string[];
  /** override / translate any text */
  strings?: Partial<Strings>;
  nextCount?: number;
  armed?: boolean;
  onChange?: (d: CronChangeDetail) => void;
  onTrigger?: (d: TriggerDetail) => void;
}

/** Imperative mount for sites that prefer JS over HTML tags. */
export function mount(target: string | Element, o: MountOptions = {}): CronAIElement {
  define();
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error(`CronAI.mount: target ${String(target)} not found`);
  const el = document.createElement('cron-ai') as CronAIElement;
  const set = (k: string, v: string | undefined | false) => {
    if (v !== undefined && v !== false) el.setAttribute(k, v);
  };
  set('size', o.size);
  set('mode', o.mode);
  set('theme', o.theme);
  set('value', o.value);
  if (o.schedule) set('schedule', typeof o.schedule === 'string' ? o.schedule : JSON.stringify(o.schedule));
  set('name', o.name);
  set('form-value', o.formValue);
  if (o.required) set('required', '');
  if (o.mustUnderstand) set('must-understand', '');
  set('timezone', o.timezone);
  set('placeholder', o.placeholder);
  set('heading', o.heading);
  if (o.hour12) set('hour12', '');
  if (o.extensions === false) set('extensions', 'false');
  if (o.examples !== undefined) set('examples', o.examples === false ? 'false' : o.examples.join('|'));
  if (o.show) set('show', o.show.join(','));
  if (o.hide) set('hide', o.hide.join(','));
  if (o.strings) set('strings', JSON.stringify(o.strings));
  if (o.nextCount) set('next-count', String(o.nextCount));
  if (o.armed) set('armed', '');
  if (o.onChange) el.addEventListener('cronchange', (e) => o.onChange!((e as CustomEvent<CronChangeDetail>).detail));
  if (o.onTrigger) el.addEventListener('crontrigger', (e) => o.onTrigger!((e as CustomEvent<TriggerDetail>).detail));
  host.append(el);
  return el;
}

/**
 * Auto-mount `<div data-cronai data-size="mini" data-mode="user" data-target="#field">`
 * for CMSes that strip unknown tags. data-target receives data-target-value
 * ("cron" default, "json", "text" or "description").
 */
export function autoMount(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLElement>('[data-cronai]:not([data-cronai-mounted])').forEach((div) => {
    div.setAttribute('data-cronai-mounted', '');
    const d = div.dataset;
    let strings: Partial<Strings> | undefined;
    try {
      strings = d.strings ? JSON.parse(d.strings) : undefined;
    } catch {
      strings = undefined;
    }
    const el = mount(div, {
      size: d.size as WidgetSize,
      mode: d.mode as Mode,
      theme: d.theme,
      value: d.value,
      schedule: d.schedule,
      name: d.name,
      formValue: d.formValue as MountOptions['formValue'],
      required: d.required !== undefined,
      mustUnderstand: d.mustUnderstand !== undefined,
      timezone: d.timezone,
      placeholder: d.placeholder,
      heading: d.heading,
      hour12: d.hour12 !== undefined,
      extensions: d.extensions !== 'false',
      show: d.show?.split(','),
      hide: d.hide?.split(','),
      strings,
    });
    // data-text-target always receives what was typed (also when empty or not understood)
    if (d.textTarget) {
      const tt = document.querySelector<HTMLInputElement>(d.textTarget);
      el.addEventListener('cronchange', (e) => {
        if (!tt) return;
        tt.value = (e as CustomEvent<CronChangeDetail>).detail.text;
        tt.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    if (d.target) {
      const target = document.querySelector<HTMLInputElement>(d.target);
      const kind = d.targetValue ?? 'cron';
      // a saved value in the target restores the widget (edit forms)
      const saved = target ? readSchedule(target.value) : null;
      if (saved) el.schedule = saved;
      el.addEventListener('cronchange', (e) => {
        const det = (e as CustomEvent<CronChangeDetail>).detail;
        if (!target) return;
        target.value = !det.ok ? '' : kind === 'json' ? JSON.stringify(det.schedule) : kind === 'text' ? det.text : kind === 'description' ? det.description : det.crons.join('\n');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  });
}
