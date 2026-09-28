import { describe, expect, it } from 'vitest';
import { coinY, COIN_R, HIT_Z, zFromCoinY } from '../src/screen1/Perspective';
import { ART_COIN_Y, Track } from '../src/screen1/Track';
import layers from '../src/screen1/layers.json';

describe('perspective measured from the artwork', () => {
  it('maps every painted coin to its painted position and size', () => {
    for (const c of layers.coins.slice(0, 2)) {
      const z = zFromCoinY(c.cy);
      expect(coinY(z)).toBeCloseTo(c.cy, 5);
      // Size follows 1/z within a pixel for the near coins.
      expect(Math.abs(COIN_R / z - c.r)).toBeLessThan(1.2);
    }
  });
});

describe('Track', () => {
  it('starts with exactly the coin trail painted on the gold rail', () => {
    const t = new Track();
    const art = t.items.filter((i) => i.artIndex !== undefined);
    expect(art.map((i) => coinY(t.z(i)))).toEqual(ART_COIN_Y.map((y) => expect.closeTo(y, 5)));
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
    for (let i = 0; i < 60 * 120; i++) t.update(1 / 60, 5, true); // ride 2 minutes out of reach
    const t2 = new Track(7);
    const seen = new Map<number, Set<number>>();
    for (let i = 0; i < 60 * 120; i++) {
      t2.update(1 / 60, 5, true);
      for (const it of t2.items) {
        if (it.kind !== 'gate') continue;
        const key = Math.round(it.w * 100);
        const set = seen.get(key) ?? new Set();
        set.add(it.lane);
        seen.set(key, set);
      }
    }
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
});
