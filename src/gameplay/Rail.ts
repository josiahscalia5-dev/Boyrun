import layout from './layout.json';

/**
 * The world model of the GAMEPLAY SCREEN, measured on the supplied artwork
 * (docs/reference/1-gameplay-screen-hd.png). Every value is in the artwork's
 * own 1024x1536 pixels; nothing here is invented.
 *
 * Depth (z) is read off the painted coin trail. The coins on the gold rail are
 * the same coin drawn smaller with distance, so z = r0 / r for a coin painted
 * with radius r, and z = 1 at the nearest painted coin. The depth -> screen
 * curve runs exactly through all five painted coins, which is what lets the
 * opening frame be the artwork itself.
 *
 * Lanes are read off the painted gold rail. Its measured left and right edges
 * give the rail's centre line and half width at every y, and a lane sits at a
 * fixed fraction of that half width from the centre - so the three lanes
 * spread apart exactly as the rail does.
 */

export const ART_W = layout.size[0];
export const ART_H = layout.size[1];

/** Piecewise-linear table with linear extrapolation past both ends. */
function table(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length;
  return (x: number): number => {
    if (x <= xs[0]) return ys[0] + ((x - xs[0]) * (ys[1] - ys[0])) / (xs[1] - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + ((x - xs[n - 1]) * (ys[n - 1] - ys[n - 2])) / (xs[n - 1] - xs[n - 2]);
    let i = 1;
    while (i < n - 1 && xs[i] < x) i++;
    return ys[i - 1] + ((x - xs[i - 1]) * (ys[i] - ys[i - 1])) / (xs[i] - xs[i - 1]);
  };
}

// ------------------------------------------------------------- the gold rail

/** Measured rail edges: [y, x] samples down the painting. */
const edgeX = (pts: number[][]) => table(pts.map((p) => p[0]), pts.map((p) => p[1]));
const leftEdge = edgeX(layout.rail.left);
const rightEdge = edgeX(layout.rail.right);

/** Centre line of the gold rail at screen row y. */
export function centreX(y: number): number {
  return (leftEdge(y) + rightEdge(y)) / 2;
}

/** Half width of the gold rail at screen row y (it converges towards the top). */
export function halfWidth(y: number): number {
  return Math.max(1.5, (rightEdge(y) - leftEdge(y)) / 2);
}

// ------------------------------------------------------------------- depth

/** The coins painted on the gold rail, near to far. */
const ART_COINS = layout.coins;
const R0 = ART_COINS[0].r;

/** Depth of each painted coin - the run starts with exactly these. */
export const ART_Z: number[] = ART_COINS.map((c) => R0 / c.r);

// The depth curve, tabulated on the painted coins (1/z ascending, i.e. far to near).
const far2near = [...ART_COINS].reverse();
const depthY = table(far2near.map((c) => c.r / R0), far2near.map((c) => c.cy));
const depthZ = table(far2near.map((c) => c.cy), far2near.map((c) => c.r / R0));

/** Screen y of the coin trail at depth z - exact at every painted coin. */
export function railY(z: number): number {
  return depthY(1 / z);
}

/** The depth whose coin trail sits at screen row y. */
export function zFromY(y: number): number {
  return 1 / depthZ(y);
}

/** How much smaller than painted an object at depth z is drawn. */
export function scaleAt(z: number): number {
  return 1 / z;
}

// --------------------------------------------------------------- the ride

/** A lane sits this far from the rail's centre, as a fraction of its half width. */
export const LANE_SPAN = 0.62;

/** Screen x of a lane at depth z (lane is continuous: -1, 0, +1 and between). */
export function laneX(lane: number, z: number): number {
  const y = railY(z);
  return centreX(y) + lane * LANE_SPAN * halfWidth(y);
}

/** Coins float above the rail; this is the rail surface under them at z = 1. */
export const SURFACE_DROP = 70;

/** The rail surface below an item hovering at depth z (blocks stand on it). */
export function surfaceY(z: number): number {
  return railY(z) + SURFACE_DROP / z;
}

/** Depth at which an item meets the boy - chest height on the coin trail. */
export const HIT_Z = 0.7;
/** Items fade in out of the distance between these depths. */
export const FADE_FAR_Z = 7.0;
export const FADE_NEAR_Z = 5.6;
/** Items are dropped once they are past the bottom of the artwork. */
export const REMOVE_Z = 0.26;
/** Width of a gameplay block on the gold rail at z = 1 (it covers one lane). */
export const BLOCK_W = 86;

/** The boy's lateral travel per lane: the lane spacing where items meet him. */
export const BOY_LANE_PX = LANE_SPAN * halfWidth(railY(HIT_Z));

export function fadeIn(z: number): number {
  if (z >= FADE_FAR_Z) return 0;
  if (z <= FADE_NEAR_Z) return 1;
  return (FADE_FAR_Z - z) / (FADE_FAR_Z - FADE_NEAR_Z);
}
