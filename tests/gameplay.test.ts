import { describe, expect, it } from 'vitest';
import layout from '../src/gameplay/layout.json';
import {
  ART_Z,
  BOY_LANE_PX,
  centreX,
  fadeIn,
  FADE_NEAR_Z,
  halfWidth,
  HIT_Z,
  laneX,
  PASS_FAR_Z,
  PASS_NEAR_Z,
  railY,
  REMOVE_Z,
  scaleAt,
  surfaceY,
  zFromY,
} from '../src/gameplay/Rail';
import { Track } from '../src/gameplay/Track';

const COINS = layout.coins;
const [ART_W, ART_H] = layout.size;

describe('the rail model, measured on the artwork', () => {
  it('puts every painted coin back exactly where it is painted', () => {
    COINS.forEach((c, i) => {
      expect(railY(ART_Z[i])).toBeCloseTo(c.cy, 6);
      // Size follows 1/z, so the painted radius comes back exactly too.
      expect(COINS[0].r * scaleAt(ART_Z[i])).toBeCloseTo(c.r, 6);
    });
  });

  it('inverts depth and screen row', () => {
    for (const z of [0.3, 0.7, 1, 2.5, 5, 7]) expect(zFromY(railY(z))).toBeCloseTo(z, 6);
  });

  it('runs the coin trail down the painted gold rail', () => {
    // Each painted coin sits on the rail, within a few px of its centre line.
    COINS.forEach((c) => {
      expect(Math.abs(c.cx - centreX(c.cy))).toBeLessThan(17);
      expect(c.cx).toBeGreaterThan(centreX(c.cy) - halfWidth(c.cy));
      expect(c.cx).toBeLessThan(centreX(c.cy) + halfWidth(c.cy));
    });
  });

  it('spreads the three lanes across the rail, widening towards the viewer', () => {
    let previous = 0;
    for (const z of [5, 2.5, 1.4, 1, HIT_Z]) {
      const spread = laneX(1, z) - laneX(-1, z);
      expect(spread).toBeGreaterThan(previous); // nearer = further apart
      previous = spread;
      // Both outer lanes stay on the painted rail.
      const y = railY(z);
      expect(laneX(-1, z)).toBeGreaterThan(centreX(y) - halfWidth(y));
      expect(laneX(1, z)).toBeLessThan(centreX(y) + halfWidth(y));
    }
  });

  it('meets the boy where he actually rides, down on the rail', () => {
    // Items reach him between his knees and his feet - the rail he is on,
    // not high above it - and stand on the rail surface under them.
    expect(railY(HIT_Z)).toBeGreaterThan(layout.boy.joints.kneeR[1]);
    expect(railY(HIT_Z)).toBeLessThan(layout.boy.feet[1]);
    expect(surfaceY(HIT_Z)).toBeGreaterThan(railY(HIT_Z));
    // Everything is still on screen when it fades in...
    expect(railY(FADE_NEAR_Z)).toBeGreaterThan(0);
    expect(railY(FADE_NEAR_Z)).toBeLessThan(ART_H);
    // ...and only leaves once it is well past the bottom edge.
    expect(railY(REMOVE_Z)).toBeGreaterThan(ART_H);
  });

  it('carries items on past the viewer instead of dropping them at the boy', () => {
    // An item level with the boy is still solid, so it visibly sweeps by.
    expect(fadeIn(HIT_Z)).toBe(1);
    expect(REMOVE_Z).toBeLessThan(HIT_Z);
    expect(railY(REMOVE_Z)).toBeGreaterThan(railY(HIT_Z));
    // It only thins out once it is leaving the frame.
    expect(fadeIn(PASS_NEAR_Z)).toBe(1);
    expect(fadeIn(PASS_FAR_Z)).toBe(0);
    expect(fadeIn((PASS_NEAR_Z + PASS_FAR_Z) / 2)).toBeCloseTo(0.5, 2);
  });

  it('moves the boy right across the rail on a lane change', () => {
    expect(BOY_LANE_PX).toBeCloseTo(laneX(1, HIT_Z) - laneX(0, HIT_Z), 6);
    // A lane change has to be plainly visible: well over a tenth of the
    // screen's width, and a good fraction of the boy's own body.
    expect(BOY_LANE_PX / ART_W).toBeGreaterThan(0.1);
    expect(BOY_LANE_PX).toBeGreaterThan(layout.boy.w * 0.25);
    // ...but he still stays on screen at full lock.
    expect(layout.boy.feet[0] + BOY_LANE_PX).toBeLessThan(ART_W);
    expect(layout.boy.feet[0] - BOY_LANE_PX).toBeGreaterThan(0);
  });
});

