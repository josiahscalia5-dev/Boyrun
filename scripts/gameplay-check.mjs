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
    return Object.keys(L.ui).filter((k) => k !== 'coin').map((k) => [k, Math.abs(p[k].x - L.ui[k].x) + Math.abs(p[k].y - L.ui[k].y)]);
  });
  for (const [name, off] of painted) check(off < 0.5, `${name} panel sits exactly where it is painted`);
  // The painted arrows stay as the artwork has them, but they must not
  // swallow a swipe that happens to begin on one.
  const swallow = await page.evaluate(() =>
    ['left', 'right'].map((n) => getComputedStyle(document.querySelector(`.hitbox-${n}`)).pointerEvents));
  check(swallow.every((v) => v === 'none'), 'the painted arrows let a swipe through to the game');

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
    let counted = 0;
    for (let i = 0; i < pa.length; i += 4) {
      counted++;
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d <= 8) within8++;
      if (d <= 24) within24++;
    }
    return { within8: (100 * within8) / counted, within24: (100 * within24) / counted };
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

  // Touch steering: a flick of the finger, anywhere on the screen.
  const swipe = async (dx, { ms = 120, steps = 6, from = [206, 620] } = {}) => {
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from[0] + (dx * i) / steps, from[1]);
      await page.waitForTimeout(ms / steps);
    }
    await page.mouse.up();
  };
  const tap = async () => {
    await page.mouse.move(206, 620);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
  };

  await tap();
  let st = await page.evaluate(() => window.__skz.advance(0.05));
  check(st.state === 'riding', 'a tap sets him off');
  const afterTap = st.lane;
  st = await page.evaluate(() => window.__skz.advance(0.4));
  check(st.lane === afterTap && st.lane === 0, 'a plain tap never steers him');
  await swipe(-90);
  st = await page.evaluate(() => window.__skz.advance(0.45));
  check(st.lane === -1 && Math.abs(st.lanePos + 1) < 0.06, 'SWIPE LEFT carries him to the left rail');
  await swipe(-90);
  st = await page.evaluate(() => window.__skz.advance(0.35));
  check(st.lane === -1, 'cannot swipe further left than the rail');
  await swipe(90);
  st = await page.evaluate(() => window.__skz.advance(0.45));
  check(st.lane === 0, 'SWIPE RIGHT brings him back to the centre');
  await swipe(90);
  st = await page.evaluate(() => window.__skz.advance(0.45));
  check(st.lane === 1, 'repeated swiping keeps stepping him across');
  // A slow drag steers continuously, and he follows the finger part-way.
  await page.mouse.move(206, 620);
  await page.mouse.down();
  await page.mouse.move(170, 620);
  await page.waitForTimeout(90);
  const mid = await page.evaluate(() => window.__skz.advance(0.18));
  await page.mouse.move(120, 620);
  await page.waitForTimeout(90);
  const far = await page.evaluate(() => window.__skz.advance(0.18));
  check(far.lanePos < mid.lanePos, `a drag steers him continuously (${mid.lanePos.toFixed(2)} -> ${far.lanePos.toFixed(2)})`);
  await page.mouse.up();
  st = await page.evaluate(() => window.__skz.advance(0.5));
  check(Number.isInteger(st.lane) && Math.abs(st.lanePos - st.lane) < 0.06, 'letting go settles him onto a rail');
  // Tapping a painted arrow is still honoured, as the secondary control.
  await page.evaluate(() => { window.__skz.screen.reset(); window.__skz.screen.start(); });
  await page.evaluate(() => window.__skz.advance(0.3));
  const arrowL = await page.evaluate(() => {
    const r = window.__skz.state().hud.panels.arrow_left;
    return [r.x + r.w / 2, r.y + r.h / 2];
  });
  await page.mouse.move(arrowL[0], arrowL[1]);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  st = await page.evaluate(() => window.__skz.advance(0.5));
  check(st.lane === -1, 'tapping the painted left arrow still steers him');
  // ---- The character must visibly move, in real screen pixels.
  {
    // From a clean start, so the measurement is from the centre rail.
    await page.evaluate(() => { window.__skz.screen.reset(); window.__skz.screen.start(); });
    const centre = await page.evaluate(() => window.__skz.advance(0.6));
    await swipe(-90);
    const left = await page.evaluate(() => window.__skz.advance(0.45));
    await swipe(90);
    await page.evaluate(() => window.__skz.advance(0.45));
    await swipe(90);
    const turning = await page.evaluate(() => window.__skz.advance(0.12));
    const right = await page.evaluate(() => window.__skz.advance(0.33));
    const leftPx = centre.boy.x - left.boy.x;
    const rightPx = right.boy.x - centre.boy.x;
    check(leftPx > 40, `SWIPE LEFT moves the boy ${leftPx.toFixed(0)}px across the screen`);
    check(rightPx > 40, `SWIPE RIGHT moves the boy ${rightPx.toFixed(0)}px across the screen`);
    check(Math.abs(right.boy.x - left.boy.x) > 90, `full lane sweep is ${Math.abs(right.boy.x - left.boy.x).toFixed(0)}px wide`);
    check(Math.abs(turning.boy.lean) > 0.02, `he leans into the turn (${turning.boy.lean.toFixed(3)} rad mid-crossing)`);
    // He is alive on the rail: the stride keeps moving him frame to frame.
    const bob = await page.evaluate(() => {
      const ys = [];
      for (let i = 0; i < 24; i++) ys.push(window.__skz.advance(1 / 30).boy.y);
      return Math.max(...ys) - Math.min(...ys);
    });
    check(bob > 2, `he rides with a visible push-and-glide (${bob.toFixed(1)}px of travel)`);
    // Things actually go past him rather than vanishing at his depth.
    const passing = await page.evaluate(() => {
      let most = 0;
      for (let i = 0; i < 90; i++) most = Math.max(most, window.__skz.advance(1 / 30).passing);
      return most;
    });
    check(passing > 0, `coins and blocks sweep past him (${passing} in front of him at once)`);
  }
  await page.evaluate(() => { window.__skz.screen.reset(); window.__skz.screen.start(); });
  st = await page.evaluate(() => window.__skz.advance(1.8));
  check(st.coins > 286, `collects coins on the gold rail (${st.coins})`);
  check(st.score > 24580 && st.seconds > 82, `score and timer run (${st.score}, ${st.seconds.toFixed(1)}s)`);
  check(st.d > 2, `forward movement along the rail (d=${st.d.toFixed(2)})`);
  await shot(page, 'riding-phone');
  // Pause via the painted pause button (the one button that remains).
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
  // With a safe ride in hand the same hit is absorbed and the run continues.
  await page.evaluate(() => {
    window.__skz.screen.reset();
    window.__skz.screen.start();
    window.__skz.screen.shield = 1;
  });
  let survived = false;
  let hit = false;
  for (let i = 0; i < 90 && !hit; i++) {
    const s2 = await page.evaluate(() => window.__skz.advance(0.25));
    if (s2.state === 'crashed') break;
    if (s2.shield === 0) { hit = true; survived = s2.state === 'riding'; }
  }
  check(hit && survived, 'a safe ride absorbs the hit and he keeps riding');
  const after = await page.evaluate(() => window.__skz.advance(1.2));
  check(after.state === 'riding' && after.d > 0, 'the ride carries on after the hit is absorbed');
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
