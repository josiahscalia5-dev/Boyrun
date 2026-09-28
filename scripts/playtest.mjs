// End-to-end playtest of the Gameplay Screen in a real browser (WebGL via
// SwiftShader). Drives the actual UI: title tap, HUD buttons, pause,
// crash + retry, and a full autopilot run to the finish line.
// Usage: node scripts/playtest.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = 'playtest-output';
fs.mkdirSync(out, { recursive: true });
const exe = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skz, null, { timeout: 60000 });
const skz = (fn, arg) => page.evaluate(fn, arg);
await skz(() => window.__skz.manual(true));
await skz(() => window.__skz.advance(0.3));

// 1. Title screen -> tap to ride.
let st = await skz(() => window.__skz.state());
check(st.state === 'title', 'boots to the title screen');
check(await page.isVisible('text=TAP TO RIDE'), 'title shows TAP TO RIDE');
await page.click('.title-screen');
st = await skz(() => window.__skz.advance(0.1));
check(st.state === 'countdown', 'tapping the title starts the countdown');
check(await page.isVisible('#hud'), 'HUD visible during play');
st = await skz(() => window.__skz.advance(2.4));
check(st.state === 'playing' && st.player === 'riding', 'countdown ends with the boy riding');

// 2. Rail movement: accelerates along the rail through curves/hills.
st = await skz(() => window.__skz.advance(2.0));
check(st.speed > 20 && st.s > 25, `accelerates along the rail (s=${st.s.toFixed(1)}, v=${st.speed.toFixed(1)})`);
check(Math.abs(st.lat) < 0.01 && st.rail === 'gold', 'starts on the gold centre rail');

// 3. Left/right HUD buttons move between the parallel rails (smoothly, not a teleport).
await page.dispatchEvent('#btn-left', 'pointerdown');
st = await skz(() => window.__skz.advance(0.1));
check(st.lat < -0.2 && st.lat > -3.3, `left button starts a smooth slide (lat=${st.lat.toFixed(2)} mid-move)`);
st = await skz(() => window.__skz.advance(0.4));
check(Math.abs(st.lat + 3.4) < 0.05 && st.rail === 'blue', 'arrives on the left blue rail');
await page.dispatchEvent('#btn-left', 'pointerdown');
st = await skz(() => window.__skz.advance(0.5));
check(Math.abs(st.lat + 3.4) < 0.05, 'cannot move further left than the last rail');
await page.dispatchEvent('#btn-right', 'pointerdown');
st = await skz(() => window.__skz.advance(0.5));
check(Math.abs(st.lat) < 0.05 && st.rail === 'gold', 'right button returns to the gold rail');

// 4. Coins are collected along the gold rail.
check(st.coins > 3, `collects coins (${st.coins})`);

// 5. Pause / resume via the pause button.
await page.dispatchEvent('#btn-pause', 'pointerdown');
st = await skz(() => window.__skz.advance(0.2));
check(st.state === 'paused', 'pause button pauses');
const sPaused = st.s;
st = await skz(() => window.__skz.advance(1.0));
check(st.s === sPaused, 'world is frozen while paused');
await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/e2e-paused.png`, animations: 'disabled' });
await page.click('text=RESUME');
st = await skz(() => window.__skz.advance(1.4));
check(st.state === 'playing' && st.s > sPaused, 'resume continues the ride');

// 6. Obstacle interaction: riding straight into the red gate on the gold rail crashes.
st = await skz(() => window.__skz.advance(8));
check(st.state === 'crashed' || st.player === 'crashed', `hitting a red X gate crashes (s=${st.s.toFixed(1)})`);
st = await skz(() => window.__skz.advance(1.5));
await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/e2e-crash.png`, animations: 'disabled' });
check(await page.isVisible('text=TRY AGAIN'), 'crash screen offers TRY AGAIN');
await page.click('text=TRY AGAIN');
st = await skz(() => window.__skz.advance(0.1));
check(st.state === 'countdown' && st.s < 1 && st.score === 0, 'retry restarts the level from the beginning');

// 7. Full run with autopilot to the finish.
await skz(() => window.__skz.autopilot(true));
let t = 0;
const shots = [7.3, 20, 40];
while (t < 140) {
  st = await skz(() => window.__skz.advance(0.5));
  t += 0.5;
  if (shots.length && t >= shots[0]) {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/e2e-run-${shots.shift()}.png`, animations: 'disabled' });
  }
  if (st.state === 'complete' || st.state === 'crashed') break;
}
check(st.state === 'complete', `autopilot reaches the finish (state=${st.state}, s=${st.s.toFixed(0)}/${st.finishS})`);
check(st.coins > st.totalCoins * 0.4, `collected a good share of coins (${st.coins}/${st.totalCoins})`);
st = await skz(() => window.__skz.advance(2.2));
await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/e2e-complete.png`, animations: 'disabled' });
check(await page.isVisible('text=LEVEL COMPLETE!'), 'level complete screen shown');
check(await page.isVisible('text=RIDE AGAIN'), 'offers RIDE AGAIN');
check(st.scenery.props < 500 && st.railChunks < 80, `streaming keeps object counts bounded (props=${st.scenery.props}, chunks=${st.railChunks})`);

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
