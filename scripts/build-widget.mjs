/**
 * Builds the embeddable <cron-ai> gadget:
 *   widget/dist/cronai-widget.js        IIFE, full (with the CronLex model)  -> <script src>
 *   widget/dist/cronai-widget.esm.js    ES module, full                       -> import
 *   widget/dist/cronai-widget.lite.js   IIFE, rules only (no model, smaller)  -> <script src>
 *   widget/dist/embed.html              iframe page: /embed.html?size=compact&theme=auto&value=...
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'widget/dist');
mkdirSync(out, { recursive: true });
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const banner = (b) => `/*! CronAI widget v${pkg.version} (${b}) | natural language -> cron, on-device | MIT */`;

const stubModel = {
  name: 'stub-model',
  setup(b) {
    b.onResolve({ filter: /model\/tinyModel$/ }, () => ({ path: resolve(root, 'widget/src/model-stub.ts') }));
  },
};

const common = (variant) => ({
  entryPoints: [resolve(root, 'widget/src/index.ts')],
  bundle: true,
  minify: true,
  target: ['es2019'],
  legalComments: 'none',
  define: { __CRONAI_VERSION__: JSON.stringify(pkg.version), __CRONAI_BUILD__: JSON.stringify(variant) },
  banner: { js: banner(variant) },
  plugins: variant === 'lite' ? [stubModel] : [],
});

await build({ ...common('full'), format: 'iife', globalName: 'CronAI', outfile: resolve(out, 'cronai-widget.js') });
await build({ ...common('full'), format: 'esm', outfile: resolve(out, 'cronai-widget.esm.js') });
await build({ ...common('lite'), format: 'iife', globalName: 'CronAI', outfile: resolve(out, 'cronai-widget.lite.js') });
// engine only (no DOM): for Node backends / workers that run the schedules your visitors picked
await build({
  ...common('engine'),
  entryPoints: [resolve(root, 'src/engine/index.ts')],
  format: 'esm',
  platform: 'neutral',
  outfile: resolve(out, 'cronai-engine.esm.js'),
});

// iframe embed page: reads options from the query string, posts changes to the parent window
const js = readFileSync(resolve(out, 'cronai-widget.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const embed = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CronAI</title>
<style>html,body{margin:0;background:transparent}body{padding:2px}</style>
</head><body>
<script>${js}</script>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var list = function (k) { return q.get(k) ? q.get(k).split(',') : undefined; };
  var strings; try { strings = q.get('strings') ? JSON.parse(q.get('strings')) : undefined; } catch (e) {}
  var el = CronAI.mount(document.body, {
    size: q.get('size') || 'compact', mode: q.get('mode') || undefined, theme: q.get('theme') || 'auto',
    value: q.get('value') || undefined, schedule: q.get('schedule') || undefined, timezone: q.get('timezone') || undefined,
    hour12: q.has('hour12'), extensions: q.get('extensions') !== 'false', heading: q.get('heading') || undefined,
    placeholder: q.get('placeholder') || undefined, show: list('show'), hide: list('hide'), strings: strings,
    nextCount: q.get('next') ? +q.get('next') : undefined, armed: q.has('armed')
  });
  function post(type, detail) { try { parent.postMessage({ source: 'cronai', type: type, detail: detail, id: q.get('id') }, '*'); } catch (e) {} }
  function size() { post('resize', { height: document.documentElement.scrollHeight }); }
  el.addEventListener('cronchange', function (e) { var d = e.detail; post('change', { ok: d.ok, text: d.text, cron: d.cron, crons: d.crons, description: d.description, confidence: d.confidence, timezone: d.timezone, schedule: d.schedule, nextRuns: d.nextRuns.map(function (x) { return x.toISOString(); }) }); size(); });
  el.addEventListener('crontrigger', function (e) { post('trigger', { date: e.detail.date.toISOString(), cron: e.detail.cron, schedule: e.detail.schedule, count: e.detail.count }); });
  // the parent page can drive the frame: { source:'cronai', type:'set', value | schedule } / { type:'arm' } / { type:'disarm' }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.source !== 'cronai-parent') return;
    if (m.type === 'set' && m.schedule) el.schedule = m.schedule; else if (m.type === 'set') el.value = m.value || '';
    if (m.type === 'arm') el.arm(); if (m.type === 'disarm') el.disarm();
  });
  new ResizeObserver(size).observe(document.body);
})();
</script>
</body></html>
`;
writeFileSync(resolve(out, 'embed.html'), embed);

const rows = ['cronai-widget.js', 'cronai-widget.esm.js', 'cronai-widget.lite.js', 'cronai-engine.esm.js', 'embed.html'].map((f) => {
  const buf = readFileSync(resolve(out, f));
  return `${f.padEnd(24)} ${(buf.length / 1024).toFixed(1).padStart(6)} KB   gzip ${(gzipSync(buf).length / 1024).toFixed(1).padStart(5)} KB`;
});
console.log(rows.join('\n'));

// Widget Builder page (self-contained; published as an artifact / usable as docs)
const gz = (f) => (gzipSync(readFileSync(resolve(out, f))).length / 1024).toFixed(0);
const tpl = readFileSync(resolve(root, 'widget/builder.template.html'), 'utf8');
writeFileSync(
  resolve(out, 'builder.html'),
  tpl
    .replace('__FULL_GZ__', gz('cronai-widget.js'))
    .replace('__LITE_GZ__', gz('cronai-widget.lite.js'))
    .replace('__SCRIPT_BASE__', 'https://cdn.jsdelivr.net/gh/abozaralizadeh/cronai@master/widget/dist/')
    .replace('__SCRIPT_HINT__', 'Points at jsDelivr for your GitHub repo and works once <code>widget/dist</code> is pushed. GitHub Pages and your VM serve it too, at <code>/widget/cronai-widget.js</code>.')
    .replace('__HEADER_LINKS__', '')
    .replace('__WIDGET_JS__', () => js),
);
console.log('builder.html written');
