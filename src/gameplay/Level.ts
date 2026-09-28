/**
 * LEVEL 12 - the route the boy actually rides.
 *
 * The level is a list of sections laid end to end along the rail, measured in
 * the same world units as everything else (one unit is one "rail length", the
 * depth a coin travels to reach the boy from where it is painted). The boy's
 * own world position runs from 0 to LEVEL_LENGTH; the section he is in decides
 * what the rail throws at him and how hard the route weaves, and reaching the
 * end of the last section finishes the level.
 *
 * Nothing here is visual: the artwork is untouched. This is the shape of the
 * ride underneath it.
 */

export interface Section {
  /** Shown briefly as he enters it. */
  name: string;
  /** How far it runs, in rail lengths. */
  length: number;
  /** How far the route weaves off the centre line, in lanes. */
  curve: number;
  /** Relative chance of each pattern while he is in this section. */
  mix: { coins: number; gate: number; gauntlet: number; chevrons: number; zigzag: number };
  /** Rail lengths of clear track between patterns. */
  gap: [number, number];
}

export const SECTIONS: readonly Section[] = [
  {
    name: 'SETTING OFF',
    length: 16,
    curve: 0,
    mix: { coins: 6, gate: 1, gauntlet: 0, chevrons: 1, zigzag: 0 },
    gap: [1.4, 1.9],
  },
  {
    name: 'LANE CHANGE',
    length: 20,
    curve: 0.1,
    mix: { coins: 2, gate: 6, gauntlet: 1, chevrons: 1, zigzag: 2 },
    gap: [1.0, 1.5],
  },
  {
    name: 'THE LONG BEND',
    length: 22,
    curve: 0.34,
    mix: { coins: 3, gate: 4, gauntlet: 1, chevrons: 2, zigzag: 2 },
    gap: [1.0, 1.5],
  },
  {
    name: 'GOLD RUN',
    length: 22,
    curve: 0.18,
    mix: { coins: 6, gate: 4, gauntlet: 2, chevrons: 1, zigzag: 3 },
    gap: [0.8, 1.2],
  },
  {
    name: 'JET SECTION',
    length: 20,
    curve: 0.12,
    mix: { coins: 2, gate: 3, gauntlet: 0, chevrons: 6, zigzag: 1 },
    gap: [1.0, 1.4],
  },
  {
    name: 'THE GAUNTLET',
    length: 24,
    curve: 0.28,
    mix: { coins: 1, gate: 5, gauntlet: 5, chevrons: 2, zigzag: 2 },
    gap: [0.8, 1.2],
  },
  {
    name: 'FINAL APPROACH',
    length: 20,
    curve: 0.08,
    mix: { coins: 5, gate: 3, gauntlet: 0, chevrons: 3, zigzag: 1 },
    gap: [1.1, 1.6],
  },
];

/** Where each section starts, and where the route ends. */
export const SECTION_START: readonly number[] = SECTIONS.reduce<number[]>(
  (acc, s, i) => [...acc, acc[i] + s.length],
  [0],
).slice(0, SECTIONS.length);

export const LEVEL_LENGTH = SECTIONS.reduce((n, s) => n + s.length, 0);

/** The last stretch is a clear run in to the finish. */
export const RUN_IN = 6;

/** Which section a world position falls in. */
export function sectionAt(w: number): number {
  for (let i = SECTIONS.length - 1; i >= 0; i--) if (w >= SECTION_START[i]) return i;
  return 0;
}

/** How far through the whole route a world position is, 0..1. */
export function progressAt(w: number): number {
  return Math.max(0, Math.min(1, w / LEVEL_LENGTH));
}

/**
 * How far the route has weaved off the rail's centre line at world position w,
 * in lanes. Sections blend into each other so the bend is continuous - the
 * route never kinks at a section boundary.
 */
export function curveAt(w: number): number {
  const i = sectionAt(w);
  const s = SECTIONS[i];
  // Ease the amplitude across the join with the next section.
  const into = w - SECTION_START[i];
  const blend = 4;
  let amp = s.curve;
  if (into < blend && i > 0) {
    const t = into / blend;
    amp = SECTIONS[i - 1].curve + (s.curve - SECTIONS[i - 1].curve) * (t * t * (3 - 2 * t));
  }
  // One continuous wave down the whole route, so it cannot kink.
  return amp * Math.sin(w * 0.21);
}
