import { Vector3 } from 'three';
import { clamp, smoother01 } from '../core/MathUtil';

/** A smooth heading change: `angle` radians spread over `len` metres. */
export interface TurnSpec {
  s: number;
  len: number;
  angle: number;
}

/** A smooth elevation change of `dy` metres spread over `len` metres. */
export interface HillSpec {
  s: number;
  len: number;
  dy: number;
}

export interface CourseFrame {
  pos: Vector3;
  forward: Vector3;
  /** Banked right vector - lateral rail offsets are measured along it. */
  right: Vector3;
  /** Banked up vector - vertical rail offsets are measured along it. */
  up: Vector3;
  yaw: number;
  bank: number;
  /** Signed curvature (rad/m); positive = turning right. */
  curvature: number;
  /** dy/ds of the centreline. */
  slope: number;
}

export function makeFrame(): CourseFrame {
  return {
    pos: new Vector3(),
    forward: new Vector3(0, 0, -1),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    yaw: 0,
    bank: 0,
    curvature: 0,
    slope: 0,
  };
}

const STEP = 1; // metres between samples
const BANK_PER_CURVATURE = 9; // radians of bank per rad/m of curvature
const MAX_BANK = 0.2;

/**
 * The course centreline. All gameplay happens in course space
 * (s = distance along the centreline, lat = banked lateral offset,
 * h = banked vertical offset). This keeps rail following, switching,
 * collisions and camera framing simple and robust on curves and hills.
 */
export class Course {
  readonly length: number;
  private readonly n: number;
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly pz: Float64Array;
  private readonly yawArr: Float64Array;
  private readonly curvArr: Float64Array;

  constructor(
    length: number,
    readonly turns: TurnSpec[],
    readonly hills: HillSpec[],
    readonly baseHeight = 0,
  ) {
    // Sample a little past the end so lookups beyond the finish stay valid.
    this.length = length;
    this.n = Math.ceil((length + 400) / STEP) + 1;
    this.px = new Float64Array(this.n);
    this.py = new Float64Array(this.n);
    this.pz = new Float64Array(this.n);
    this.yawArr = new Float64Array(this.n);
    this.curvArr = new Float64Array(this.n);

    let x = 0;
    let z = 0;
    for (let i = 0; i < this.n; i++) {
      const s = i * STEP;
      const yaw = this.yawAt(s);
      this.yawArr[i] = yaw;
      this.px[i] = x;
      this.pz[i] = z;
      this.py[i] = this.heightAt(s);
      // Midpoint integration for the next sample.
      const ym = this.yawAt(s + STEP * 0.5);
      x += Math.sin(ym) * STEP;
      z -= Math.cos(ym) * STEP;
    }
    for (let i = 0; i < this.n; i++) {
      const a = this.yawArr[Math.max(0, i - 1)];
      const b = this.yawArr[Math.min(this.n - 1, i + 1)];
      const span = (Math.min(this.n - 1, i + 1) - Math.max(0, i - 1)) * STEP;
      this.curvArr[i] = (b - a) / span;
    }
  }

  private yawAt(s: number): number {
    let yaw = 0;
    for (const t of this.turns) yaw += t.angle * smoother01((s - t.s) / t.len);
    return yaw;
  }

  heightAt(s: number): number {
    let y = this.baseHeight;
    for (const h of this.hills) y += h.dy * smoother01((s - h.s) / h.len);
    return y;
  }

  private sampleIndex(s: number): { i: number; t: number } {
    const f = clamp(s / STEP, 0, this.n - 1.0001);
    const i = Math.floor(f);
    return { i, t: f - i };
  }

  curvature(s: number): number {
    const { i, t } = this.sampleIndex(s);
    return this.curvArr[i] + (this.curvArr[i + 1] - this.curvArr[i]) * t;
  }

  bank(s: number): number {
    return clamp(this.curvature(s) * BANK_PER_CURVATURE, -MAX_BANK, MAX_BANK);
  }

  /** Full centreline frame at distance s (s may be negative / past the end). */
  frame(s: number, out: CourseFrame): CourseFrame {
    const { i, t } = this.sampleIndex(s);
    const x = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    const y = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    const z = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t;
    const yaw = this.yawArr[i] + (this.yawArr[i + 1] - this.yawArr[i]) * t;
    const curvature = this.curvArr[i] + (this.curvArr[i + 1] - this.curvArr[i]) * t;
    const slope = this.py[i + 1] - this.py[i];

    // Extrapolate linearly before the start so the camera can sit behind s=0.
    if (s < 0) {
      out.pos.set(x + Math.sin(yaw) * s, y, z - Math.cos(yaw) * s);
    } else {
      out.pos.set(x, y, z);
    }

    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    out.forward.set(sy, slope / STEP, -cy).normalize();
    const bank = clamp(curvature * BANK_PER_CURVATURE, -MAX_BANK, MAX_BANK);
    const cb = Math.cos(bank);
    const sb = Math.sin(bank);
    // Horizontal right (cy, 0, sy); world-ish up = right x forward.
    const rx = cy;
    const rz = sy;
    // unbanked up = cross(R, F)
    const fx = out.forward.x;
    const fy = out.forward.y;
    const fz = out.forward.z;
    const ux = 0 * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - 0 * fx;
    // Bank: roll right/up around forward (inside of a turn goes down).
    out.right.set(rx * cb - ux * sb, -uy * sb, rz * cb - uz * sb);
    out.up.set(ux * cb + rx * sb, uy * cb, uz * cb + rz * sb);
    out.yaw = yaw;
    out.bank = bank;
    out.curvature = curvature;
    out.slope = slope / STEP;
    return out;
  }

  /** World position of a course-space point. */
  toWorld(s: number, lat: number, h: number, out: Vector3, frame: CourseFrame = scratchFrame): Vector3 {
    this.frame(s, frame);
    return out
      .copy(frame.pos)
      .addScaledVector(frame.right, lat)
      .addScaledVector(frame.up, h);
  }
}

const scratchFrame = makeFrame();