describe('Track', () => {
  it('starts with exactly the coin trail painted on the gold rail', () => {
    const t = new Track();
    const art = t.items.filter((i) => i.artIndex !== undefined);
    expect(art.map((i) => railY(t.z(i)))).toEqual(COINS.map((c) => expect.closeTo(c.cy, 6)));
    expect(art.every((i) => i.lane === 0 && i.kind === 'coin')).toBe(true);
  });

  it('collects the painted coins when riding the centre lane', () => {
    const t = new Track();
    let coins = 0;
    for (let i = 0; i < 120; i++) coins += t.update(1 / 60, 0, true).filter((e) => e.type === 'coin').length;
    expect(coins).toBeGreaterThanOrEqual(2);
  });

  it('misses coins in another lane', () => {
    const t = new Track();
    let coins = 0;
    for (let i = 0; i < 60; i++) coins += t.update(1 / 60, 1, true).filter((e) => e.type === 'coin').length;
    expect(coins).toBe(0);
  });

  it('never blocks all three lanes and gives time to react to every gate', () => {
    const t = new Track(7);
    const seen = new Map<number, Set<number>>();
    for (let i = 0; i < 60 * 120; i++) {
      t.update(1 / 60, 5, true); // ride 2 minutes out of reach
      for (const it of t.items) {
        if (it.kind !== 'gate') continue;
        const key = Math.round(it.w * 100);
        const set = seen.get(key) ?? new Set();
        set.add(it.lane);
        seen.set(key, set);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    for (const lanes of seen.values()) expect(lanes.size).toBeLessThan(3);
    const rows = [...seen.keys()].sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(100); // >= 1.0 depth apart
  });

  it('crashes on a gate in the boy lane and halts', () => {
    const t = new Track(3);
    t.items = [{ id: 1, kind: 'gate', lane: 0, w: HIT_Z + 0.2, state: 'live' }];
    let crash = false;
    for (let i = 0; i < 60 && !crash; i++) crash = t.update(1 / 60, 0, true).some((e) => e.type === 'crash');
    expect(crash).toBe(true);
    t.halt();
    expect(t.speed).toBe(0);
  });

  it('keeps the rail stocked ahead of the boy without piling items up', () => {
    const t = new Track(5);
    for (let i = 0; i < 60 * 60; i++) t.update(1 / 60, 0, true);
    expect(t.items.length).toBeGreaterThan(5);
    expect(t.items.length).toBeLessThan(80);
    expect(t.items.every((it) => t.z(it) > REMOVE_Z)).toBe(true);
  });
});

describe('boost chain and safe ride', () => {
  const chevrons = (t: Track, n: number) => {
    const fired: boolean[] = [];
    for (let i = 0; i < n; i++) {
      t.items = [{ id: 100 + i, kind: 'boost', lane: 0, w: t.d + HIT_Z + 0.05, state: 'live' }];
      for (let k = 0; k < 40; k++) {
        const ev = t.update(1 / 60, 0, true).find((e) => e.type === 'boost');
        if (ev) {
          fired.push(ev.superBoost === true);
          break;
        }
      }
    }
    return fired;
  };

  it('fires the super boost on every third chevron in a row', () => {
    const t = new Track(9);
    const fired = chevrons(t, 6);
    expect(fired.length).toBe(6);
    expect(fired).toEqual([false, false, true, false, false, true]);
  });

  it('runs faster on a boost, and faster still on the super boost', () => {
    const plain = new Track(9);
    plain.update(1 / 60, 5, true);
    const base = plain.velocity;
    const t = new Track(9);
    chevrons(t, 2);
    const boosted = t.velocity;
    chevrons(t, 1);
    expect(boosted).toBeGreaterThan(base);
    expect(t.superCharged).toBe(true);
    expect(t.velocity).toBeGreaterThan(boosted);
  });

  it('lets the chain lapse if the chevrons are too far apart', () => {
    const t = new Track(9);
    chevrons(t, 2);
    expect(t.boostChain).toBe(2);
    for (let i = 0; i < 60 * 15; i++) t.update(1 / 60, 5, true); // ride on well past the window
    expect(chevrons(t, 1)).toEqual([false]); // the chain had lapsed, so no super
  });

  it('knocks the pace out of him on a stagger without stopping the ride', () => {
    const t = new Track(9);
    for (let i = 0; i < 120; i++) t.update(1 / 60, 5, true);
    const before = t.speed;
    t.stagger();
    expect(t.speed).toBeLessThan(before);
    expect(t.speed).toBeGreaterThan(0);
    expect(t.superCharged).toBe(false);
    expect(t.boostChain).toBe(0);
  });
});
