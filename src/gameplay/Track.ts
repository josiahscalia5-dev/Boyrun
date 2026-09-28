import { Rng } from '../core/MathUtil';
import { ART_Z, FADE_FAR_Z, HIT_Z, REMOVE_Z } from './Rail';

export type ItemKind = 'coin' | 'gate' | 'boost';
export type Lane = -1 | 0 | 1;

export interface Item {
  id: number;
  kind: ItemKind;
  lane: Lane;
  /** Position along the rail, in the same units as depth. */
  w: number;
  /** Index of the coin painted in the artwork that this item starts as. */
  artIndex?: number;
  state: 'live' | 'collected' | 'hit' | 'boosted';
}

export interface TrackEvent {
  type: 'coin' | 'crash' | 'boost';
  item: Item;
  /** Set on the chevron that completes a chain and fires the super boost. */
  superBoost?: boolean;
}

/**
 * Rail speed in depth per second. Calibrated so the coin trail sweeps down
 * the painting at the pace the artwork's motion blur suggests.
 */
export const BASE_SPEED = 1.6;
export const MAX_SPEED = 2.5;
const BOOST_MUL = 1.4;
const BOOST_TIME = 1.6;
/** Every third chevron in a row fires the super boost. */
export const CHAIN_LENGTH = 3;
export const SUPER_MUL = 1.85;
const SUPER_TIME = 3.2;
/** How long a chain stays alive between chevrons. */
const CHAIN_WINDOW = 7;
/** Lateral tolerance: how close (in lanes) the boy must be to touch an item. */
const TOUCH = 0.5;
/** Spacing of a coin train, matching the painted trail. */
const COIN_GAP = 0.55;

/**
 * The ride along the gold rail: coins, red X gates and blue chevron boost
 * blocks approach in three lanes. It starts with exactly the coins painted in
 * the artwork, then continues into generated patterns.
 */
export class Track {
  d = 0;
  speed = BASE_SPEED;
  boostTime = 0;
  /** Chevrons taken so far towards the next super boost, 0..CHAIN_LENGTH-1. */
  boostChain = 0;
  superTime = 0;
  private chainExpiry = 0;
  items: Item[] = [];
  private nextW = 0;
  private nextId = 1;
  private rng: Rng;
  private time = 0;

  constructor(private readonly seed = 12) {
    this.rng = new Rng(seed);
    this.reset();
  }

  reset(): void {
    this.rng = new Rng(this.seed);
    this.d = 0;
    this.time = 0;
    this.speed = BASE_SPEED;
    this.boostTime = 0;
    this.boostChain = 0;
    this.superTime = 0;
    this.chainExpiry = 0;
    this.items = [];
    this.nextId = 1;
    // The coin trail exactly as painted...
    ART_Z.forEach((z, i) => this.add('coin', 0, z, i));
    // ...continuing away down the gold rail, then generated patterns take over.
    const last = ART_Z[ART_Z.length - 1];
    for (let w = last + 0.7; w < last + 2.4; w += 0.7) this.add('coin', 0, w);
    this.nextW = last + 3.4;
  }

  z(item: Item): number {
    return item.w - this.d;
  }

  get boosting(): boolean {
    return this.boostTime > 0;
  }

  /** Running on the super boost won by a full chain of chevrons. */
  get superCharged(): boolean {
    return this.superTime > 0;
  }

  /** How fast the rail is actually running, boosts included. */
  get velocity(): number {
    return this.speed * (this.superTime > 0 ? SUPER_MUL : this.boostTime > 0 ? BOOST_MUL : 1);
  }

  /**
   * A blue chevron was taken. Every third one in a row fires the super boost,
   * which is the hook a HUD counter or a reward would hang off later.
   */
  private takeBoost(): boolean {
    if (this.time > this.chainExpiry) this.boostChain = 0;
    this.chainExpiry = this.time + CHAIN_WINDOW;
    this.boostTime = BOOST_TIME;
    this.boostChain++;
    if (this.boostChain < CHAIN_LENGTH) return false;
    this.boostChain = 0;
    this.superTime = SUPER_TIME;
    return true;
  }

