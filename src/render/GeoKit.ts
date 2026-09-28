import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;

const tmpP = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/**
 * Accumulates primitive geometries (each painted with vertex colours and
 * transformed into place) and merges them into one geometry, so each
 * prefab renders in a single draw call.
 */
export class GeoKit {
  private parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number | THREE.Color | ColorFn, matrix?: THREE.Matrix4): this {
    let g = geo.index ? geo : geo;
    if (!g.index) {
      // Give non-indexed geometries a trivial index so everything merges.
      const count = g.attributes.position.count;
      const idx = new Array<number>(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      g.setIndex(idx);
    }
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const fixed = typeof color === 'function' ? null : new THREE.Color(color as THREE.ColorRepresentation);
    for (let i = 0; i < pos.count; i++) {
      let c: THREE.Color;
      if (fixed) c = fixed;
      else {
        tmpP.fromBufferAttribute(pos, i);
        tmpN.fromBufferAttribute(nor, i);
        c = (color as ColorFn)(tmpP, tmpN);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  merge(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('GeoKit merge failed');
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();

/** Compose a transform matrix (position, euler rotation, scale). */
export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  e.set(rx, ry, rz);
  q.setFromEuler(e);
  v.set(x, y, z);
  sc.set(sx, sy, sz);
  return m4.clone().compose(v, q, sc);
}
