/**
 * Typo-robustness eval: corrupt schedule words with realistic typos and check that
 * the cron output is unchanged. Compares the engine with and without the tiny model.
 *   npm run eval
 */
import { parseSchedule } from '../src/engine';

const PHRASES = [
  'every 15 minutes during business hours', 'every weekday at 9am', 'every wednesday and friday at 4pm',
  'last friday of every month at 6pm', 'first monday of the month at 9am', 'every saturday morning',
  'every thursday evening at 7', 'every 20 minutes on weekends', 'every tuesday at 9pm',
  'every day except sunday at 7:30am', 'every 10 minutes between 9am and 5pm', 'every september on the 1st at noon',
  'every february 14 at 8am', 'every hour from monday to friday', 'every afternoon at 3', 'every monday at midnight',
  'quarterly on the 15th at 10am', 'every december 25 at 8am', 'twice a day on weekends', 'every 30 minutes in the morning',
];

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const KEYS = 'qwertyuiopasdfghjklzxcvbnm';
function typo(w: string): string {
  const a = w.split('');
  const i = 1 + Math.floor(rnd() * (a.length - 2));
  const op = rnd();
  if (op < 0.3) a.splice(i, 1);
  else if (op < 0.55) [a[i], a[i + 1]] = [a[i + 1], a[i]];
  else if (op < 0.8) a.splice(i, 0, a[i]);
  else a[i] = KEYS[Math.floor(rnd() * KEYS.length)];
  return a.join('');
}

let total = 0;
const ok = { model: 0, noModel: 0 };
for (let round = 0; round < 10; round++) {
  for (const p of PHRASES) {
    const clean = parseSchedule(p).crons.join('|');
    const noisy = p.split(' ').map((w) => (/^[a-z]{5,}$/.test(w) && rnd() < 0.6 ? typo(w) : w)).join(' ');
    if (noisy === p) continue;
    total++;
    if (parseSchedule(noisy).crons.join('|') === clean) ok.model++;
    if (parseSchedule(noisy, { useModel: false }).crons.join('|') === clean) ok.noModel++;
  }
}
const pct = (n: number) => ((100 * n) / total).toFixed(1) + '%';
console.log(`typo'd sentences: ${total}`);
console.log(`exact cron match WITH tiny model:    ${pct(ok.model)}`);
console.log(`exact cron match WITHOUT tiny model: ${pct(ok.noModel)}`);
