import { Course, HillSpec, TurnSpec } from './Course';
import type {
  BoostSpawn,
  CollectibleKind,
  CollectibleSpawn,
  LevelData,
  ObstacleKind,
  ObstacleSpawn,
  TutorialSpawn,
  ZoneSpawn,
} from './LevelData';
import { Profile } from './Profile';
import { RailDef, RailNetwork } from './RailNetwork';
import type { RailType } from './RailTypes';

/** Lateral spacing between parallel rails (metres). */
export const LANE = 3.4;
/** Side rails sit slightly lower than the centre rail, like the reference. */
export const SIDE_H = -0.35;
/** Height of rail-mounted collectibles above the rail surface. */
export const COIN_H = 0.95;

export type LaneKey = 'L' | 'C' | 'R';

/**
 * Authoring API for levels. Lanes are opened, moved and closed at course
 * distances; spawns are placed relative to lanes so they always sit exactly
 * on the rails regardless of curves or elevation.
 */
export class LevelBuilder {
  readonly course: Course;
  readonly network: RailNetwork;
  private readonly lanes = new Map<LaneKey, RailDef>();
  /** Every rail ever opened under a lane key (for spawns after close). */
  private readonly history = new Map<LaneKey, RailDef[]>();

  readonly obstacles: ObstacleSpawn[] = [];
  readonly collectibles: CollectibleSpawn[] = [];
  readonly boosts: BoostSpawn[] = [];
  readonly zones: ZoneSpawn[] = [];
  readonly tutorials: TutorialSpawn[] = [];

  constructor(length: number, turns: TurnSpec[], hills: HillSpec[]) {
    this.course = new Course(length, turns, hills, 0);
    this.network = new RailNetwork(this.course);
  }

  // ---------------------------------------------------------------- lanes

  lane(key: LaneKey): RailDef {
    const r = this.lanes.get(key);
    if (!r) throw new Error(`Lane ${key} is not open`);
    return r;
  }

  /** The rail that carried lane `key` at distance s (open or already closed). */
  railAt(key: LaneKey, s: number): RailDef {
    const list = this.history.get(key) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (s >= r.s0 - 0.001 && s <= r.s1 + 0.001) return r;
    }
    return this.lane(key);
  }

  latOf(key: LaneKey, s: number): number {
    return this.railAt(key, s).lat.at(s);
  }

  hOf(key: LaneKey, s: number): number {
    return this.railAt(key, s).h.at(s);
  }

  open(key: LaneKey, type: RailType, s: number, lat: number, h: number): RailDef {
    if (this.lanes.has(key)) throw new Error(`Lane ${key} already open`);
    const rail = this.network.add({
      type,
      s0: s,
      s1: Number.POSITIVE_INFINITY,
      lat: new Profile([{ s, v: lat }]),
      h: new Profile([{ s, v: h }]),
    });
    this.lanes.set(key, rail);
    const list = this.history.get(key) ?? [];
    list.push(rail);
    this.history.set(key, list);
    return rail;
  }

  /** Smoothly move a lane to a new lateral/vertical offset between s0 and s1. */
  move(key: LaneKey, s0: number, s1: number, lat?: number, h?: number): void {
    const r = this.lane(key);
    if (s0 > r.lat.lastS) r.lat.addKey(s0, r.lat.at(s0));
    if (s0 > r.h.lastS) r.h.addKey(s0, r.h.at(s0));
    r.lat.addKey(s1, lat ?? r.lat.at(s1));
    r.h.addKey(s1, h ?? r.h.at(s1));
  }

  close(key: LaneKey, s: number): RailDef {
    const r = this.lane(key);
    r.s1 = s;
    this.lanes.delete(key);
    return r;
  }

  closeAll(s: number): void {
    for (const key of [...this.lanes.keys()]) this.close(key, s);
  }

  // --------------------------------------------------------------- spawns

  private collectible(kind: CollectibleKind, key: LaneKey, s: number, hOff = COIN_H): void {
    const r = this.railAt(key, s);
    this.collectibles.push({ kind, s, lat: r.lat.at(s), h: r.h.at(s) + hOff, railId: r.id });
  }

  coinLine(key: LaneKey, s0: number, s1: number, spacing = 4.5): void {
    for (let s = s0; s <= s1 + 0.01; s += spacing) this.collectible('coin', key, s);
  }

  obstacle(kind: ObstacleKind, key: LaneKey, s: number): void {
    const r = this.railAt(key, s);
    this.obstacles.push({ kind, s, railId: r.id, lat: r.lat.at(s), h: r.h.at(s) });
  }

  gate(key: LaneKey, s: number): void {
    this.obstacle('gate', key, s);
  }

  boost(key: LaneKey, s: number): void {
    const r = this.railAt(key, s);
    this.boosts.push({ s, railId: r.id, lat: r.lat.at(s), h: r.h.at(s) });
  }

  zone(s0: number, s1: number, label: string): void {
    this.zones.push({ s0, s1, label });
  }

  tutorial(s: number, text: string): void {
    this.tutorials.push({ s, text });
  }

  // ---------------------------------------------------------------- build

  build(index: number, name: string, seed: number, baseSpeed: number, finishS: number, startRailId: number): LevelData {
    if (this.lanes.size > 0) throw new Error(`Lanes left open: ${[...this.lanes.keys()].join(',')}`);
    const byS = <T extends { s: number }>(a: T, b: T) => a.s - b.s;
    this.obstacles.sort(byS);
    this.collectibles.sort(byS);
    this.boosts.sort(byS);
    this.tutorials.sort(byS);
    return {
      index,
      name,
      seed,
      course: this.course,
      network: this.network,
      baseSpeed,
      finishS,
      startRailId,
      obstacles: this.obstacles,
      collectibles: this.collectibles,
      boosts: this.boosts,
      zones: this.zones,
      tutorials: this.tutorials,
    };
  }
}
