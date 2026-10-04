"""Render brand/favicon.svg into the PNG/ICO sizes browsers and phones ask for.
Usage: python3 scripts/make-icons.py   (needs playwright + Pillow). Output goes to brand/.
"""
import asyncio, base64, io, os, re
from playwright.async_api import async_playwright
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BRAND = os.path.join(ROOT, 'brand')
SIZES = {'favicon-16.png': 16, 'favicon-32.png': 32, 'favicon-48.png': 48, 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512}

async def main():
    svg = open(os.path.join(BRAND, 'favicon.svg')).read()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.set_content('<html><body></body></html>')
        for name, px in SIZES.items():
            # apple-touch-icon: iOS rounds the corners itself, so fill the square edge to edge
            src = re.sub(r'<rect id="edge"[^>]*/>', '', svg.replace('rx="15"', 'rx="0"')) if name == 'apple-touch-icon.png' else svg
            data = await pg.evaluate('''async ([svg, px]) => {
              const i = new Image(); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await i.decode();
              const c = document.createElement('canvas'); c.width = c.height = px;
              c.getContext('2d').drawImage(i, 0, 0, px, px); return c.toDataURL('image/png'); }''', [src, px])
            out = os.path.join(BRAND, name)
            Image.open(io.BytesIO(base64.b64decode(data.split(',')[1]))).save(out, optimize=True)
        await b.close()
    imgs = [Image.open(os.path.join(BRAND, f'favicon-{s}.png')) for s in (16, 32, 48)]
    imgs[2].save(os.path.join(BRAND, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)], append_images=imgs[:2])
    print('icons written to brand/:', ', '.join(list(SIZES) + ['favicon.ico']))

asyncio.run(main())
