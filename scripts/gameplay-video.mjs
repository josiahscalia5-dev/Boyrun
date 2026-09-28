// Records the Gameplay Screen actually being played, in real time, at phone
// size - so the movement can be watched rather than described.
// Usage: node scripts/gameplay-video.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = 'playtest-output/video';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

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

const SIZE = { width: 412, height: 915 };
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  hasTouch: true,
  recordVideo: { dir: out, size: SIZE },
});
const page = await context.newPage();
await page.goto(base);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });

const wait = (ms) => page.waitForTimeout(ms);
const tap = (which) => page.dispatchEvent(`.hitbox-${which}`, 'pointerdown');
const state = () => page.evaluate(() => window.__skz.state());

// Real time from here on: no stepping, the game runs itself.
const log = [];
const note = async (label) => {
  const s = await state();
  log.push(`${label.padEnd(26)} boyX=${s.boy.x.toFixed(0)}px  lane=${s.lane}  d=${s.d.toFixed(2)}  coins=${s.coins}  passing=${s.passing}`);
};

/** The lane the player should be in: away from gates, towards coins. */
const wantedLane = () =>
  page.evaluate(() => {
    const t = window.__skz.screen.track;
    const ahead = t.items.map((i) => ({ kind: i.kind, lane: i.lane, z: i.w - t.d })).filter((i) => i.z > 0.4);
    const blocked = new Set(ahead.filter((i) => i.kind === 'gate' && i.z < 2.6).map((i) => i.lane));
    const free = [-1, 0, 1].filter((l) => !blocked.has(l));
    if (!free.length) return null;
    // Of the safe lanes, head for the one with the nearest coin.
    const coin = ahead
      .filter((i) => i.kind !== 'gate' && free.includes(i.lane) && i.z < 3.2)
      .sort((a, b) => a.z - b.z)[0];
    return coin ? coin.lane : free.includes(0) ? 0 : free[0];
  });

await wait(1200); // the opening frame: the painting, at rest
await note('opening frame');
await page.dispatchEvent('#app', 'pointerdown'); // start riding
await wait(1800);
await note('riding, centre lane');

// Play it properly for 24s: steer away from the red gates, towards the coins.
const started = Date.now();
let last = 0;
while (Date.now() - started < 24000) {
  const s = await state();
  if (s.state === 'crashed') break;
  const want = await wantedLane();
  if (want !== null && want !== s.lane) {
    await tap(want < s.lane ? 'left' : 'right');
  }
  await wait(260);
  if (Date.now() - started - last > 4000) {
    last = Date.now() - started;
    await note(`t=${(last / 1000).toFixed(0)}s`);
  }
}
await note('end of run');

const s = await state();
await context.close(); // flushes the video file
await browser.close();

const file = fs.readdirSync(out).find((f) => f.endsWith('.webm'));
fs.renameSync(`${out}/${file}`, `${out}/gameplay.webm`);
console.log(log.join('\n'));
console.log(`\nrode ${s.d.toFixed(1)} rail lengths, ${s.coins - 286} coins collected, score ${s.score}`);
console.log(`video: ${out}/gameplay.webm`);
