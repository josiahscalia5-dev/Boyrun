/**
 * Perspective of the supplied GAMEPLAY SCREEN artwork, measured from the
 * painting itself (all values are in the image's own 512x1024 pixels).
 *
 * The coin trail on the gold rail follows y = HORIZON_Y + DEPTH_K / z,
 * where z is the depth (z = 1 at the big coin, y = 540.5, radius 30 px),
 * and every object's on-screen size scales with 1 / z.
 */
export const IMAGE_W = 512;
export const IMAGE_H = 1024;
export const HORIZON_Y = 360;
export const DEPTH_K = 180.5;
/** Rail surface below an object hovering at depth z. */
export const SURFACE_K = 216;
/** Lateral distance between lanes on the gold rail at z = 1 (px). */
export const LANE_PX = 21;
/** Half width of the gold rail at z = 1 (px). */
export const RAIL_HALF_PX = 47;
/** Radius of a coin at z = 1 (px) - the big coin in the artwork. */
export const COIN_R = 30;
/** Width of an obstacle block on the gold rail at z = 1 (px). */
export const BLOCK_W = 96;

/** Depth at which things meet the boy (his chest / hands). */
export const HIT_Z = 0.62;
/** Depth used to draw the boy in the painter's order. */
export const BOY_Z = 0.6;
/** Items fade in from the rail glow between these depths. */
export const FADE_FAR_Z = 3.45;
export const FADE_NEAR_Z = 3.0;
/** Items are removed once they leave the bottom of the screen. */
export const REMOVE_Z = 0.27;
/** Boy's lateral shift per lane (px) - lanes seen at his depth. */
export const BOY_LANE_PX = 30;

/** Centre line of the gold rail (through the coin trail). */
export function centreX(y: number): number {
  return 239.5 + Math.max(0, y - 540) * 0.027;
}

export function coinY(z: number): number {
  return HORIZON_Y + DEPTH_K / z;
}

export function surfaceY(z: number): number {
  return HORIZON_Y + SURFACE_K / z;
}

export function zFromCoinY(y: number): number {
  return DEPTH_K / (y - HORIZON_Y);
}

export function laneX(lane: number, z: number): number {
  return centreX(coinY(z)) + (lane * LANE_PX) / z;
}

export function fadeIn(z: number): number {
  if (z >= FADE_FAR_Z) return 0;
  if (z <= FADE_NEAR_Z) return 1;
  return (FADE_FAR_Z - z) / (FADE_FAR_Z - FADE_NEAR_Z);
}
