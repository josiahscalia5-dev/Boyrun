import { Rng } from '../core/MathUtil';
import { FADE_FAR_Z, HIT_Z, REMOVE_Z, zFromCoinY } from './Perspective';

export type ItemKind = 'coin' | 'gate' | 'boost';
export type Lane = -1 | 0 | 1;

export interface Item {
  id: number;
  kind: ItemKind;
  lane: Lane;
  /** Position along the rail (same units as depth z). */
  w: number;
  /** Index of the coin painted in the artwork this item starts as. */
  artIndex?: number;
  state: 'live' | 'collected' | 'hit' | 'boosted';
}

export interface TrackEvent {
  type: 'coin' | 'crash' | 'boost';
  item: Item;
}

export const BASE_SPEED = 1.45;
export const MAX_SPEED = 2.3;
const BOOST_MUL = 1.4;
const BOOST_TIME = 1.6;
/** Lateral tolerance: how close (in lanes) the boy must be to touch an item. */
const TOUCH = 0.5;

/** Coin centres painted on the gold rail (y in image px), near to far. */
export const ART_COIN_Y = [540.5, 481.0, 441.0, 421.5];

/**
 * The ride along the gold rail: coins, red X gates and blue chevron boost
 * blocks approach in three lanes. Starts with exactly the coins painted in
 * the artwork, then continues with generated patterns.
 */
export class Track {
  d = 0;
  speed = BASE_SPEED;
  boostTime = 0;
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
    this.items = [];
    this.nextId = 1;
    // The painted coin trail.
    ART_COIN_Y.forEach((y, i) => this.add('coin', 0, zFromCoinY(y), i));
    // It continues down the gold rail, then generated patterns take over.
    for (let w = 3.65; w < 5.2; w += 0.7) this.add('coin', 0, w);
    this.nextW = 6.2;
  }

  z(item: Item): number {
    return item.w - this.d;
  }

  get boosting(): boolean {
    return this.boostTime > 0;
  }

  private add(kind: ItemKind, lane: Lane, w: number, artIndex?: number): Item {
    const it: Item = { id: this.nextId++, kind, lane, w, artIndex, state: 'live' };
    this.items.push(it);
    return it;
  }

  private coinTrain(lane: Lane, w0: number, n: number, spacing = 0.55): number {
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
      for (const l of seq) {
        ww = this.coinTrain(l, ww, 3) + 0.55;
      }
      end = ww;
    }
    this.nextW = end + r.range(1.4, 2.1);
  }

  /**
   * Advance the ride. `boyLane` is the boy's continuous lateral position in
   * lanes (-1..1). Returns events for things that met the boy this step.
   */
  update(dt: number, boyLane: number, riding: boolean): TrackEvent[] {
    const events: TrackEvent[] = [];
    this.time += dt;
    if (riding) {
      const target = Math.min(MAX_SPEED, BASE_SPEED + this.time * 0.009);
      this.speed += (target - this.speed) * Math.min(1, dt * 2);
    } else {
      this.speed = Math.max(0, this.speed - dt * 5);
    }
    this.boostTime = Math.max(0, this.boostTime - dt);
    const v = this.speed * (this.boostTime > 0 ? BOOST_MUL : 1);
    const prevD = this.d;
    this.d += v * dt;

    for (const it of this.items) {
      if (it.state !== 'live') continue;
      const zPrev = it.w - prevD;
      const zNow = it.w - this.d;
      if (zPrev > HIT_Z && zNow <= HIT_Z && riding) {
        if (Math.abs(boyLane - it.lane) < TOUCH) {
          if (it.kind === 'coin') {
            it.state = 'collected';
            events.push({ type: 'coin', item: it });
          } else if (it.kind === 'gate') {
            it.state = 'hit';
            events.push({ type: 'crash', item: it });
          } else {
            it.state = 'boosted';
            this.boostTime = BOOST_TIME;
            events.push({ type: 'boost', item: it });
          }
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
