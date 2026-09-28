// Side-by-side: the same moment of the same run, depth planes off vs on.
// Usage: node scripts/parallax-compare.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const out = 'playtest-output';
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const root of ['/opt/pw-browsers', `${process.env.HOME}/.cache/ms-playwright`]) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const exe = `${root}/${dir}/chrome-linux/chrome`;
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const base = process.argv[2] ?? 'http://localhost:5173/';
const SIZE = { width: 412, height: 915 };
const AT = [2.0, 3.3, 4.6]; // seconds into the ride
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function run(on) {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1, hasTouch: true });
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  await page.evaluate((v) => window.__skz.parallax(v), on);
  await page.evaluate(() => window.__skz.manual(true));
  await page.evaluate(() => window.__skz.start());
  const shots = [];
  let t = 0;
  for (const at of AT) {
    await page.evaluate((dt) => window.__skz.advance(dt), at - t);
    t = at;
    shots.push((await page.screenshot()).toString('base64'));
  }
  await page.close();
  return shots;
}

const off = await run(false);
const on = await run(true);

const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
const png = await page.evaluate(async ({ off, on, w, h, at }) => {
  const pad = 14;
  const bar = 44;
  const cols = off.length;
  const c = document.createElement('canvas');
  c.width = cols * w + (cols + 1) * pad;
  c.height = 2 * (h + bar) + pad * 3;
  const x = c.getContext('2d');
  x.fillStyle = '#0b1430';
  x.fillRect(0, 0, c.width, c.height);
  const row = async (list, top, label) => {
    for (let i = 0; i < list.length; i++) {
      const img = new Image();
      img.src = `data:image/png;base64,${list[i]}`;
      await img.decode();
      const ox = pad + i * (w + pad);
      x.drawImage(img, ox, top);
      x.fillStyle = '#fff';
      x.font = '700 20px system-ui, sans-serif';
      x.textAlign = 'center';
      x.fillText(`${label}  —  ${at[i].toFixed(1)}s`, ox + w / 2, top + h + 28);
    }
  };
  await row(off, pad, 'DEPTH PLANES OFF');
  await row(on, pad * 2 + h + bar, 'DEPTH PLANES ON');
  return c.toDataURL('image/png').split(',')[1];
}, { off, on, w: SIZE.width, h: SIZE.height, at: AT });

fs.writeFileSync(`${out}/parallax-compare.png`, Buffer.from(png, 'base64'));
console.log(`wrote ${out}/parallax-compare.png`);
await browser.close();
