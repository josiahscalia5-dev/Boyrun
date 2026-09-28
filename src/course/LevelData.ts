import type { Course } from './Course';
import type { RailNetwork } from './RailNetwork';

/** Phase 1 obstacles: the red X blocking gate from the Gameplay Screen reference. */
export type ObstacleKind = 'gate';

export interface ObstacleSpawn {
  kind: ObstacleKind;
  s: number;
  /** Rail the obstacle is mounted on. */
  railId: number;
  lat: number;
  h: number;
}

export type CollectibleKind = 'coin';

export interface CollectibleSpawn {
  kind: CollectibleKind;
  s: number;
  lat: number;
  h: number;
  railId?: number;
}

/** Blue chevron block (reference): ride through it for a speed boost. */
export interface BoostSpawn {
  s: number;
  railId: number;
  lat: number;
  h: number;
}

export interface ZoneSpawn {
  s0: number;
  s1: number;
  label: string;
}

export interface TutorialSpawn {
  s: number;
  text: string;
}

export interface LevelData {
  index: number;
  name: string;
  seed: number;
  course: Course;
  network: RailNetwork;
  baseSpeed: number;
  finishS: number;
  startRailId: number;
  obstacles: ObstacleSpawn[];
  collectibles: CollectibleSpawn[];
  boosts: BoostSpawn[];
  zones: ZoneSpawn[];
  tutorials: TutorialSpawn[];
}
