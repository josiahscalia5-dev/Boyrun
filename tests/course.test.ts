import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Course, makeFrame } from '../src/course/Course';
import { Profile } from '../src/course/Profile';
import { buildLevel } from '../src/course/Levels';
import { LANE } from '../src/course/LevelBuilder';

describe('Profile', () => {
  it('interpolates smoothly and clamps at ends', () => {
    const p = new Profile([
      { s: 0, v: 0 },
      { s: 10, v: 4 },
    ]);
    expect(p.at(-5)).toBe(0);
    expect(p.at(15)).toBe(4);
    expect(p.at(5)).toBeCloseTo(2, 5);
    expect(Math.abs(p.slope(0.5))).toBeLessThan(0.05);
  });

  it('rejects out-of-order keys', () => {
    const p = new Profile([{ s: 10, v: 0 }]);
    expect(() => p.addKey(5, 1)).toThrow();
  });
});

describe('Course', () => {
  it('produces a continuous centreline with orthonormal frames', () => {
    const c = new Course(600, [{ s: 50, len: 100, angle: 0.4 }], [{ s: 100, len: 100, dy: 10 }]);
    const f = makeFrame();
    const prev = new Vector3();
    for (let s = 0; s < 600; s += 2.5) {
      c.frame(s, f);
      if (s > 0) expect(f.pos.distanceTo(prev)).toBeLessThan(2.6);
      prev.copy(f.pos);
      expect(f.forward.length()).toBeCloseTo(1, 4);
      expect(f.right.length()).toBeCloseTo(1, 4);
      expect(f.up.length()).toBeCloseTo(1, 4);
      expect(Math.abs(f.right.dot(f.up))).toBeLessThan(1e-6);
    }
    expect(c.heightAt(500)).toBeCloseTo(10, 5);
  });

  it('banks into curves (inside rail lower)', () => {
    const c = new Course(400, [{ s: 50, len: 200, angle: 0.6 }], []);
    const f = makeFrame();
    c.frame(150, f); // mid right turn
    expect(f.bank).toBeGreaterThan(0);
    expect(f.right.y).toBeLessThan(0);
  });
});

describe('Level 1 (Gameplay Screen)', () => {
  const lvl = buildLevel(1);
  const net = lvl.network;

  it('has three parallel rails - blue / gold / blue - from start to finish', () => {
    for (let s = 0; s <= lvl.finishS; s += 10) {
      const rails = net.railsAt(s).sort((a, b) => a.lat.at(s) - b.lat.at(s));
      expect(rails.map((r) => r.type)).toEqual(['blue', 'gold', 'blue']);
      expect(rails[0].lat.at(s)).toBeCloseTo(-LANE, 3);
      expect(rails[2].lat.at(s)).toBeCloseTo(LANE, 3);
    }
  });

  it('starts the boy on the gold centre rail', () => {
    expect(net.get(lvl.startRailId).type).toBe('gold');
  });

  it('finds the adjacent rail on each side', () => {
    const centre = net.get(lvl.startRailId);
    const left = net.neighbour({ rail: centre, s: 40, dir: -1, lead: 6 });
    const right = net.neighbour({ rail: centre, s: 40, dir: 1, lead: 6 });
    expect(left?.lat.at(46)).toBeCloseTo(-LANE, 3);
    expect(right?.lat.at(46)).toBeCloseTo(LANE, 3);
    expect(net.neighbour({ rail: left!, s: 40, dir: -1, lead: 6 })).toBeNull();
    expect(net.neighbour({ rail: right!, s: 40, dir: 1, lead: 6 })).toBeNull();
  });

  it('never blocks every rail at once, and gates are far enough apart to react', () => {
    const byS = new Map<number, Set<number>>();
    for (const o of lvl.obstacles) {
      const set = byS.get(o.s) ?? new Set();
      set.add(o.railId);
      byS.set(o.s, set);
    }
    for (const [s, blocked] of byS) {
      const free = net.railsAt(s).filter((r) => !blocked.has(r.id));
      expect(free.length, `no free rail at s=${s}`).toBeGreaterThan(0);
    }
    const distinct = [...byS.keys()].sort((a, b) => a - b);
    for (let i = 1; i < distinct.length; i++) {
      // At >=27 m/s, 30 m gives over a second to react.
      expect(distinct[i] - distinct[i - 1]).toBeGreaterThanOrEqual(30);
    }
  });

  it('places no coin inside a gate', () => {
    for (const c of lvl.collectibles) {
      for (const o of lvl.obstacles) {
        if (c.railId === o.railId) expect(Math.abs(c.s - o.s)).toBeGreaterThan(2);
      }
    }
  });
});
