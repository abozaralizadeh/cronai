import { parseSchedule } from '../src/engine';
const phrases = process.argv.slice(2).length ? process.argv.slice(2) : [
 'every 5 minutes','every weekday at 9am','every 15 minutes during business hours',
 'at 9:15 and 17:45 on mondays','every other day at noon','on the last friday of every month at 6pm',
 'first monday of the month at 9','every 90 minutes','every 2 hours between 8am and 8pm on weekends',
 'twice a day','every day except sunday at 7:30am','quarterly on the 15th at 10am',
 'every wensday and fridy at half past 4 in the afternoon','every night at 11','christmas at 8am',
 'every 10 minutes from 9 to 5 monday to friday except in august','hourly','at 5 past every hour',
 'on the 1st and 15th at midnight','every 3 months starting in february','mon-fri 9-5 every 30 mins',
 'last day of the month at 23:59','every evrey 20 minuts on weekedns', 'backup the database every night at 2am',
 'every sunday morning','3 times a day between 9am and 5pm','every year on march 15 at 10am','*/5 * * * *',
 'every second tuesday of the month at 18:00','every 45 minutes','at 9am, 1pm and 6pm on weekdays','in summer every saturday at 7',
 'every hour on the hour from 9am to 5pm','quarter to 10 every weekday','every 2 weeks on monday','every 30 seconds','hello world'
];
for (const p of phrases) {
  const r = parseSchedule(p, { now: new Date(2026, 9, 2, 12, 0) });
  console.log(`${p.padEnd(62)} => ${r.ok ? r.crons.join(' | ') : 'ERR ' + r.error}   [${r.confidence}]`);
  if (r.ok) console.log(' '.repeat(66) + r.description + (r.corrections.length ? '  {' + r.corrections.map(c=>c.from+'→'+c.to).join(', ') + '}' : '') + (r.warnings.length ? '  !' + r.warnings.join(' / ') : '') + (r.assumptions.length ? '  ~' + r.assumptions.join(' / ') : ''));
}
