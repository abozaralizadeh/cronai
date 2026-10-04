import { DEFAULT_RADIUS, Palette, PALETTES } from '../../src/themes/palettes';

/** Palette -> CSS custom properties. Page CSS like `cron-ai { --cai-accent: red }` overrides them. */
export function paletteVars(p: Palette): string {
  const c = p.colors;
  const r = p.radius ?? DEFAULT_RADIUS;
  return [
    `--cai-bg:${c.background}`,
    `--cai-surface:${c.surface}`,
    `--cai-surface-alt:${c.surfaceAlt}`,
    `--cai-border:${c.border}`,
    `--cai-text:${c.text}`,
    `--cai-muted:${c.textMuted}`,
    `--cai-faint:${c.textFaint}`,
    `--cai-accent:${c.accent}`,
    `--cai-accent-soft:${c.accentSoft}`,
    `--cai-on-accent:${c.onAccent}`,
    `--cai-success:${c.success}`,
    `--cai-warning:${c.warning}`,
    `--cai-danger:${c.danger}`,
    ...c.fields.map((f, i) => `--cai-f${i}:${f}`),
    `--cai-r-interval:${c.roles.interval}`,
    `--cai-r-time:${c.roles.time}`,
    `--cai-r-day:${c.roles.day}`,
    `--cai-r-month:${c.roles.month}`,
    `--cai-r-except:${c.roles.except}`,
    `--cai-shadow:${c.shadow}`,
    `--cai-rad-sm:${r.sm}px`,
    `--cai-rad-md:${r.md}px`,
    `--cai-rad-lg:${r.lg}px`,
    `--cai-rad-xl:${r.xl}px`,
    `color-scheme:${p.dark ? 'dark' : 'light'}`,
  ].join(';');
}

/** `auto` follows the visitor's OS theme: Glacier (light) / Aurora (dark). */
export function themeCss(theme: string): string {
  if (theme === 'auto' || !(theme in PALETTES)) {
    return `:host{${paletteVars(PALETTES.glacier)}}@media (prefers-color-scheme: dark){:host{${paletteVars(PALETTES.aurora)}}}`;
  }
  return `:host{${paletteVars(PALETTES[theme as keyof typeof PALETTES])}}`;
}

