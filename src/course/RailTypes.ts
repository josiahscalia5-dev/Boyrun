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
}

export const RAIL_TYPES: Record<RailType, RailTypeDef> = {
  blue: {
    id: 'blue',
    core: 0xd8fbff,
    edge: 0x1d8dff,
    halo: 0x46b4ff,
  },
  gold: {
    id: 'gold',
    core: 0xfff8d8,
    edge: 0xffa800,
    halo: 0xffc93a,
  },
};
