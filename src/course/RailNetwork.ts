import { Vector3 } from 'three';
import { Course, CourseFrame, makeFrame } from './Course';
import { Profile } from './Profile';
import type { RailType } from './RailTypes';

export interface RailDef {
  id: number;
  type: RailType;
  s0: number;
  s1: number;
  /** Banked lateral offset from the centreline. */
  lat: Profile;
  /** Banked vertical offset from the centreline. */
  h: Profile;
}

export interface NeighbourQuery {
  rail: RailDef;
  s: number;
  dir: -1 | 1;
  /** Distance ahead at which the move completes. */
  lead: number;
}

/** Maximum lateral distance to an adjacent rail. */
export const MAX_SHIFT = 6.2;
const MIN_SHIFT = 0.12;
const MIN_REMAINING = 14;

export class RailNetwork {
  readonly rails: RailDef[] = [];
  private readonly byId = new Map<number, RailDef>();
  private nextId = 1;
  private readonly frame = makeFrame();

  constructor(readonly course: Course) {}

  add(def: Omit<RailDef, 'id'>): RailDef {
    const rail: RailDef = { ...def, id: this.nextId++ };
    this.rails.push(rail);
    this.byId.set(rail.id, rail);
    return rail;
  }

  get(id: number): RailDef {
    const r = this.byId.get(id);
    if (!r) throw new Error(`Unknown rail ${id}`);
    return r;
  }

  /** Rails that exist at distance s. */
  railsAt(s: number, out: RailDef[] = []): RailDef[] {
    out.length = 0;
    for (const r of this.rails) if (s >= r.s0 && s <= r.s1) out.push(r);
    return out;
  }

  /** Rails overlapping the range [a, b]. */
  railsInRange(a: number, b: number, out: RailDef[] = []): RailDef[] {
    out.length = 0;
    for (const r of this.rails) if (r.s1 >= a && r.s0 <= b) out.push(r);
    return out;
  }

  position(rail: RailDef, s: number, out: Vector3, frame: CourseFrame = this.frame): Vector3 {
    return this.course.toWorld(s, rail.lat.at(s), rail.h.at(s), out, frame);
  }

  /**
   * The adjacent rail to the left (-1) or right (+1): the nearest rail on
   * that side at the point where the move completes that still has track
   * ahead and is within reach.
   */
  neighbour(q: NeighbourQuery): RailDef | null {
    const sLand = q.s + q.lead;
    const curLat = q.rail.lat.at(sLand);
    const curH = q.rail.h.at(sLand);
    let best: RailDef | null = null;
    let bestD = Infinity;
    for (const r of this.rails) {
      if (r === q.rail) continue;
      if (q.s < r.s0 - 2 || sLand > r.s1 - MIN_REMAINING) continue;
      const d = (r.lat.at(sLand) - curLat) * q.dir;
      if (d < MIN_SHIFT || d > MAX_SHIFT) continue;
      if (Math.abs(r.h.at(sLand) - curH) > 4.5) continue;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  /** Closest rail to a course-space point. */
  closestRail(s: number, lat: number, h: number): RailDef | null {
    let best: RailDef | null = null;
    let bestD = Infinity;
    for (const r of this.rails) {
      if (s < r.s0 || s > r.s1) continue;
      const d = Math.hypot(r.lat.at(s) - lat, (r.h.at(s) - h) * 0.5);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }
}