export const BASE_CSS = /* css */ `
:host {
  display: block;
  box-sizing: border-box;
  max-width: 100%;
  font-family: var(--cai-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif);
  --cai-mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.card {
  position: relative;
  display: flex; flex-direction: column; gap: 14px;
  background: var(--cai-surface);
  color: var(--cai-text);
  border: 1px solid var(--cai-border);
  border-radius: var(--cai-rad-xl);
  padding: 16px;
  box-shadow: 0 18px 44px -26px var(--cai-shadow);
  transition: border-color .3s;
}
.card.flash { animation: flash 1.2s ease-out; }
@keyframes flash { 0% { box-shadow: 0 0 0 3px var(--cai-success); } 100% { box-shadow: 0 18px 44px -26px var(--cai-shadow); } }

/* header */
.head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border-radius: 99px;
  background: var(--cai-accent-soft); color: var(--cai-accent); font-size: 11px; font-weight: 700; letter-spacing: .2px; white-space: nowrap; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cai-accent); box-shadow: 0 0 0 0 var(--cai-accent); animation: pulse 1.8s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cai-accent) 50%, transparent); } 70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
.title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -.4px; }

/* input */
.inbox { position: relative; display: flex; flex-direction: column; gap: 6px; background: var(--cai-surface-alt);
  border: 1.5px solid var(--cai-border); border-radius: var(--cai-rad-lg); padding: 10px 12px; transition: border-color .2s; }
.inbox:focus-within, .inbox.thinking { border-color: var(--cai-accent); }
textarea, input.line {
  all: unset; display: block; width: 100%; color: var(--cai-text); font-size: 16px; line-height: 1.45;
  font-family: inherit; white-space: pre-wrap; word-break: break-word; resize: none;
}
textarea { min-height: 2.9em; }
textarea::placeholder, input.line::placeholder { color: var(--cai-faint); }
.status { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--cai-muted); min-height: 16px; }
.status .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status.err .msg { color: var(--cai-warning); }
.linkbtn { all: unset; cursor: pointer; color: var(--cai-faint); font-size: 12px; }
.linkbtn:hover { color: var(--cai-text); }
.dots { display: none; gap: 3px; }
.thinking .dots { display: inline-flex; }
.dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--cai-accent); animation: bob .8s infinite ease-in-out; }
.dots i:nth-child(2) { animation-delay: .12s; } .dots i:nth-child(3) { animation-delay: .24s; }
@keyframes bob { 0%, 100% { opacity: .3; transform: none; } 50% { opacity: 1; transform: translateY(-3px); } }

.label { font-size: 10px; font-weight: 800; letter-spacing: 1.3px; color: var(--cai-faint); text-transform: uppercase; }
.section { display: flex; flex-direction: column; gap: 7px; }

/* understanding chips */
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 13.5px; }
.filler { color: var(--cai-faint); padding: 3px 0; }
.chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 8px; border-radius: var(--cai-rad-sm);
  border: 1px solid color-mix(in srgb, var(--rc) 45%, transparent); background: color-mix(in srgb, var(--rc) 13%, transparent); }
.chip .role { font-size: 9px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: var(--rc); }
.chip s { color: var(--cai-faint); }
.chip .fix { color: var(--rc); }

/* tiles */
.tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.tile { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 11px 4px 8px; border-radius: var(--cai-rad-md); background: var(--cai-surface-alt); border: 1px solid var(--tc); min-width: 0; }
.tile::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--tc); }
.tile.any { border-color: var(--cai-border); }
.tile.any::before { opacity: .25; }
.tile .v { font-family: var(--cai-mono); font-weight: 700; font-size: 18px; letter-spacing: -.3px; max-width: 100%;
  overflow-wrap: anywhere; text-align: center; line-height: 1.2; }
.tile.any .v { color: var(--cai-faint); }
.tile .k { font-size: 9px; font-weight: 800; letter-spacing: 1px; color: var(--cai-muted); text-transform: uppercase; }
.tile.pop { animation: pop .45s cubic-bezier(.3, 1.6, .5, 1); }
@keyframes pop { 0% { transform: scale(.86); opacity: .4; } 100% { transform: none; opacity: 1; } }

/* expression row */
.expr { display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 12px; background: var(--cai-bg);
  border: 1px solid var(--cai-border); border-radius: var(--cai-rad-md); }
.expr code { flex: 1; min-width: 0; font-family: var(--cai-mono); font-size: 14.5px; font-weight: 600; white-space: pre; overflow-x: auto; user-select: all; }
.pill { border: 1px solid var(--cai-border); background: transparent; color: var(--cai-text); border-radius: 99px;
  padding: 5px 12px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.pill:hover { background: var(--cai-accent-soft); }
.pill.on { background: var(--cai-accent); border-color: var(--cai-accent); color: var(--cai-on-accent); }
.desc { font-size: 15px; font-weight: 500; line-height: 1.45; }
.guard { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--cai-border); border-left: 3px solid var(--cai-f4);
  border-radius: var(--cai-rad-md); background: var(--cai-surface-alt); }
.guard .ghead { display: flex; align-items: center; gap: 8px; }
.guard .gtext { font-size: 12.5px; color: var(--cai-muted); }
.guard .gcode { font-family: var(--cai-mono); font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; user-select: all; }
.gline { font-size: 12px; color: var(--cai-f4); }
.desc.big { font-size: 17px; font-weight: 600; letter-spacing: -.2px; }
.tzline { font-size: 11.5px; color: var(--cai-faint); }
.zone { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.zone select { font: inherit; font-size: 13px; color: var(--cai-text); background: var(--cai-surface-alt); border: 1px solid var(--cai-border);
  border-radius: 99px; padding: 5px 10px; min-width: 0; max-width: 100%; flex: 1 1 180px; cursor: pointer; }
.zone select:focus-visible { outline: 2px solid var(--cai-accent); outline-offset: 2px; }
.mini .zone { margin-top: 2px; }
.mini .out .md.strong { color: var(--cai-text); font-weight: 600; font-size: 13px; }
.mini .out .mrun { color: var(--cai-muted); white-space: nowrap; font-size: 11.5px; }
.card.user.compact { gap: 12px; }
.card.user .chips { font-size: 12.5px; }

/* confidence */
.conf { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--cai-muted); }
.bar { flex: 1; height: 5px; background: var(--cai-surface-alt); border-radius: 99px; overflow: hidden; }
.bar i { display: block; height: 100%; width: 0; border-radius: 99px; background: var(--cai-success); transition: width .45s cubic-bezier(.2,.8,.2,1), background .3s; }
.conf b { font-family: var(--cai-mono); min-width: 36px; text-align: right; font-weight: 600; }

/* notes */
.notes { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
.note { display: flex; gap: 8px; align-items: flex-start; color: var(--cai-muted); }
.note.warn { color: var(--cai-text); }
.note i { flex: none; width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid currentColor; display: grid; place-items: center;
  font-style: normal; font-size: 9px; font-weight: 800; margin-top: 1px; }
.note.warn i { color: var(--cai-warning); }

/* next runs */
.runs { list-style: none; margin: 0; padding: 0; }
.runs li { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 13px; border-top: 1px solid var(--cai-border); }
.runs li:first-child { border-top: 0; }
.runs .n { width: 19px; height: 19px; border-radius: 50%; display: grid; place-items: center; font: 700 10.5px var(--cai-mono);
  background: var(--cai-surface-alt); color: var(--cai-muted); flex: none; }
.runs li:first-child .n { background: var(--cai-accent); color: var(--cai-on-accent); }
.runs .d { font-family: var(--cai-mono); font-variant-numeric: tabular-nums; }
.runs .rel { margin-left: auto; color: var(--cai-muted); font-size: 12px; white-space: nowrap; }

/* trigger */
.trig { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: var(--cai-rad-lg);
  border: 1px solid var(--cai-border); background: var(--cai-surface-alt); }
.trig.armed { border-color: var(--cai-accent); background: var(--cai-accent-soft); }
.trig .row { display: flex; align-items: center; gap: 12px; }
.trig .t { font-weight: 700; font-size: 14px; }
.trig .s { font-size: 12px; color: var(--cai-muted); }
.switch { all: unset; cursor: pointer; position: relative; width: 40px; height: 22px; border-radius: 99px; background: var(--cai-border); flex: none; transition: background .2s; }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--cai-surface); transition: transform .2s; }
.switch[aria-checked="true"] { background: var(--cai-accent); }
.switch[aria-checked="true"]::after { transform: translateX(18px); background: var(--cai-on-accent); }
.switch:disabled { opacity: .4; cursor: not-allowed; }
.count { font: 700 26px var(--cai-mono); color: var(--cai-accent); letter-spacing: 1px; font-variant-numeric: tabular-nums; }
.prog { height: 4px; background: var(--cai-border); border-radius: 99px; overflow: hidden; }
.prog i { display: block; height: 100%; background: var(--cai-accent); width: 0; }
.fired { font-size: 12px; color: var(--cai-success); }

/* examples */
.ex { display: flex; gap: 7px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
.ex::-webkit-scrollbar { display: none; }
.ex button { flex: none; border: 1px solid var(--cai-border); background: var(--cai-surface-alt); color: var(--cai-muted);
  border-radius: 99px; padding: 6px 11px; font-size: 12.5px; }
.ex button:hover { color: var(--cai-text); background: var(--cai-accent-soft); }

:focus-visible { outline: 2px solid var(--cai-accent); outline-offset: 2px; }
.switch:focus-visible { outline-offset: 3px; }
[hidden] { display: none !important; }

/* ---------------- sizes ---------------- */
/* mini: one input line + one result line */
.card.mini { gap: 6px; padding: 8px 10px 8px 12px; border-radius: var(--cai-rad-lg); box-shadow: none; }
.mini .inrow { display: flex; align-items: center; gap: 8px; }
.mini input.line { font-size: 14.5px; flex: 1; min-width: 0; }
.mini .out { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; }
.mini .out code { font-family: var(--cai-mono); font-weight: 700; color: var(--cai-accent); white-space: nowrap; font-size: 12.5px; }
.mini .out .md { color: var(--cai-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
.mini .out.err code { color: var(--cai-warning); }
.mini .copy { all: unset; cursor: pointer; font-size: 11px; font-weight: 700; color: var(--cai-muted); padding: 3px 8px; border-radius: 99px; border: 1px solid var(--cai-border); }
.mini .copy:hover, .mini .copy.on { color: var(--cai-on-accent); background: var(--cai-accent); border-color: var(--cai-accent); }
.mini .dots { margin-right: 2px; }

/* compact */
.card.compact { gap: 11px; padding: 14px; }
.compact textarea { font-size: 15px; min-height: 2.6em; }
.compact .tile { padding: 9px 3px 6px; }
.compact .tile .v { font-size: 15px; }
.compact .chips { font-size: 12.5px; }
.compact .desc { font-size: 13.5px; }
.compact .nextline { font-size: 12px; color: var(--cai-muted); display: flex; gap: 6px; flex-wrap: wrap; }
.compact .nextline b { font-family: var(--cai-mono); color: var(--cai-text); font-weight: 600; }

/* touch screens: 16px text so iOS doesn't zoom in when the box gets focus */
@media (pointer: coarse), (hover: none) {
  textarea, .compact textarea, input.line, .mini input.line, .zone select { font-size: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;
