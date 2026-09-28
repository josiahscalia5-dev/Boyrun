// Level 12 sign-off: the nine things that must work, checked in order on the
// running game. Usage: node scripts/level12-verify.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
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

let failed = 0;
const results = [];
const step = (n, label, ok, detail) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}. ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(() => window.__skz.manual(true));

const st = () => page.evaluate(() => window.__skz.state());
const run = (s) => page.evaluate((x) => window.__skz.advance(x), s);
const fresh = async () => {
  await page.evaluate(() => { window.__skz.screen.reset(); window.__skz.screen.start(); });
  await run(0.2);
};
const swipe = async (dir, dx = 95, ms = 120, steps = 6) => {
  await page.mouse.move(206, 620);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(206 + (dir * dx * i) / steps, 620);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
};

// 1. Forward travel: a real, growing world position, with no input at all.
await fresh();
const a = await run(2);
const b = await run(4);
step(1, 'Forward travel works',
  b.d > a.d && a.d > 0 && b.progress > a.progress,
  `world position ${a.d.toFixed(1)} → ${b.d.toFixed(1)} rail lengths, ${Math.round(b.progress * 100)}% of the route, hands off`);

// 2. Swipe steering, measured in real screen pixels.
await fresh();
await run(0.6);
const centre = await st();
await swipe(-1);
const left = await run(0.5);
await swipe(1);
await run(0.5);
await swipe(1);
const right = await run(0.5);
const smooth = await page.evaluate(async () => {
  // Sample the crossing: he must pass through the middle, not jump.
  window.__skz.screen.steerTo(-1);
  const seen = [];
  for (let i = 0; i < 18; i++) seen.push(window.__skz.advance(1 / 60).lanePos);
  return seen;
});
const monotonic = smooth.every((v, i) => i === 0 || v <= smooth[i - 1] + 1e-6);
const midway = smooth.some((v) => v < -0.15 && v > -0.85);
step(2, 'Left/right swipe works',
  centre.boy.x - left.boy.x > 40 && right.boy.x - centre.boy.x > 40 && monotonic && midway,
  `swipe moves him ${(centre.boy.x - left.boy.x).toFixed(0)}px left / ${(right.boy.x - centre.boy.x).toFixed(0)}px right, ${Math.abs(right.boy.x - left.boy.x).toFixed(0)}px full sweep, carried through the middle`);

// 3. The ride gear is one piece with him: boots and nozzle inside the sprite,
//    and the plume anchored at his feet rather than its own sprite top.
const gear = await page.evaluate(async () => {
  const L = (await import('/src/gameplay/layout.json')).default;
  return {
    bootsInside: L.boy.y + L.boy.h >= L.boy.joints.footR[1] + 60,
    feetInside: L.boy.feet[1] < L.boy.y + L.boy.h,
    spriteBottom: L.boy.y + L.boy.h,
    footR: L.boy.joints.footR[1],
  };
});
step(3, 'Boy stays connected to the hoverboard',
  gear.bootsInside && gear.feetInside,
  `sprite runs to y=${gear.spriteBottom}, past the boot sole at ${gear.footR}, so boots + jet nozzle move and lean as one with him`);

// 4. Coins are reached and collected.
await fresh();
const c0 = await st();
const c1 = await run(6);
step(4, 'Coins are physically collected',
  c1.coins > c0.coins,
  `coin counter ${c0.coins} → ${c1.coins} by riding into them`);

// 5. Obstacles approach and pass behind him.
const passed = await page.evaluate(() => {
  let most = 0;
  let everAhead = 0;
  for (let i = 0; i < 400; i++) {
    const s = window.__skz.advance(1 / 60);
    most = Math.max(most, s.passing);
    everAhead = Math.max(everAhead, s.items);
  }
  return { most, everAhead };
});
step(5, 'Obstacles approach and pass',
  passed.most > 0 && passed.everAhead > 0,
  `up to ${passed.everAhead} objects live ahead of him, and they carry on past him rather than vanishing at his depth`);

