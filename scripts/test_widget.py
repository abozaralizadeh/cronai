"""End-to-end check of the <cron-ai> widget builds (Playwright + Chromium). Run after `npm run build:widget`."""
import asyncio, os, sys
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + os.path.join(ROOT, 'widget/demo.html')
SHOTS = os.path.join(ROOT, 'docs/screenshots')
fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 600, 'height': 2600}, device_scale_factor=2)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        cron = lambda sel: pg.evaluate(f"document.querySelector('{sel}').cron")
        check(await cron('#mini') == '0 9 * * 1-5', 'mini parses value attribute')
        check(await cron('#compact') == '30 16 * * 3', 'compact corrects typos with CronLex')
        check(await pg.evaluate("document.querySelector('#full').crons.length") == 2, 'full: every 90 minutes -> 2 lines')
        # typing into the mini widget
        inp = pg.locator('#mini').locator('input')
        await inp.fill('every 10 mins mon to fri 8am-6pm')
        await pg.wait_for_timeout(400)
        check(await cron('#mini') == '*/10 8-17 * * 1-5', 'typing updates cron')
        check('cronchange mini */10 8-17 * * 1-5' in await pg.inner_text('#log'), 'cronchange event bubbles with detail')
        # property setter
        await pg.evaluate("document.querySelector('#full').value = 'christmas at 8am'")
        await pg.wait_for_timeout(100)
        check(await cron('#full') == '0 8 25 12 *', 'value property setter')
        # form association
        await pg.click('#f button')
        check('"schedule":"0 18 * * 5L"' in await pg.inner_text('#formout'), 'form submits cron under name')
        # every N weeks: weekly cron + week guard, runs 14 days apart, guard box shown
        await pg.evaluate("document.querySelector('#full').value = 'every two weeks on saturday at 10am'")
        await pg.wait_for_timeout(100)
        g = await pg.evaluate("""(() => { const el = document.querySelector('#full'); const r = el.result;
            const d = r.nextRuns.map(x => x.date.getTime());
            return { cron: el.cron, n: r.guard && r.guard.everyWeeks, gaps: d.slice(1).map((t, i) => Math.round((t - d[i]) / 864e5)),
                     shown: !el.shadowRoot.querySelector('.guard').hidden, code: el.shadowRoot.querySelector('.gcode').textContent }; })()""")
        check(g['cron'] == '0 10 * * 6' and g['n'] == 2, f'every two weeks -> weekly cron + guard ({g["cron"]}, {g["n"]})')
        check(all(x == 14 for x in g['gaps']), f'next runs are 14 days apart {g["gaps"]}')
        check(g['shown'] and '604800' in g['code'], 'guard box shows guarded crontab line')
        same = await pg.evaluate("(() => { const el = document.querySelector('#full'); el.value = 'every saturday at 10am'; return [el.cron, el.result.guard]; })()")
        check(same[0] == '0 10 * * 6' and same[1] is None, 'every saturday has no guard')
        await pg.evaluate("const f = document.querySelector('#f cron-ai'); f.value = 'every other monday at 9am'")
        await pg.wait_for_timeout(50)
        await pg.click('#f button')
        fo = await pg.inner_text('#formout')
        check('\\"everyWeeks\\":2' in fo and '"schedule":"0 9 * * 1"' in fo, f'form submits <name>-json with the saved schedule {fo[:160]}')
        await pg.evaluate("const f = document.querySelector('#f cron-ai'); f.value = 'last friday of every month at 6pm'")
        # ---- user mode: no cron jargon, times in the visitor's chosen zone, schedule JSON
        u = await pg.evaluate("""(() => { const el = document.querySelector('#user'); const sr = el.shadowRoot;
            return { tiles: !!sr.querySelector('.tiles'), code: !!sr.querySelector('code'), text: sr.textContent,
                     runs: sr.querySelectorAll('.runs li').length, sched: el.schedule }; })()""")
        check(not u['tiles'] and not u['code'], 'user mode hides tiles and cron')
        check('cron' not in u['text'].lower(), 'user mode shows no "cron" wording')
        check(u['runs'] == 3, f'user compact shows 3 upcoming runs ({u["runs"]})')
        check(u['sched']['timezone'] == 'America/New_York' and u['sched']['everyWeeks'] == 2, f'schedule JSON carries timezone + every-N-weeks {u["sched"]}')
        await pg.click('#uf button')
        uo = await pg.inner_text('#ufout')
        check('"freq":"0 17 * * 5"' in uo and 'freq-json' in uo and 'America/New_York' in uo, 'user form submits cron + json')
        # ---- show / hide / strings
        c = await pg.evaluate("""(() => { const sr = document.querySelector('#custom').shadowRoot;
            return { title: sr.querySelector('.title')?.textContent, tiles: !!sr.querySelector('.tiles'), chips: !sr.querySelector('.chips')?.closest('[part=chips]')?.isConnected,
                     ex: !!sr.querySelector('.ex'), label: [...sr.querySelectorAll('.label')].map(x => x.textContent) }; })()""")
        check(c['title'] == 'Ogni quanto?' and 'Prossime esecuzioni' in c['label'], f'strings attribute re-words the UI {c}')
        check(c['tiles'] and not c['ex'], 'show adds tiles, hide removes examples')
        # ---- strings property + mode switch at runtime
        await pg.evaluate("const el = document.querySelector('#custom'); el.strings = { heading: 'Frequenza' }; el.mode = 'developer'")
        t2 = await pg.evaluate("document.querySelector('#custom').shadowRoot.querySelector('.title').textContent")
        check(t2 == 'Frequenza', 'strings property + mode switch at runtime')
        # ---- restore a saved schedule keeps the same weeks
        same = await pg.evaluate("""(() => { const a = document.querySelector('#user'); const saved = JSON.stringify(a.schedule);
            const first = a.nextRuns[0].getTime(); const b = document.createElement('cron-ai'); b.setAttribute('mode','user');
            document.body.append(b); b.schedule = saved; const r = [b.value, b.timezone, b.nextRuns[0].getTime() === first]; b.remove(); return r; })()""")
        check(same[0] == 'every other friday at 5pm' and same[1] == 'America/New_York' and same[2], f'el.schedule = saved restores text, zone and weeks {same}')
        # ---- CMS: restores from the hidden field and writes JSON back
        cms = await pg.evaluate("(() => { const el = document.querySelector('[data-cronai][data-mode=user] cron-ai'); return [el.value, el.timezone, el.cron]; })()")
        check(cms == ['every weekday at 7:30am', 'Europe/Rome', '30 7 * * 1-5'], f'data-target restores saved JSON {cms}')
        await pg.evaluate("const el = document.querySelector('[data-cronai][data-mode=user] cron-ai'); el.value = 'every sunday at noon'")
        await pg.wait_for_timeout(50)
        sv = await pg.input_value('#saved')
        check('"crons":["0 12 * * 0"]' in sv, 'data-target-value=json writes the schedule JSON')
        # ---- headless API: createTrigger available on the global
        api = await pg.evaluate("[typeof CronAI.createTrigger, typeof CronAI.scheduleNextRuns, CronAI.sections.length, CronAI.modes.join()]")
        check(api[0] == 'function' and api[1] == 'function' and api[2] == 17 and api[3] == 'developer,user', f'global API exposed {api}')
        trig = await pg.evaluate("""(() => { const t = CronAI.createTrigger('every weekday at 9am', () => {}, { timezone: 'Asia/Tokyo' }); const n = t.next(); t.stop(); return n.toISOString(); })()""")
        check(trig.endswith('T00:00:00.000Z'), f'createTrigger honours timezone (9:00 Tokyo = 00:00 UTC) {trig}')
        # data-cronai + target sync
        await pg.wait_for_timeout(200)
        check(await pg.input_value('#plain') == '0 0,12 * * 0,6', 'data-cronai auto-mount syncs target input')
        # iframe postMessage
        await pg.wait_for_timeout(800)
        check('iframe change "*/15 9-16 * * 1-5"' in await pg.inner_text('#log'), 'iframe embed posts change to parent')
        # theme switch
        await pg.evaluate("document.querySelector('#compact').theme = 'sunset'")
        await pg.wait_for_timeout(100)
        bg = await pg.evaluate("getComputedStyle(document.querySelector('#compact').shadowRoot.querySelector('.card')).backgroundColor")
        check(bg == 'rgb(36, 20, 28)', f'theme attribute switches palette ({bg})')
        # trigger
        await pg.evaluate("document.querySelector('#full').value = 'every minute'")
        await pg.wait_for_timeout(100)
        await pg.evaluate("document.querySelector('#full').arm()")
        await pg.wait_for_timeout(300)
        armed = await pg.evaluate("document.querySelector('#full').shadowRoot.querySelector('.switch').getAttribute('aria-checked')")
        check(armed == 'true', 'arm() arms the trigger')
        await pg.evaluate("document.querySelector('#full').disarm(); document.querySelector('#full').value = 'every 90 minutes'")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.path.join(SHOTS, 'widget-test-page.png'), full_page=True)
        check(not errors, f'no console errors {errors[:3]}')

        # engine bundle runs in Node (for backends that execute visitors' schedules)
        import subprocess
        node = subprocess.run(['node', '--input-type=module', '-e',
            "import('" + os.path.join(ROOT, 'widget/dist/cronai-engine.esm.js') + "').then(m => { const r = m.parseSchedule('every other monday at 9am', { timezone: 'Europe/Rome' }); console.log(JSON.stringify([r.crons[0], r.schedule.everyWeeks, r.schedule.timezone, m.scheduleNextRuns(r.schedule, 2).length])) })"],
            capture_output=True, text=True)
        check(node.stdout.strip() == '["0 9 * * 1",2,"Europe/Rome",2]', f'engine ESM works in Node {node.stdout.strip() or node.stderr[:200]}')
        # lite build
        lp = await b.new_page()
        await lp.add_script_tag(path=os.path.join(ROOT, 'widget/dist/cronai-widget.lite.js'))
        r = await lp.evaluate("[CronAI.build, CronAI.parse('every weekday at 9am').crons[0], CronAI.parse('evry wensday at 9pm').ok]")
        check(r[0] == 'lite' and r[1] == '0 9 * * 1-5', f'lite build parses exact words {r}')
        await b.close()
    print(f'\n{len(fails)} failure(s)')
    sys.exit(1 if fails else 0)

asyncio.run(main())
