// Close-up of the ride gear while steering: are the boots, the nozzles and
// the jet plume one connected piece at full lock, or do they come apart?
// Usage: node scripts/board-check.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const out = 'playtest-output';
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const root of ['/opt/pw-browsers', `${process.env.HOME}/.cache/ms-playwright`]) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      const exe = `${root}/${d}/chrome-linux/chrome`;
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const base = process.argv[2] ?? 'http://localhost:5173/';
// Render at the artwork's own size so the crop is in artwork pixels.
const SIZE = { width: 1024, height: 1536 };
const CROP = { x: 250, y: 1080, width: 520, height: 456 };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1, hasTouch: true });
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(() => window.__skz.manual(true));
await page.evaluate(() => window.__skz.start());
await page.evaluate(() => window.__skz.advance(1.0));

const shots = [];
const grab = async (label) => {
  shots.push({ label, buf: (await page.screenshot({ clip: CROP })).toString('base64') });
};
const steer = async (lane, settle = 0.9) => {
  await page.evaluate((l) => window.__skz.screen.steerTo(l), lane);
  await page.evaluate((s) => window.__skz.advance(s), settle);
};
await steer(-1);
await grab('LEFT LOCK');
await steer(0);
await grab('CENTRE');
await steer(1);
await grab('RIGHT LOCK');
// Mid-turn, when any disconnect is worst.
await page.evaluate(() => window.__skz.screen.steerTo(-1));
await page.evaluate(() => window.__skz.advance(0.09));
await grab('MID-TURN');

const png = await page.evaluate(async ({ shots, w, h }) => {
  const pad = 12;
  const bar = 40;
  const c = document.createElement('canvas');
  c.width = shots.length * w + (shots.length + 1) * pad;
  c.height = h + bar + pad * 2;
  const x = c.getContext('2d');
  x.fillStyle = '#12002a';
  x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < shots.length; i++) {
    const img = new Image();
    img.src = `data:image/png;base64,${shots[i].buf}`;
    await img.decode();
    x.drawImage(img, pad + i * (w + pad), pad);
    x.fillStyle = '#fff';
    x.font = '700 22px system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillText(shots[i].label, pad + i * (w + pad) + w / 2, pad + h + 28);
  }
  return c.toDataURL('image/png').split(',')[1];
}, { shots, w: CROP.width, h: CROP.height });

fs.writeFileSync(`${out}/board-check.png`, Buffer.from(png, 'base64'));
console.log(`wrote ${out}/board-check.png`);
await browser.close();