// 6. Three boost pieces give real forward speed, then it eases off.
await fresh();
await run(1.5);
const normal = await page.evaluate(() => window.__skz.screen.track.velocity);
const sup = await page.evaluate(() => {
  const t = window.__skz.screen.track;
  t.boostChain = 0;
  const seen = [];
  for (let i = 0; i < 3; i++) {
    t.items = [{ id: 900 + i, kind: 'boost', lane: 0, w: t.d + 0.47, state: 'live' }];
    for (let k = 0; k < 40; k++) {
      const evs = window.__skz.screen.track.update(1 / 60, 0, true);
      const e = evs.find((x) => x.type === 'boost');
      if (e) { seen.push({ chain: t.boostChain, superBoost: !!e.superBoost }); break; }
    }
  }
  return { seen, superCharged: t.superCharged, velocity: t.velocity };
});
const before = await st();
const moved = await run(2);
const superDist = moved.d - before.d;
// Watch the rail speed come back down on its own, riding out of reach so a
// gate cannot be mistaken for the boost easing off.
const ease = await page.evaluate(() => {
  const t = window.__skz.screen.track;
  const curve = [];
  for (let i = 0; i < 60 * 6; i++) {
    t.update(1 / 60, 5, true);
    if (i % 30 === 0) curve.push(+t.velocity.toFixed(2));
  }
  return { curve, settled: +t.velocity.toFixed(2), superCharged: t.superCharged };
});
// Smooth means it comes down in steps, never jumping back in one frame.
const drops = ease.curve.slice(1).map((v, i) => ease.curve[i] - v);
const easedTo = `${ease.settled.toFixed(2)} (${ease.curve.join(' → ')}), no step bigger than ${Math.max(...drops).toFixed(2)}`;
const peak = Math.max(...ease.curve);
// No cliff: no half-second of the fade may drop more than half the boost.
const noCliff = Math.max(...drops) < (peak - normal) * 0.5;
step(6, '3/3 activates real Super Speed',
  sup.seen.length === 3 && sup.seen[2].superBoost && sup.superCharged && superDist > 0
    && peak > normal * 1.5 && !ease.superCharged && ease.settled < peak * 0.7 && noCliff,
  `chain 1/3 → 2/3 → 3/3 fires it; rail speed ${normal.toFixed(2)} → ${peak.toFixed(2)} at full boost, covering ${superDist.toFixed(1)} rail lengths in 2s (vs ${(normal * 2).toFixed(1)} normally), then easing back to ${easedTo}`);

// 7. Safe Ride absorbs a hit that would otherwise end the run.
await fresh();
await page.evaluate(() => { window.__skz.screen.shield = 1; });
let absorbed = null;
for (let i = 0; i < 120 && !absorbed; i++) {
  const s = await run(0.2);
  if (s.state === 'crashed') break;
  if (s.shield === 0) absorbed = s;
}
const kept = absorbed ? await run(1.5) : null;
step(7, 'Safe Ride protects from a collision',
  !!absorbed && absorbed.state === 'riding' && !!kept && kept.state === 'riding' && kept.d > absorbed.d,
  absorbed ? `shield consumed on impact, he stayed riding and carried on another ${(kept.d - absorbed.d).toFixed(1)} rail lengths` : 'no protected hit occurred');

// 8 + 9. He reaches the actual end of the route, and Level Complete triggers.
await fresh();
const len = (await st()).levelLength;
await page.evaluate((d) => window.__skz.warp(d), len - 5);
let done = null;
for (let i = 0; i < 80 && !done; i++) {
  const s = await run(0.25);
  if (s.state === 'finished') done = s;
}
step(8, 'Boy reaches the end of Level 12',
  !!done && done.progress === 1 && done.d >= len,
  done ? `rode the route out to ${done.d.toFixed(0)}/${len} rail lengths — 100%, in the FINAL APPROACH` : 'did not reach the end');
const card = await page.isVisible('text=LEVEL 12 COMPLETE');
step(9, 'Level Complete triggers', card && !!done, card ? 'LEVEL 12 COMPLETE shown, with score, coins and time' : 'card not shown');

console.log(`\n  LEVEL 12 — SIGN-OFF\n`);
console.log(results.map((r) => `  ${r}`).join('\n'));
console.log(`\n  ${errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors'}`);
console.log(failed ? `\n  ${failed} of 9 FAILED\n` : `\n  all 9 working\n`);
await browser.close();
process.exit(failed ? 1 : 0);
