// Builds a single image showing the boy at each lane, side by side, so the
// character's movement can be seen without playing the video.
// Usage: node scripts/gameplay-strip.mjs
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
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1, hasTouch: true });
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(() => window.__skz.manual(true));
await page.evaluate(() => window.__skz.start());
await page.evaluate(() => window.__skz.advance(1.2));

const swipe = async (dx, ms = 120, steps = 6) => {
  await page.mouse.move(206, 620);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(206 + (dx * i) / steps, 620);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
};

const shots = [];
const grab = async (label) => {
  const s = await page.evaluate(() => window.__skz.state());
  shots.push({ label, x: s.boy.x, buf: (await page.screenshot()).toString('base64') });
};
await page.evaluate(() => window.__skz.advance(0.8));
await grab('CENTRE');
await swipe(-90);
await page.evaluate(() => window.__skz.advance(0.7));
await grab('LEFT');
await swipe(90);
await swipe(90);
await page.evaluate(() => window.__skz.advance(0.9));
await grab('RIGHT');

// Compose the strip in the page, where a canvas is available.
const png = await page.evaluate(async ({ shots, w, h }) => {
  const pad = 14;
  const bar = 46;
  const c = document.createElement('canvas');
  c.width = shots.length * w + (shots.length + 1) * pad;
  c.height = h + bar + pad * 2;
  const x = c.getContext('2d');
  x.fillStyle = '#0b1430';
  x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < shots.length; i++) {
    const img = new Image();
    img.src = `data:image/png;base64,${shots[i].buf}`;
    await img.decode();
    const ox = pad + i * (w + pad);
    x.drawImage(img, ox, pad);
    // A plumb line at the boy's feet makes the travel between lanes obvious.
    x.strokeStyle = '#ffd940';
    x.lineWidth = 2;
    x.setLineDash([7, 6]);
    x.beginPath();
    x.moveTo(ox + shots[i].x, pad);
    x.lineTo(ox + shots[i].x, pad + h);
    x.stroke();
    x.setLineDash([]);
    x.fillStyle = '#fff';
    x.font = '700 22px system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillText(`${shots[i].label}  —  boy at ${Math.round(shots[i].x)}px`, ox + w / 2, pad + h + 30);
  }
  return c.toDataURL('image/png').split(',')[1];
}, { shots, w: SIZE.width, h: SIZE.height });

fs.writeFileSync(`${out}/lane-movement.png`, Buffer.from(png, 'base64'));
console.log(shots.map((s) => `${s.label}: boy at ${s.x.toFixed(0)}px`).join('\n'));
console.log(`travel: ${(shots[2].x - shots[1].x).toFixed(0)}px between lanes`);
console.log(`wrote ${out}/lane-movement.png`);
await browser.close();
