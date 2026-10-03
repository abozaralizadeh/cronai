import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { parseSchedule, nextRuns, validateCron, describeCron, compressList, predictToken, guardAllows, scheduleNextRuns, readSchedule, createTrigger, wallClock } from '../src/engine';

const NOW = new Date(2026, 9, 2, 12, 0); // Fri 2 Oct 2026 12:00 local

// [natural language, expected cron line(s)]
const CASES: [string, string | string[]][] = [
  // intervals
  ['every minute', '* * * * *'],
  ['every 5 minutes', '*/5 * * * *'],
  ['every quarter hour', '*/15 * * * *'],
  ['every half hour on weekends', '*/30 * * * 0,6'],
  ['twice an hour', '0,30 * * * *'],
  ['hourly', '0 * * * *'],
  ['every 4 hours', '0 */4 * * *'],
  ['every 90 minutes', ['0 */3 * * *', '30 1-22/3 * * *']],
  ['every other day at noon', '0 12 */2 * *'],
  ['every 3 months starting in february', '0 0 1 2-11/3 *'],
  ['monthly', '0 0 1 * *'],
  ['every year', '0 0 1 1 *'],
  ['nightly', '0 21 * * *'],
  // clock times
  ['every weekday at 9am', '0 9 * * 1-5'],
  ['at 9:15 and 17:45 on mondays', ['15 9 * * 1', '45 17 * * 1']],
  ['every day except sunday at 7:30am', '30 7 * * 1-6'],
  ['every night at 11', '0 23 * * *'],
  ['every friday at 5 in the evening', '0 17 * * 5'],
  ['quarter to 10 every weekday', '45 9 * * 1-5'],
  ['at half past 4 in the afternoon', '30 16 * * *'],
  ['at 9am, 1pm and 6pm on weekdays', '0 9,13,18 * * 1-5'],
  ['every tuesday and thursday at 08:00 and 20:00', '0 8,20 * * 2,4'],
  ['at 12am', '0 0 * * *'],
  ['at 12pm', '0 12 * * *'],
  ['at 17h30', '30 17 * * *'],
  ['at 5 past every hour', '5 * * * *'],
  ['15 minutes past every hour', '15 * * * *'],
  ['at :15 and :45 between 9 and 5', '15,45 9-16 * * *'],
  // windows
  ['every 15 minutes during business hours', '*/15 9-16 * * 1-5'],
  ['every 2 hours between 8am and 8pm on weekends', '0 8-20/2 * * 0,6'],
  ['every 10 mins mon to fri 8am-6pm', '*/10 8-17 * * 1-5'],
  ['mon-fri 9-5 every 30 mins', '*/30 9-16 * * 1-5'],
  ['every hour on the hour from 9am to 5pm', '0 9-17 * * *'],
  ['every 3 hours from 9am to 9pm on weekdays', '0 9-21/3 * * 1-5'],
  ['every hour from 22 to 2', '0 0-2,22,23 * * *'],
  ['every 6 hours starting at 3am', '0 3-21/6 * * *'],
  ['every 5 minutes for the first 15 minutes of every hour', '0-14/5 * * * *'],
  ['3 times a day between 9am and 5pm', '0 9,13,17 * * *'],
  // days of month / nth weekday / months
  ['on the 1st and 15th at midnight', '0 0 1,15 * *'],
  ['last day of the month at 23:59', '59 23 L * *'],
  ['on the last friday of every month at 6pm', '0 18 * * 5L'],
  ['first monday of the month at 9am', '0 9 * * 1#1'],
  ['every second tuesday of the month at 18:00', '0 18 * * 2#2'],
  ['the first and third thursday at 7pm', '0 19 * * 4#1,4#3'],
  ['last sunday of march at 1am', '0 1 * 3 0L'],
  ['between 1st and 7th of the month at 9am', '0 9 1-7 * *'],
  ['quarterly on the 15th at 10am', '0 10 15 */3 *'],
  ['every year on march 15 at 10am', '0 10 15 3 *'],
  ['christmas at 8am', '0 8 25 12 *'],
  ['every 10 minutes from 9 to 5 monday to friday except in august', '*/10 9-16 * 1-7,9-12 1-5'],
  ['every saturday and sunday at 10 am except in winter', '0 10 * 3-11 0,6'],
  ['every 2 minutes on sundays in december', '*/2 * * 12 0'],
  ['run my report at 6 in the morning on the first day of each quarter', '0 6 1 */3 *'],
  // typos (tiny model)
  ['every wensday and fridy at half past 4 in the afternoon', '30 16 * * 3,5'],
  ['evrey 20 minuts on weekedns', '*/20 * * * 0,6'],
  ['evry tusday at 9pm', '0 21 * * 2'],
  ['thrusday mornign at 7:45', '45 7 * * 4'],
  // task text around the schedule
  ['backup the database every night at 2am', '0 2 * * *'],
  ['please send the weekly report every monday at 8:30', '30 8 * * 1'],
  // already cron
  ['*/5 * * * *', '*/5 * * * *'],
  ['@daily', '0 0 * * *'],
];

