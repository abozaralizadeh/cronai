/**
 * Builds a single-file web demo of the real <CronTrigger /> component using
 * react-native-web + esbuild (no Expo/Metro needed).
 *
 *   web/dist/index.html     full standalone page (served by setup_service.sh)
 *   web/dist/fragment.html  same page without <html>/<head> wrapper (for embedding / artifacts)
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'web/dist');
mkdirSync(out, { recursive: true });

const res = await build({
  entryPoints: [resolve(root, 'web/entry.tsx')],
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.json'],
  alias: {
    'react-native': 'react-native-web',
    'expo-status-bar': resolve(root, 'web/stubs/expo-status-bar.tsx'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    __DEV__: 'false',
    global: 'window',
  },
  legalComments: 'none',
});

const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = `
  /* The page is the real component; it picks Aurora (dark) or Glacier (light) from the viewer's theme. */
  :root { --bg: #EAF1F8; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #070B1A; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg: #070B1A; color-scheme: dark; }
  html, body, #root { height: 100%; margin: 0; }
  body { background: var(--bg); }
  #root { display: flex; }
  textarea { resize: none; }
  textarea:focus { outline: none; }
`;
const head = `<title>CronAI</title>
<meta name="description" content="Natural language to cron, powered by a tiny on-device model.">
<style>${css}</style>`;
const fragment = `${head}
<div id="root"></div>
<script>${js}</script>
`;
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
writeFileSync(resolve(out, 'fragment.html'), fragment);
writeFileSync(resolve(out, 'index.html'), full);
console.log(`web demo built: ${(full.length / 1024).toFixed(0)} KB -> web/dist/index.html`);
