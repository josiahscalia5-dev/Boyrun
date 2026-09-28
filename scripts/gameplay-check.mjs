// Gameplay Screen verification in a real browser.
//  1. The opening frame, rebuilt from the artwork's layers, vs the artwork.
//  2. Interactions: tap to ride, left/right controls, coins, gates, pause, retry.
//  3. Screenshots at several phone sizes; the HUD must stay in the safe area.
// Usage: node scripts/gameplay-check.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = 'playtest-output';
const ART = [1024, 1536];
fs.mkdirSync(out, { recursive: true });
/** Playwright's bundled Chromium, wherever this machine keeps it. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = ['/opt/pw-browsers', `${process.env.HOME}/.cache/ms-playwright`];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const exe = `${root}/${dir}/chrome-linux/chrome`;
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined; // let Playwright look for its own download
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

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

// ---- 1. The artwork's own shape: the rebuilt frame must be the painting.
{
  const { page, errors } = await open(ART[0], ART[1]);
  await shot(page, 'open-artwork-size');
  const st = await page.evaluate(() => window.__skz.state());
  check(st.state === 'ready', 'opens on the Gameplay Screen, waiting for the player');
  check(Math.abs(st.world.s - 1) < 1e-6 && Math.abs(st.world.x) < 0.5 && Math.abs(st.world.y) < 0.5, 'artwork mapped 1:1 at 1024x1536');
  check(Math.abs(st.hud.scale - 1) < 1e-6, 'HUD drawn at its painted size');
  // Every painted HUD panel back where the artwork paints it.
  const painted = await page.evaluate(async () => {
    const L = (await import('/src/gameplay/layout.json')).default;
    const p = window.__skz.state().hud.panels;
    return Object.entries(p).map(([k, r]) => [k, Math.abs(r.x - L.ui[k].x) + Math.abs(r.y - L.ui[k].y)]);
  });
  for (const [name, off] of painted) check(off < 0.5, `${name} panel sits exactly where it is painted`);

  // Pixel comparison of the rebuilt opening frame against the supplied image.
  const fid = await page.evaluate(async ([w, h]) => {
    const art = new Image();
    art.src = '/docs/reference/1-gameplay-screen-hd.png';
    await art.decode();
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    const a = mk();
    const actx = a.getContext('2d');
    for (const layer of document.querySelectorAll('canvas.layer')) actx.drawImage(layer, 0, 0, w, h);
    const b = mk();
    b.getContext('2d').drawImage(art, 0, 0, w, h);
    const pa = actx.getImageData(0, 0, w, h).data;
    const pb = b.getContext('2d').getImageData(0, 0, w, h).data;
    let within8 = 0;
    let within24 = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d <= 8) within8++;
      if (d <= 24) within24++;
    }
    const n = (w * h) / 100;
    return { within8: within8 / n, within24: within24 / n };
  }, ART);
  console.log(`      opening frame vs artwork: ${fid.within8.toFixed(2)}% within 8 levels, ${fid.within24.toFixed(2)}% within 24`);
  check(fid.within24 > 90, `the rebuilt opening frame is the artwork (${fid.within24.toFixed(1)}% within 24 levels)`);
  await page.evaluate(() => window.__skz.start());
  await page.evaluate(() => window.__skz.advance(0.6));
  await shot(page, 'riding-artwork-size');
  check((await page.evaluate(() => window.__skz.state())).state === 'riding', 'tap starts the ride');
  check(errors.length === 0, `no errors (${errors.join(' | ')})`);
  await page.close();
}

// ---- 2. Interactions on a phone-sized screen.
{
  const { page, errors } = await open(412, 915, 1);
  await shot(page, 'open-phone');
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
  st = await page.evaluate(() => window.__skz.advance(1.8));
  check(st.coins > 286, `collects coins on the gold rail (${st.coins})`);
  check(st.score > 24580 && st.seconds > 82, `score and timer run (${st.score}, ${st.seconds.toFixed(1)}s)`);
  check(st.d > 2, `forward movement along the rail (d=${st.d.toFixed(2)})`);
  await shot(page, 'riding-phone');
  // Pause via the painted pause button.
  await page.dispatchEvent('.hitbox-pause', 'pointerdown');
  st = await page.evaluate(() => window.__skz.advance(0.5));
  check(st.state === 'paused', 'painted pause button pauses');
  const d0 = st.d;
  st = await page.evaluate(() => window.__skz.advance(1));
  check(st.d === d0, 'ride frozen while paused');
  await shot(page, 'paused-phone');
  await page.click('text=RESUME');
  st = await page.evaluate(() => window.__skz.advance(0.5));
  check(st.state === 'riding' && st.d > d0, 'resume continues');
  // Ride straight without steering until a gate is hit.
  let crashed = false;
  for (let i = 0; i < 90 && !crashed; i++) {
    st = await page.evaluate(() => window.__skz.advance(0.25));
    crashed = st.state === 'crashed';
    if (i === 6) await shot(page, 'riding2-phone');
  }
  check(crashed, 'riding into a red X gate causes a wipeout');
  await page.evaluate(() => window.__skz.advance(1.3));
  await shot(page, 'wipeout-phone');
  check(await page.isVisible('text=TRY AGAIN'), 'wipeout card offers TRY AGAIN');
  await page.click('text=TRY AGAIN');
  st = await page.evaluate(() => window.__skz.advance(0.05));
  check(st.state === 'ready' && st.score === 24580 && st.coins === 286, 'retry returns to the opening screen');
  check(errors.length === 0, `no errors (${errors.join(' | ')})`);
  await page.close();
}

// ---- 3. Other screen shapes: full-bleed world, HUD reachable inside the screen.
for (const [name, w, h] of [['s8', 360, 740], ['small', 360, 640], ['tall', 412, 1000], ['tablet', 800, 1280], ['desktop', 1280, 800]]) {
  const { page } = await open(w, h, 1);
  const st = await page.evaluate(() => window.__skz.state());
  const r = st.world;
  const undistorted = r.s > 0;
  const coversOrFits = r.x <= 0.5 && r.y <= 0.5 ? r.x + ART[0] * r.s >= w - 0.5 && r.y + ART[1] * r.s >= h - 0.5 : true;
  check(undistorted && coversOrFits, `${name} ${w}x${h}: world drawn at scale ${r.s.toFixed(3)}, never stretched`);
  const inside = Object.entries(st.hud.panels).every(([, p]) => p.x >= -0.5 && p.y >= -0.5 && p.x + p.w <= w + 0.5 && p.y + p.h <= h + 0.5);
  check(inside, `${name} ${w}x${h}: every HUD panel and control is on screen`);
  await shot(page, `open-${name}`);
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