for (const [input, expected] of CASES) {
  test(`NL: ${input}`, () => {
    const r = parseSchedule(input, { now: NOW });
    assert.equal(r.ok, true, r.error ?? '');
    assert.deepEqual(r.crons, Array.isArray(expected) ? expected : [expected]);
    for (const c of r.crons) assert.equal(validateCron(c).ok, true, c);
  });
}

const DAY = 86400000;
for (const [input, cron, n, dow] of [
  ['every two weeks on saturday', '0 0 * * 6', 2, 6],
  ['every other saturday at 10am', '0 10 * * 6', 2, 6],
  ['fortnightly on monday at 9am', '0 9 * * 1', 2, 1],
  ['biweekly on friday at 17:00', '0 17 * * 5', 2, 5],
  ['every 3 weeks on friday at 5pm', '0 17 * * 5', 3, 5],
  ['every 2 weeks', '0 0 * * 0', 2, 0],
] as [string, string, number, number][]) {
  test(`every N weeks: ${input}`, () => {
    const r = parseSchedule(input, { now: NOW, nextCount: 6 });
    assert.deepEqual(r.crons, [cron]);
    assert.ok(r.guard, 'guard expected');
    assert.equal(r.guard!.everyWeeks, n);
    // next runs are exactly n weeks apart (allowing 1h DST shift)
    for (let i = 1; i < r.nextRuns.length; i++) {
      const gap = r.nextRuns[i].date.getTime() - r.nextRuns[i - 1].date.getTime();
      assert.ok(Math.abs(gap - n * 7 * DAY) <= 3600000, `gap ${gap / DAY} days`);
      assert.equal(r.nextRuns[i].date.getDay(), dow);
    }
    // the shell guard agrees with the JS guard, on and off weeks
    const shell = r.guard!.shell.replace(/\\%/g, '%');
    for (const run of r.nextRuns.slice(0, 3)) {
      for (const shift of [0, 7 * DAY]) {
        const t = new Date(run.date.getTime() + shift);
        const ts = Math.floor(t.getTime() / 1000);
        const out = execSync(`bash -c '${shell.replace('$(date +%s)', String(ts))} echo yes || echo no'`).toString().trim();
        assert.equal(out, guardAllows(r.guard, t) ? 'yes' : 'no');
        assert.equal(out, shift === 0 ? 'yes' : 'no');
      }
    }
    assert.ok(r.guard!.crontab[0].startsWith(cron + ' [ $(('));
    assert.ok(/every (other week|\d weeks)/.test(r.description), r.description);
  });
}

test('every N weeks: same weeks stay on with a saved anchor', () => {
  const a = parseSchedule('every other saturday at 10am', { now: NOW });
  const later = parseSchedule('every other saturday at 10am', { now: new Date(NOW.getTime() + 7 * DAY), anchor: a.guard!.anchor });
  assert.equal(later.nextRuns[0].date.getTime(), a.nextRuns[1].date.getTime());
});

