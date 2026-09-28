import { clamp, clamp01, easeInOutSine } from '../core/MathUtil';
import type { EventBus } from '../core/EventBus';
import { makeFrame } from '../course/Course';
import type { LevelData } from '../course/LevelData';
import type { RailDef } from '../course/RailNetwork';

export type PlayerState = 'idle' | 'riding' | 'crashed' | 'finished';

/** Duration of the basic slide between adjacent parallel rails (Phase 1). */
export const MOVE_DURATION = 0.26;
const INPUT_BUFFER = 0.22;
const BOOST_TIME = 1.8;
const BOOST_SPEED = 10;
const frameTmp = makeFrame();

interface RailMove {
  from: RailDef;
  to: RailDef;
  t: number;
  dir: -1 | 1;
}

/**
 * The rider in course space. He is always attached to a rail: position is
 * (s, lat, h) where lat/h come from the rail he rides (or a blend of two
 * rails while sliding across). Speed responds to slopes and boosts.
 */
export class Player {
  state: PlayerState = 'idle';
  s = 0;
  speed = 0;
  rail: RailDef;
  lat = 0;
  h = 0;
  /** Lateral velocity (m/s) - drives lean / camera tilt. */
  latVel = 0;
  /** Forward acceleration (m/s^2) - drives lean. */
  accel = 0;
  boostTime = 0;
  crashTime = 0;
  finishTime = 0;
  move: RailMove | null = null;
  private pendingDir: -1 | 0 | 1 = 0;
  private pendingTime = 0;

  constructor(private readonly level: LevelData, private readonly bus: EventBus) {
    this.rail = level.network.get(level.startRailId);
    this.reset();
  }

  reset(): void {
    this.state = 'idle';
    this.s = 0;
    this.speed = 0;
    this.rail = this.level.network.get(this.level.startRailId);
    this.lat = this.rail.lat.at(0);
    this.h = this.rail.h.at(0);
    this.latVel = 0;
    this.accel = 0;
    this.boostTime = 0;
    this.crashTime = 0;
    this.finishTime = 0;
    this.move = null;
    this.pendingDir = 0;
  }

  start(): void {
    if (this.state === 'idle') this.state = 'riding';
  }

  /** Ask to move to the adjacent rail on the left (-1) or right (+1). */
  requestMove(dir: -1 | 1): void {
    if (this.state !== 'riding') return;
    this.pendingDir = dir;
    this.pendingTime = INPUT_BUFFER;
  }

  get progress(): number {
    return clamp01(this.s / this.level.finishS);
  }

  get boosting(): boolean {
    return this.boostTime > 0;
  }

  boost(): void {
    this.boostTime = BOOST_TIME;
  }

  /** Hit a gate at distance `atS`: stop against it and bounce back. */
  crash(atS: number = this.s): void {
    if (this.state !== 'riding') return;
    this.state = 'crashed';
    this.crashTime = 0;
    this.s = Math.min(this.s, atS - 1.1);
    this.speed = -5.5;
    this.boostTime = 0;
    this.bus.emit('crashed', {});
  }

  private targetSpeed(): number {
    const lvl = this.level;
    let v = lvl.baseSpeed * (1 + 0.12 * this.progress);
    // Downhill speeds you up, uphill slows you a little.
    v -= clamp(lvl.course.frame(this.s, frameTmp).slope, -0.25, 0.25) * 22;
    v += BOOST_SPEED * clamp01(this.boostTime / (BOOST_TIME * 0.6));
    return v;
  }

  update(dt: number): void {
    const prevSpeed = this.speed;
    const prevLat = this.lat;
    switch (this.state) {
      case 'idle':
        this.speed = 0;
        break;
      case 'riding': {
        const target = this.targetSpeed();
        const a = this.speed < 8 ? 16 : this.speed < target ? 7 : 5;
        this.speed = this.speed < target ? Math.min(target, this.speed + a * dt) : Math.max(target, this.speed - a * dt);
        this.boostTime = Math.max(0, this.boostTime - dt);
        this.handleInput(dt);
        break;
      }
      case 'crashed':
        this.crashTime += dt;
        this.speed = Math.min(0, this.speed + 9 * dt);
        break;
      case 'finished':
        this.finishTime += dt;
        this.speed = Math.max(0, this.speed - 11 * dt);
        break;
    }
    this.s += this.speed * dt;
    if (this.state === 'riding' && this.s >= this.level.finishS) {
      this.state = 'finished';
      this.finishTime = 0;
      this.bus.emit('levelComplete', {});
    }
    this.updateLateral(dt);
    this.accel = dt > 0 ? (this.speed - prevSpeed) / dt : 0;
    this.latVel = dt > 0 ? (this.lat - prevLat) / dt : 0;
  }

  private handleInput(dt: number): void {
    if (this.pendingDir !== 0) {
      this.pendingTime -= dt;
      if (this.pendingTime <= 0) this.pendingDir = 0;
    }
    if (this.move || this.pendingDir === 0) return;
    const dir = this.pendingDir;
    const target = this.level.network.neighbour({ rail: this.rail, s: this.s, dir, lead: this.speed * MOVE_DURATION });
    this.pendingDir = 0;
    if (!target) {
      this.bus.emit('railChangeBlocked', { dir });
      return;
    }
    this.move = { from: this.rail, to: target, t: 0, dir };
    this.rail = target;
    this.bus.emit('railChanged', { dir });
  }

  private updateLateral(dt: number): void {
    const s = this.s;
    if (this.move) {
      const m = this.move;
      m.t = Math.min(1, m.t + dt / MOVE_DURATION);
      const k = easeInOutSine(m.t);
      this.lat = m.from.lat.at(s) + (m.to.lat.at(s) - m.from.lat.at(s)) * k;
      // A slight lift keeps the skates clear of the rail lips while sliding over.
      this.h = m.from.h.at(s) + (m.to.h.at(s) - m.from.h.at(s)) * k + Math.sin(Math.PI * m.t) * 0.28;
      if (m.t >= 1) this.move = null;
    } else {
      this.lat = this.rail.lat.at(s);
      this.h = this.rail.h.at(s);
    }
  }
}