  /** Clipped something but survived it: lose the pace, keep riding. */
  stagger(): void {
    this.speed = Math.max(BASE_SPEED * 0.45, this.speed * 0.5);
    this.boostTime = 0;
    this.superTime = 0;
    this.boostChain = 0;
  }

  /** Stop dead (the boy hit a gate). */
  halt(): void {
    this.speed = 0;
    this.boostTime = 0;
  }

  private add(kind: ItemKind, lane: Lane, w: number, artIndex?: number): Item {
    const it: Item = { id: this.nextId++, kind, lane, w, artIndex, state: 'live' };
    this.items.push(it);
    return it;
  }

  private coinTrain(lane: Lane, w0: number, n: number, spacing = COIN_GAP): number {
    for (let i = 0; i < n; i++) this.add('coin', lane, w0 + i * spacing);
    return w0 + (n - 1) * spacing;
  }

  /** Append one pattern starting at nextW. Every row leaves a free lane. */
  private generate(): void {
    const r = this.rng;
    const w = this.nextW;
    const lanes: Lane[] = [-1, 0, 1];
    const pick = () => r.pick(lanes);
    const roll = r.next();
    let end = w;
    if (roll < 0.26) {
      end = this.coinTrain(pick(), w, r.int(5, 7));
    } else if (roll < 0.5) {
      const gateLane = pick();
      const free = lanes.filter((l) => l !== gateLane);
      this.add('gate', gateLane, w + 0.9);
      end = this.coinTrain(r.pick(free), w, 5);
      end = Math.max(end, w + 0.9);
    } else if (roll < 0.68) {
      const freeLane = pick();
      for (const l of lanes) if (l !== freeLane) this.add('gate', l, w + 1.0);
      end = this.coinTrain(freeLane, w + 0.2, 4);
      end = Math.max(end, w + 1.0);
    } else if (roll < 0.84) {
      const lane = pick();
      this.add('boost', lane, w);
      end = this.coinTrain(lane, w + 0.7, 5);
    } else {
      // Zig-zag across the lanes.
      const dir = r.chance(0.5) ? 1 : -1;
      const seq: Lane[] = dir > 0 ? [-1, 0, 1] : [1, 0, -1];
      let ww = w;
      for (const l of seq) ww = this.coinTrain(l, ww, 3) + COIN_GAP;
      end = ww;
    }
    this.nextW = end + r.range(1.4, 2.1);
  }

  /**
   * Advance the ride. `boyLane` is the boy's continuous lateral position in
   * lanes (-1..1). Returns events for the things that met him this step.
   */
  update(dt: number, boyLane: number, riding: boolean): TrackEvent[] {
    const events: TrackEvent[] = [];
    this.time += dt;
    if (riding) {
      const target = Math.min(MAX_SPEED, BASE_SPEED + this.time * 0.01);
      this.speed += (target - this.speed) * Math.min(1, dt * 2);
    } else {
      this.speed = 0;
    }
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.superTime = Math.max(0, this.superTime - dt);
    const v = this.velocity;
    const prevD = this.d;
    this.d += v * dt;

    for (const it of this.items) {
      if (it.state !== 'live') continue;
      const zPrev = it.w - prevD;
      const zNow = it.w - this.d;
      if (zPrev > HIT_Z && zNow <= HIT_Z && riding && Math.abs(boyLane - it.lane) < TOUCH) {
        if (it.kind === 'coin') {
          it.state = 'collected';
          events.push({ type: 'coin', item: it });
        } else if (it.kind === 'gate') {
          it.state = 'hit';
          events.push({ type: 'crash', item: it });
        } else {
          it.state = 'boosted';
          events.push({ type: 'boost', item: it, superBoost: this.takeBoost() });
        }
      }
    }
    this.items = this.items.filter((it) => it.w - this.d > REMOVE_Z && !(it.kind === 'coin' && it.state === 'collected'));
    while (this.nextW < this.d + FADE_FAR_Z + 1.5) this.generate();
    return events;
  }

  /** Items sorted far to near (painter's order). */
  visible(): Item[] {
    return this.items.filter((it) => this.z(it) < FADE_FAR_Z).sort((a, b) => b.w - a.w);
  }
}