test('every saturday has no guard', () => {
  assert.equal(parseSchedule('every saturday', { now: NOW }).guard, null);
});

test('every 2 weeks offers a pure-cron alternative', () => {
  const r = parseSchedule('every two weeks on saturday at 9am', { now: NOW });
  assert.equal(r.alternatives[0].cron, '0 9 * * 6#1,6#3');
});

test('warnings for things cron cannot express', () => {
  assert.ok(parseSchedule('every 30 seconds').warnings.length > 0);
  assert.ok(parseSchedule('every 7 minutes').warnings.length > 0);
});

test('rejects text without a schedule', () => {
  const r = parseSchedule('hello world');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('rejects invalid cron', () => {
  assert.equal(parseSchedule('61 * * * *').ok, false);
});

test('extensions can be disabled', () => {
  const r = parseSchedule('last day of the month at noon', { allowExtensions: false });
  assert.equal(r.ok, true);
  assert.ok(!r.crons[0].includes('L'));
});

test('next runs', () => {
  const runs = nextRuns('0 9 * * 1-5', 3, NOW);
  assert.deepEqual(runs.map((d) => [d.getDate(), d.getHours()]), [[5, 9], [6, 9], [7, 9]]);
  const last = nextRuns('0 18 * * 5L', 2, NOW);
  assert.deepEqual(last.map((d) => [d.getMonth() + 1, d.getDate()]), [[10, 30], [11, 27]]);
  const firstMon = nextRuns('0 9 * * 1#1', 1, NOW);
  assert.deepEqual([firstMon[0].getMonth() + 1, firstMon[0].getDate()], [10, 5]);
  const lastDay = nextRuns('0 0 L 2 *', 1, NOW);
  assert.equal(lastDay[0].getDate(), 28); // Feb 2027
  const domOrDow = nextRuns('0 0 13 * 5', 3, NOW); // 13th OR Friday
  assert.deepEqual(domOrDow.map((d) => d.getDate()), [9, 13, 16]);
});

test('describe', () => {
  assert.equal(describeCron('0 9 * * 1-5'), 'At 09:00 on weekdays (Monday through Friday)');
  assert.equal(describeCron('*/15 9-16 * * 1-5'), 'Every 15 minutes, between 09:00 and 16:59 on weekdays (Monday through Friday)');
  assert.equal(describeCron('0 8 25 12 *'), 'At 08:00 on December 25th');
  assert.equal(describeCron('30 16 * * 3,5', { hour12: true }), 'At 4:30 PM on Wednesday and Friday');
});

test('compressList', () => {
  assert.equal(compressList([1, 2, 3, 4, 5], 'dow'), '1-5');
  assert.equal(compressList([0, 6], 'dow'), '0,6');
  assert.equal(compressList([0, 15, 30, 45], 'minute'), '*/15');
  assert.equal(compressList([9, 12, 15, 18, 21], 'hour'), '9-21/3');
  assert.equal(compressList([9, 13, 17], 'hour'), '9,13,17');
});

test('tiny model: typos -> canonical, ordinary words -> __other__', () => {
  for (const [w, label] of [['wensday', 'wednesday'], ['evrey', 'every'], ['septmber', 'september'], ['aftrenoon', 'afternoon'], ['mornign', 'morning']]) {
    assert.equal(predictToken(w).label, label, w);
  }
  for (const w of ['backup', 'database', 'fridge', 'report']) assert.equal(predictToken(w).label, '__other__', w);
});

test('performance: parsing is fast', () => {
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) parseSchedule('every 15 minutes during business hours except in august');
  assert.ok(Date.now() - t0 < 2000);
});

// ---------------------------------------------------------------- time zones + saved schedules + triggers
const AT = new Date(Date.UTC(2026, 9, 2, 10, 0)); // Fri 2 Oct 2026 10:00 UTC
/** advance fake time in 10 s steps so Date and timers move together, like real time */
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 10_000) mock.timers.tick(10_000);
};

