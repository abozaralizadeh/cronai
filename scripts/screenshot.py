"""Capture screenshots of the web demo for docs/story (uses Playwright + Chromium)."""
import sys, asyncio
from playwright.async_api import async_playwright

URL = "file://" + __import__("os").path.abspath("web/dist/index.html")
OUT = "docs/screenshots"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 430, "height": 1400}, device_scale_factor=2, color_scheme="dark")
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{OUT}/01-aurora.png", full_page=True)
        # type a complex sentence with typos
        ta = pg.locator("textarea").first
        await ta.fill("evrey wensday and fridy at half past 4 in the afternoon except in august")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=f"{OUT}/02-typos.png", full_page=True)
        names = ["Paper", "Terminal", "Sunset", "Glacier", "Forest", "Candy"]
        samples = ["at 9:15 and 17:45 on weekdays", "every 90 minutes", "last friday of every month at 6pm",
                   "every 15 minutes during business hours", "first monday of each quarter at 9am", "twice a day on weekends"]
        for i, (n, s) in enumerate(zip(names, samples)):
            await pg.get_by_label(f"{n} theme").click()
            await ta.fill(s)
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=f"{OUT}/{i+3:02d}-{n.lower()}.png", full_page=True)
        # arm trigger with every minute
        await pg.get_by_label("Aurora theme").click()
        await ta.fill("every minute")
        await pg.wait_for_timeout(500)
        await pg.get_by_role("switch").click()
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f"{OUT}/09-armed.png", full_page=True)
        await b.close()
        print("errors:", errors[:10])

asyncio.run(main())
