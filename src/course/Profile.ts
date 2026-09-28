import { smoother01 } from '../core/MathUtil';

export interface ProfileKey {
  s: number;
  v: number;
}

/**
 * A 1D function of course distance built from keyframes with C2-smooth
 * (quintic) interpolation between neighbouring keys. Used for rail lateral
 * offsets and vertical offsets so branches, merges and hops are smooth.
 */
export class Profile {
  readonly keys: ProfileKey[];

  constructor(keys: ProfileKey[]) {
    if (keys.length === 0) throw new Error('Profile needs at least one key');
    this.keys = [...keys].sort((a, b) => a.s - b.s);
  }

  static constant(v: number): Profile {
    return new Profile([{ s: 0, v }]);
  }

  at(s: number): number {
    const k = this.keys;
    if (s <= k[0].s) return k[0].v;
    const last = k[k.length - 1];
    if (s >= last.s) return last.v;
    let lo = 0;
    let hi = k.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (k[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = k[lo];
    const b = k[hi];
    const t = (s - a.s) / (b.s - a.s);
    return a.v + (b.v - a.v) * smoother01(t);
  }

  /** Append a key (builders extend profiles as they author a level). */
  addKey(s: number, v: number): void {
    const last = this.keys[this.keys.length - 1];
    if (Math.abs(s - last.s) < 1e-6) last.v = v;
    else if (s > last.s) this.keys.push({ s, v });
    else throw new Error(`Profile keys must be added in order (${s} < ${last.s})`);
  }

  get lastS(): number {
    return this.keys[this.keys.length - 1].s;
  }

  /** Numerical slope dv/ds. */
  slope(s: number): number {
    return (this.at(s + 0.5) - this.at(s - 0.5)) / 1;
  }
}