test('timezone: 9am means 9am in the visitor zone, across DST', () => {
  const ny = parseSchedule('every weekday at 9am', { timezone: 'America/New_York', now: AT, nextCount: 25 });
  assert.equal(ny.timezone, 'America/New_York');
  assert.equal(ny.nextRuns[0].date.toISOString(), '2026-10-02T13:00:00.000Z'); // EDT, same day (it's 06:00 in NY)
  const afterDst = ny.nextRuns.find((r) => r.date > new Date(Date.UTC(2026, 10, 2)))!;
  assert.equal(afterDst.date.toISOString(), '2026-11-02T14:00:00.000Z'); // EST
  const rome = parseSchedule('every day at 9am', { timezone: 'Europe/Rome', now: AT, nextCount: 30 });
  assert.equal(rome.nextRuns[0].date.toISOString(), '2026-10-03T07:00:00.000Z');
  assert.ok(rome.nextRuns.some((r) => r.date.toISOString() === '2026-10-26T08:00:00.000Z'));
  for (const r of rome.nextRuns) assert.equal(wallClock(r.date, 'Europe/Rome').h, 9);
});

test('timezone: wall time skipped by DST is skipped', () => {
  const r = parseSchedule('every day at 2:30', { timezone: 'Europe/Rome', now: new Date(Date.UTC(2027, 2, 26)), nextCount: 3 });
  assert.deepEqual(r.nextRuns.map((x) => wallClock(x.date, 'Europe/Rome').d), [26, 27, 29]); // 28 Mar 2027 has no 02:30
});

test('saved schedule round-trips and gives the same runs', () => {
  const r = parseSchedule('every other saturday at 10am', { timezone: 'Europe/Rome', now: AT, nextCount: 4 });
  const saved = readSchedule(JSON.stringify(r.schedule))!;
  assert.equal(saved.everyWeeks, 2);
  assert.equal(saved.timezone, 'Europe/Rome');
  assert.deepEqual(scheduleNextRuns(saved, 4, AT).map((x) => x.date.getTime()), r.nextRuns.map((x) => x.date.getTime()));
  assert.equal(readSchedule('not json'), null);
});

test('createTrigger fires on schedule (fake timers)', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 2, 10, 0, 30) });
  try {
    const fired: string[] = [];
    const t = createTrigger('every 15 minutes', (e) => fired.push(e.date.toISOString()), { timezone: 'UTC' });
    assert.equal(t.next()!.toISOString(), '2026-10-02T10:15:00.000Z');
    advance(14.5 * 60_000);
    assert.deepEqual(fired, ['2026-10-02T10:15:00.000Z']);
    advance(30 * 60_000);
    assert.equal(fired.length, 3);
    t.stop();
    advance(60 * 60_000);
    assert.equal(fired.length, 3);
    assert.equal(t.next(), null);
  } finally {
    mock.timers.reset();
  }
});

test('createTrigger respects every-N-weeks from a saved schedule', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 2, 10) });
  try {
    const r = parseSchedule('every two weeks on saturday at 10am', { timezone: 'UTC', now: new Date(Date.UTC(2026, 9, 2, 10)) });
    const fired: number[] = [];
    const t = createTrigger(r.schedule!, (e) => fired.push(e.date.getUTCDate()));
    advance(5 * 7 * 86400_000);
    assert.deepEqual(fired, [3, 17, 31]);
    t.stop();
  } finally {
    mock.timers.reset();
  }
});

test('createTrigger: a run missed while asleep fires once on wake-up (late) and does not replay', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 2, 10, 0, 30) });
  try {
    const fired: boolean[] = [];
    const t = createTrigger('every 15 minutes', (e) => fired.push(e.late), { timezone: 'UTC' });
    mock.timers.tick(3 * 3600_000); // one big jump = device asleep for 3 h
    assert.deepEqual(fired, [true]);
    advance(15 * 60_000);
    assert.deepEqual(fired, [true, false]);
    t.stop();
  } finally {
    mock.timers.reset();
  }
});
