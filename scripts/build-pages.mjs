/**
 * Builds the static GitHub Pages site into ./site (used by .github/workflows/pages.yml):
 *
 *   site/index.html          Widget Builder (full page, scripts served from this site)
 *   site/demo/index.html     React Native component demo (react-native-web build)
 *   site/widget/*            cronai-widget.js, .lite.js, .esm.js, cronai-engine.esm.js, embed.html
 *   site/favicon.*, icons    from brand/ (regenerate with python3 scripts/make-icons.py), linked from every page
 *
 * Run `npm run build:demo && npm run build:widget` first (npm run build:pages does all three).
 * Override links with SITE_REPO_URL=https://github.com/<you>/<repo>.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'widget/dist');
const site = resolve(root, 'site');
const repo = process.env.SITE_REPO_URL ?? 'https://github.com/abozaralizadeh/cronai';
// project pages live under /<repo>/ (set SITE_BASE=/ for a user site or custom domain)
const base = process.env.SITE_BASE ?? `/${repo.split('/').pop()}/`;

for (const f of ['cronai-widget.js', 'embed.html']) {
  if (!existsSync(resolve(dist, f))) throw new Error(`widget/dist/${f} missing: run npm run build:widget first`);
}
if (!existsSync(resolve(root, 'web/dist/index.html'))) throw new Error('web/dist/index.html missing: run npm run build:demo first');

rmSync(site, { recursive: true, force: true });
mkdirSync(resolve(site, 'widget'), { recursive: true });
mkdirSync(resolve(site, 'demo'), { recursive: true });

// 1. widget files
for (const f of ['cronai-widget.js', 'cronai-widget.esm.js', 'cronai-widget.lite.js', 'cronai-engine.esm.js', 'embed.html']) {
  copyFileSync(resolve(dist, f), resolve(site, 'widget', f));
}

// 2. icons (favicon.svg / .ico / PNGs / manifest) at the site root, linked from every page by absolute path
for (const f of readdirSync(resolve(root, 'brand'))) copyFileSync(resolve(root, 'brand', f), resolve(site, f));
const iconLinks = [
  `<link rel="icon" href="${base}favicon.ico" sizes="48x48">`,
  `<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">`,
  `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">`,
  `<link rel="manifest" href="${base}site.webmanifest">`,
  '<meta name="theme-color" content="#3451D1">',
].join('\n');
const withIcons = (html) => html.replace(/<link rel="icon"[^>]*>\n?/g, '').replace(/<meta name="theme-color"[^>]*>\n?/g, '').replace(/<head>/i, `<head>\n${iconLinks}`);

// 3. demo
writeFileSync(resolve(site, 'demo/index.html'), withIcons(readFileSync(resolve(root, 'web/dist/index.html'), 'utf8')));

// 4. builder as a full standalone page
const gz = (f) => (gzipSync(readFileSync(resolve(dist, f))).length / 1024).toFixed(0);
const js = readFileSync(resolve(dist, 'cronai-widget.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const tpl = readFileSync(resolve(root, 'widget/builder.template.html'), 'utf8')
  .replace('__FULL_GZ__', gz('cronai-widget.js'))
  .replace('__LITE_GZ__', gz('cronai-widget.lite.js'))
  .replace('__SCRIPT_BASE__', '')
  .replace(
    '__SCRIPT_HINT__',
    `Served from this site. jsDelivr works too: <code>https://cdn.jsdelivr.net/gh/${repo.replace('https://github.com/', '')}@${process.env.SITE_BRANCH ?? 'master'}/widget/dist/cronai-widget.js</code>.`,
  )
  .replace('__HEADER_LINKS__', `<nav class="links"><a href="demo/">React Native component demo</a><a href="${repo}">Source on GitHub</a><a href="widget/cronai-widget.js">cronai-widget.js</a></nav>`)
  .replace('__WIDGET_JS__', () => js);

const split = tpl.indexOf('<div class="wrap">');
const headPart = tpl.slice(0, split);
const bodyPart = tpl.slice(split);
const description = 'Embeddable plain-English schedule picker. Visitors type how often, you get cron or a schedule JSON. Runs a tiny on-device model, no server needed.';

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta property="og:title" content="CronAI Widget Builder">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<style>
  :root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
${headPart.trim()}
</head>
<body>
${bodyPart.trim()}
</body>
</html>
`;
writeFileSync(resolve(site, 'index.html'), withIcons(page));

// 5. small 404 that sends people to the builder
writeFileSync(
  resolve(site, '404.html'),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · CronAI</title>
${iconLinks}</head><body>
<style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#ECEEF2;color:#14171C}a{color:#3451D1}@media (prefers-color-scheme:dark){body{background:#0E1014;color:#E7EAF0}a{color:#8FA2FF}}</style>
<p>Page not found. <a href="${base}">Open the CronAI Widget Builder</a></p></body></html>`,
);

console.log('site/ ready:', ['index.html', '404.html', 'demo/index.html', 'widget/*', 'favicon + icons'].join(', '));
