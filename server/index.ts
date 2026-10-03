/**
 * CronAI demo server (zero dependencies besides tsx):
 *   GET /                 -> single-file web demo of the real <CronTrigger /> (react-native-web build)
 *   GET /api/parse?q=...  -> JSON parse result from the same on-device engine
 *   GET /api/health       -> { ok: true }
 *   GET /api/next?schedule=<SavedSchedule JSON>&n=5 -> next run times of a saved visitor schedule
 *   GET /widget/<file>    -> embeddable gadget builds (cronai-widget.js, .esm.js, .lite.js)
 *   GET /embed            -> iframe page (?size=mini|compact|full&theme=auto&value=...)
 *
 * Logs go to stdout (journalctl -u cronai -f) AND to a size-capped rotating file
 * (logs/cronai.log, 1 MB x 3 files by default) that you can copy off the VM.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSchedule, MODEL_INFO, readSchedule, scheduleNextRuns } from '../src/engine';
import { createLogger } from './logger';

const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const log = createLogger({
  dir: process.env.LOG_DIR ?? resolve(ROOT, 'logs'),
  maxBytes: Number(process.env.LOG_MAX_BYTES ?? 1_000_000),
  maxFiles: Number(process.env.LOG_MAX_FILES ?? 3),
});

const demoPath = resolve(ROOT, 'web/dist/index.html');

const server = createServer((req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const done = (status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(body);
    log.info(`${req.method} ${url.pathname}${url.search} ${status} ${Date.now() - t0}ms`);
  };
  try {
    if (url.pathname === '/api/health') return done(200, 'application/json', JSON.stringify({ ok: true, model: MODEL_INFO }));
    if (url.pathname === '/api/parse') {
      const q = url.searchParams.get('q') ?? '';
      const r = parseSchedule(q, {
        allowExtensions: url.searchParams.get('ext') !== '0',
        hour12: url.searchParams.get('h12') === '1',
        timezone: url.searchParams.get('tz') ?? undefined,
        anchor: url.searchParams.get('anchor') ? Number(url.searchParams.get('anchor')) : undefined,
      });
      if (!r.ok) log.warn(`not understood: "${q}" (${r.error})`);
      return done(r.ok ? 200 : 422, 'application/json', JSON.stringify(r, null, 2));
    }
    if (url.pathname === '/api/next') {
      const s = readSchedule(url.searchParams.get('schedule'));
      if (!s) return done(400, 'application/json', JSON.stringify({ ok: false, error: 'schedule must be a SavedSchedule JSON' }));
      const n = Math.min(100, Math.max(1, Number(url.searchParams.get('n') ?? 5) || 5));
      return done(200, 'application/json', JSON.stringify({ ok: true, timezone: s.timezone, runs: scheduleNextRuns(s, n).map((r) => ({ at: r.date.toISOString(), cron: r.cron })) }, null, 2));
    }
    if (url.pathname.startsWith('/widget/') || url.pathname === '/embed') {
      const name = url.pathname === '/embed' ? 'embed.html' : url.pathname.slice('/widget/'.length);
      if (!/^[\w.-]+$/.test(name)) return done(400, 'text/plain', 'bad path');
      const file = resolve(ROOT, 'widget/dist', name);
      if (!existsSync(file)) return done(404, 'text/plain', 'Widget not built yet. Run: npm run build:widget');
      const type = name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
      return done(200, type, readFileSync(file));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!existsSync(demoPath)) return done(503, 'text/plain', 'Web demo not built yet. Run: npm run build:demo');
      return done(200, 'text/html; charset=utf-8', readFileSync(demoPath));
    }
    return done(404, 'text/plain', 'not found');
  } catch (e) {
    log.error(`${req.method} ${url.pathname} failed: ${(e as Error).stack ?? e}`);
    return done(500, 'text/plain', 'internal error');
  }
});

server.listen(PORT, HOST, () => {
  log.info(`CronAI listening on http://${HOST}:${PORT} (model ${MODEL_INFO.params} params, ${MODEL_INFO.sizeKb} KB)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info(`received ${sig}, shutting down`);
    server.close(() => process.exit(0));
  });
}
