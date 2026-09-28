// Screen 1 verification in a real browser.
//  1. Opening frame vs the supplied artwork (pixel comparison done by tools/compare.py).
//  2. Interactions: tap to ride, left/right controls, coins, gates, pause, retry.
//  3. Screenshots at several phone sizes.
// Usage: node scripts/screen1-check.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = 'playtest-output';
fs.mkdirSync(out, { recursive: true });
const exe = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

async function open(w, h, dpr = 1) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  await page.evaluate(() => window.__skz.manual(true));
  await page.evaluate(() => window.__skz.advance(0.05));
  return { page, errors };
}
const shot = async (page, name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
};

// ---- 1. Exact-size render (512x1024 @1x) for pixel comparison.
{
  const { page, errors } = await open(512, 1024);
  await shot(page, 's1-open-512');
  let st = await page.evaluate(() => window.__skz.state());
  check(st.state === 'ready' && st.base === 'artwork', 'opens on the supplied artwork, waiting for the player');
  check(Math.abs(st.rect.s - 1) < 1e-6 && st.rect.x === 0 && st.rect.y === 0, 'artwork mapped 1:1 at 512x1024');
  await page.evaluate(() => window.__skz.start());
  await page.evaluate(() => window.__skz.advance(0));
  await shot(page, 's1-layers-512');
  st = await page.evaluate(() => window.__skz.state());
  check(st.state === 'riding' && st.base !== 'artwork', 'tap starts the ride on the layered version');
  check(errors.length === 0, `no errors (${errors.join(' | ')})`);
  await page.close();
}

// ---- 2. Interactions on a phone-sized screen.
{
  const { page, errors } = await open(412, 915, 1);
  await shot(page, 's1-open-phone');
  // Tap the painted left arrow: starts the ride and moves left.
  await page.dispatchEvent('.hitbox-left', 'pointerdown');
  let st = await page.evaluate(() => window.__skz.advance(0.05));
  check(st.state === 'riding', 'pressing the painted left arrow starts riding');
  st = await page.evaluate(() => window.__skz.advance(0.4));
  check(st.lane === -1 && Math.abs(st.lanePos + 1) < 0.05, 'left arrow moves the boy to the left lane (smoothly)');
  await page.dispatchEvent('.hitbox-left', 'pointerdown');
  st = await page.evaluate(() => window.__skz.advance(0.3));
  check(st.lane === -1, 'cannot go further left than the rail');
  await page.dispatchEvent('.hitbox-right', 'pointerdown');
  st = await page.evaluate(() => window.__skz.advance(0.4));
  check(st.lane === 0, 'right arrow moves back to the centre');
  st = await page.evaluate(() => window.__skz.advance(1.6));
  check(st.coins > 286, `collects coins on the gold rail (${st.coins})`);
  check(st.score > 24580 && st.seconds > 82, `score and timer run (${st.score}, ${st.seconds.toFixed(1)}s)`);
  check(st.d > 2, `forward movement along the rail (d=${st.d.toFixed(2)})`);
  await shot(page, 's1-riding-phone');
  // Pause via the painted pause button.
  await page.dispatchEvent('.hitbox-pause', 'pointerdown');
  st = await page.evaluate(() => window.__skz.advance(0.5));
  check(st.state === 'paused', 'painted pause button pauses');
  const d0 = st.d;
  st = await page.evaluate(() => window.__skz.advance(1));
  check(st.d === d0, 'ride frozen while paused');
  await shot(page, 's1-paused-phone');
  await page.click('text=RESUME');
  st = await page.evaluate(() => window.__skz.advance(0.5));
  check(st.state === 'riding' && st.d > d0, 'resume continues');
  // Ride straight without steering until a gate is hit.
  let crashed = false;
  for (let i = 0; i < 80 && !crashed; i++) {
    st = await page.evaluate(() => window.__skz.advance(0.25));
    crashed = st.state === 'crashed';
    if (i === 6) await shot(page, 's1-riding2-phone');
  }
  check(crashed, 'riding into a red X gate causes a wipeout');
  st = await page.evaluate(() => window.__skz.advance(1.3));
  await shot(page, 's1-wipeout-phone');
  check(await page.isVisible('text=TRY AGAIN'), 'wipeout card offers TRY AGAIN');
  await page.click('text=TRY AGAIN');
  st = await page.evaluate(() => window.__skz.advance(0.05));
  check(st.state === 'ready' && st.base === 'artwork' && st.score === 24580 && st.coins === 286, 'retry returns to the exact opening screen');
  check(errors.length === 0, `no errors (${errors.join(' | ')})`);
  await page.close();
}

// ---- 3. Other screen shapes: the full artwork must stay visible, undistorted.
for (const [name, w, h] of [['s8', 360, 740], ['small', 360, 640], ['tablet', 800, 1280], ['desktop', 1280, 800]]) {
  const { page } = await open(w, h, 1);
  const st = await page.evaluate(() => window.__skz.state());
  const r = st.rect;
  const fits = r.x >= -0.5 && r.y >= -0.5 && r.x + 512 * r.s <= w + 0.5 && r.y + 1024 * r.s <= h + 0.5;
  check(fits, `${name} ${w}x${h}: whole artwork visible at scale ${r.s.toFixed(3)} (no crop, no stretch)`);
  await shot(page, `s1-open-${name}`);
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
