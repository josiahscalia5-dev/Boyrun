/**
 * Visual definitions for the rail colours in the Gameplay Screen reference:
 * a gold centre rail flanked by blue rails. (Gameplay meaning per rail type
 * - safe / reward / risk / secret - is introduced with Rail Switching.)
 */
export type RailType = 'blue' | 'gold';

export interface RailTypeDef {
  id: RailType;
  /** Bright core colour of the glowing channel. */
  core: number;
  /** Saturated edge colour. */
  edge: number;
  /** Soft halo colour bleeding onto the surroundings. */
  halo: number;
  /** Width multiplier of the rail cross-section. */
  width: number;
}

export const RAIL_TYPES: Record<RailType, RailTypeDef> = {
  blue: {
    id: 'blue',
    core: 0x8fe4ff,
    edge: 0x1273ff,
    halo: 0x3aa6ff,
    width: 1,
  },
  gold: {
    id: 'gold',
    core: 0xfff6cf,
    edge: 0xffa000,
    halo: 0xffc233,
    width: 1.3,
  },
};
