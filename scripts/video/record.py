"""Record the LinkedIn demo video of the real <cron-ai> widget.
Usage: python3 scripts/video/record.py   (needs playwright + ffmpeg; run npm run build:widget first)
Output: docs/media/cronai-linkedin-4x5.mp4 (1080x1350, 30 fps)
"""
import asyncio, base64, random, json, os, pathlib, subprocess, tempfile
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent.parent
from playwright.async_api import async_playwright
OUT=tempfile.mkdtemp(prefix='cronai-frames-')
SENTENCES=[("evry secnd tuesday of the month at 10am",2.0),
           ("every 90 minutes",1.8),
           ("last fridy of the month at 6pm",1.8),
           ("on christmas at noon",2.6)]
random.seed(7)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':540,'height':675},device_scale_factor=2)
        pg=await ctx.new_page()
        await pg.goto((HERE/'stage.html').as_uri())
        await pg.wait_for_timeout(1000)
        inp=pg.locator('cron-ai textarea'); await inp.click(); await inp.fill('evrey wensday and fridy at half past 4 in the afternoon'); await pg.wait_for_timeout(1200)
        cdp=await ctx.new_cdp_session(pg); frames=[]
        async def on_frame(ev):
            frames.append((ev['metadata']['timestamp'], ev['data']))
            try: await cdp.send('Page.screencastFrameAck',{'sessionId':ev['sessionId']})
            except Exception: pass
        cdp.on('Page.screencastFrame', lambda ev: asyncio.ensure_future(on_frame(ev)))
        await cdp.send('Page.startScreencast',{'format':'png','maxWidth':1080,'maxHeight':1350,'everyNthFrame':1})
        t0=asyncio.get_event_loop().time()
        await pg.wait_for_timeout(2600)
        for i,(text,hold) in enumerate(SENTENCES):
            if True:
                n=len(await inp.input_value())
                for _ in range(n): await pg.keyboard.press('Backspace'); await pg.wait_for_timeout(12)
                await pg.wait_for_timeout(250)
            for ch in text:
                await pg.keyboard.type(ch); await pg.wait_for_timeout(random.randint(35,80) + (260 if ch==' ' else 0))
            await pg.wait_for_timeout(int(hold*1000))
        end=asyncio.get_event_loop().time()
        await pg.wait_for_timeout(300)
        await cdp.send('Page.stopScreencast')
        await b.close()
    frames.sort()
    ts0=frames[0][0]; meta=[]
    for k,(t,d) in enumerate(frames):
        fn=f'{OUT}/f{k:05d}.png'; open(fn,'wb').write(base64.b64decode(d)); meta.append((fn,t-ts0))
    lst=os.path.join(OUT,'list.txt'); lines=[]
    for i,(fn,t) in enumerate(meta):
        nxt=meta[i+1][1] if i+1<len(meta) else t+1.5
        lines.append(f"file '{fn}'\nduration {max(nxt-t,0.001):.4f}")
    lines.append(f"file '{meta[-1][0]}'"); open(lst,'w').write('\n'.join(lines)+'\n')
    out=ROOT/'docs'/'media'/'cronai-linkedin-4x5.mp4'; out.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',lst,'-vf','fps=30,scale=1080:1350:flags=lanczos,format=yuv420p','-c:v','libx264','-preset','slow','-crf','17','-profile:v','high','-movflags','+faststart',str(out)],check=True)
    print(len(frames),'frames ->',out)
asyncio.run(main())
