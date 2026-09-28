// Quick visual check: renders key moments of the Gameplay Screen at phone
// sizes into playtest-output/. Usage: node scripts/shots.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = 'playtest-output';
fs.mkdirSync(out, { recursive: true });

const exe = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const devices = (process.env.DEVICES ?? 'pixel7').split(',');
const SIZES = {
  pixel7: { width: 412, height: 915, dpr: 1 },
  s8: { width: 360, height: 740, dpr: 1 },
  small: { width: 360, height: 640, dpr: 1 },
  tall: { width: 384, height: 854, dpr: 1 },
  tablet: { width: 800, height: 1280, dpr: 1 },
  desktop: { width: 1280, height: 800, dpr: 1 },
};

for (const name of devices) {
  const size = SIZES[name];
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__skz, null, { timeout: 60000 });
  await page.evaluate(() => window.__skz.manual(true));
  if (process.env.QUALITY) await page.evaluate((q) => window.__skz.setQuality(q), process.env.QUALITY);
  if (process.env.EVAL) await page.evaluate(process.env.EVAL);
  await page.evaluate(() => window.__skz.advance(0.5));
  await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${name}-0-title.png`, animations: 'disabled' });
  await page.evaluate(() => window.__skz.start());
  const shots = (process.env.SHOTS ?? '2.6,4,7').split(',').map(Number);
  let t = 0;
  await page.evaluate(() => window.__skz.autopilot(true));
  for (const at of shots) {
    const st = await page.evaluate((d) => window.__skz.advance(d), at - t);
    t = at;
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${name}${process.env.TAG ?? ''}-t${at}.png`, animations: 'disabled' });
    console.log(name, at, JSON.stringify(st));
  }
  if (errors.length) console.log('console:', errors.slice(0, 10).join('\n'));
  await page.close();
}
await browser.close();
