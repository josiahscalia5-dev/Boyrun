import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp01, noise2, Rng } from '../core/MathUtil';
import { GeoKit, trs } from './GeoKit';

export type PartMaterial = 'world' | 'water';

export interface PrefabPart {
  geometry: THREE.BufferGeometry;
  material: PartMaterial;
}

export interface Prefab {
  name: string;
  parts: PrefabPart[];
  /** Horizontal footprint radius (metres, unscaled). */
  radius: number;
  /** Extent above (top) and below (bottom) the origin. */
  top: number;
  bottom: number;
}

// Palette sampled from the reference art.
const COL = {
  grassA: new THREE.Color(0x7fd64a),
  grassB: new THREE.Color(0x3f9a2e),
  grassC: new THREE.Color(0xb6dd62),
  dirt: new THREE.Color(0x7b6a3e),
  rockLight: new THREE.Color(0xc0936a),
  rockMid: new THREE.Color(0x8a6048),
  rockDark: new THREE.Color(0x574358),
  moss: new THREE.Color(0x5d9c3e),
  wall: new THREE.Color(0xf3e7d2),
  wallShade: new THREE.Color(0xd9c7ab),
  roofA: new THREE.Color(0x2f78d6),
  roofB: new THREE.Color(0x47a6e6),
  roofC: new THREE.Color(0x3a5fc8),
  roofRed: new THREE.Color(0xd8574a),
  gold: new THREE.Color(0xf2c14e),
  window: new THREE.Color(0x27407a),
  pine: new THREE.Color(0x2f8a4a),
  leaf: new THREE.Color(0x66bd4b),
  trunk: new THREE.Color(0x6d4a2e),
  vine: new THREE.Color(0x3f7f35),
};

const tmpC = new THREE.Color();

// --------------------------------------------------------------------- island

interface IslandOpts {
  r: number;
  depth: number;
  seed: number;
  deco: 'trees' | 'village' | 'castle' | 'grand' | 'tower' | 'none';
  waterfalls: number;
}

function islandBody(kit: GeoKit, o: IslandOpts): void {
  const R = o.r;
  const d = o.depth;
  const prof: [number, number][] = [
    [0, 0.07],
    [0.35, 0.065],
    [0.7, 0.045],
    [0.92, 0.02],
    [1.0, -0.01],
    [0.97, -0.07],
    [0.86, -0.16],
    [0.74, -0.32 * d],
    [0.6, -0.5 * d],
    [0.44, -0.72 * d],
    [0.28, -0.95 * d],
    [0.14, -1.18 * d],
    [0.05, -1.36 * d],
    [0.0, -1.45 * d],
  ];
  const pts = prof.map(([x, y]) => new THREE.Vector2(x * R, y * R));
  const geo = new THREE.LatheGeometry(pts, 22);
  const pos = geo.attributes.position;
  const s = o.seed * 3.17;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const nx = p.x / R;
    const nz = p.z / R;
    const ny = p.y / R;
    if (ny < -0.03) {
      const n1 = noise2(nx * 2.2 + s, nz * 2.2 + ny * 1.5);
      const n2 = noise2(nx * 6 + ny * 4, nz * 6 - s);
      const f = 1 + 0.3 * (n1 - 0.5) + 0.14 * (n2 - 0.5);
      p.x *= f;
      p.z *= f;
      const n3 = noise2(nx * 3 + s * 2, nz * 3 + 7.1);
      p.y += (n3 - 0.5) * 0.28 * R * clamp01(-ny * 1.5);
    } else {
      const n = noise2(nx * 4 + s, nz * 4);
      p.y += (n - 0.5) * 0.035 * R;
      const f = 1 + (noise2(nx * 3 - s, nz * 3) - 0.5) * 0.08;
      p.x *= f;
      p.z *= f;
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  kit.add(geo, (pt, n) => {
    const ny = pt.y / R;
    const nn = noise2(pt.x * 0.35 + s, pt.z * 0.35);
    if (ny > -0.035 && n.y > 0.25) {
      tmpC.copy(COL.grassA).lerp(COL.grassB, nn);
      if (nn > 0.72) tmpC.lerp(COL.grassC, 0.5);
      return tmpC;
    }
    if (ny > -0.15) return tmpC.copy(COL.moss).lerp(COL.dirt, clamp01((-ny - 0.03) * 8));
    const stripe = 0.5 + 0.5 * Math.sin(pt.y * (3.2 / Math.max(1, R * 0.08)) + nn * 4);
    tmpC.copy(COL.rockLight).lerp(COL.rockMid, stripe * 0.8);
    tmpC.lerp(COL.rockDark, clamp01((-ny - 0.3) / (1.2 * d)));
    // Brighter faces toward the sky/sides, darker undersides.
    const shade = 0.78 + 0.22 * clamp01(n.y + 0.6);
    tmpC.multiplyScalar(shade);
    if (nn > 0.78 && ny > -0.5) tmpC.lerp(COL.moss, 0.55);
    return tmpC;
  });

  // Jagged hanging rocks and vines.
  const rng = new Rng(o.seed * 101 + 7);
  const rocks = 3 + Math.floor(R / 6);
  for (let i = 0; i < rocks; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.25, 0.7) * R;
    const y = -rng.range(0.25, 0.9) * R * d;
    const size = rng.range(0.08, 0.16) * R;
    const g = new THREE.DodecahedronGeometry(size, 0);
    kit.add(g, (_pt, n) => tmpC.copy(COL.rockMid).lerp(COL.rockDark, 0.4).multiplyScalar(0.8 + 0.25 * clamp01(n.y + 0.5)),
      trs(Math.cos(a) * rr, y, Math.sin(a) * rr, rng.next() * 3, rng.next() * 3, rng.next() * 3, 1, rng.range(1.2, 1.9), 1));
  }
  const vines = Math.floor(R / 3);
  for (let i = 0; i < vines; i++) {
    const a = rng.range(0, Math.PI * 2);
    const len = rng.range(0.1, 0.3) * R;
    const g = new THREE.ConeGeometry(0.018 * R + 0.05, len, 4, 1);
    kit.add(g, COL.vine, trs(Math.cos(a) * 0.93 * R, -0.08 * R - len / 2, Math.sin(a) * 0.93 * R, Math.PI));
  }
}

function tree(kit: GeoKit, x: number, y: number, z: number, h: number, rng: Rng): void {
  kit.add(new THREE.CylinderGeometry(h * 0.05, h * 0.07, h * 0.3, 5), COL.trunk, trs(x, y + h * 0.15, z));
  if (rng.chance(0.55)) {
    kit.add(new THREE.ConeGeometry(h * 0.28, h * 0.75, 7), tmpC.copy(COL.pine).offsetHSL(0, 0, rng.range(-0.04, 0.05)).clone(), trs(x, y + h * 0.62, z));
  } else {
    kit.add(new THREE.IcosahedronGeometry(h * 0.33, 1), tmpC.copy(COL.leaf).offsetHSL(rng.range(-0.02, 0.03), 0, rng.range(-0.05, 0.05)).clone(), trs(x, y + h * 0.55, z, 0, 0, 0, 1, 0.9, 1));
  }
}

function tower(kit: GeoKit, x: number, y: number, z: number, r: number, h: number, roof: THREE.Color, rng: Rng): void {
  kit.add(new THREE.CylinderGeometry(r, r * 1.05, h, 12), (_pt, n) => tmpC.copy(COL.wall).lerp(COL.wallShade, clamp01(0.5 - n.x * 0.5)), trs(x, y + h / 2, z));
  // gold band under the roof
  kit.add(new THREE.CylinderGeometry(r * 1.12, r * 1.12, h * 0.05, 12), COL.gold, trs(x, y + h * 0.97, z));
  const rh = r * rng.range(2.2, 3.0);
  kit.add(new THREE.ConeGeometry(r * 1.3, rh, 12), roof, trs(x, y + h + rh / 2, z));
  kit.add(new THREE.ConeGeometry(r * 0.12, rh * 0.45, 5), COL.gold, trs(x, y + h + rh + rh * 0.2, z));
  // windows
  const wins = Math.max(2, Math.floor(h / (r * 2.2)));
  for (let i = 0; i < wins; i++) {
    const a = rng.range(0, Math.PI * 2);
    kit.add(new THREE.BoxGeometry(r * 0.35, r * 0.6, r * 0.2), COL.window,
      trs(x + Math.cos(a) * r * 0.98, y + h * (0.35 + 0.5 * (i / wins)), z + Math.sin(a) * r * 0.98, 0, -a + Math.PI / 2, 0));
  }
}

function castle(kit: GeoKit, S: number, rng: Rng, grand: boolean): void {
  const roofs = [COL.roofA, COL.roofB, COL.roofC];
  // central keep
  tower(kit, 0, 0, 0, S * 0.14, S * (grand ? 0.95 : 0.7), COL.roofA, rng);
  // hall block with pitched roof
  kit.add(new THREE.BoxGeometry(S * 0.5, S * 0.26, S * 0.32), (_pt, n) => tmpC.copy(COL.wall).lerp(COL.wallShade, clamp01(0.5 - n.x * 0.5)), trs(0, S * 0.13, S * 0.12));
  kit.add(new THREE.CylinderGeometry(0.001, S * 0.26, S * 0.18, 4, 1), COL.roofB, trs(0, S * 0.35, S * 0.12, 0, Math.PI / 4, 0, 1.35, 1, 0.9));
  const ring = grand ? 7 : 4;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const rr = S * rng.range(0.34, 0.44);
    tower(kit, Math.cos(a) * rr, 0, Math.sin(a) * rr, S * rng.range(0.06, 0.09), S * rng.range(0.35, 0.6), rng.pick(roofs), rng);
  }
  // walls between towers
  for (let i = 0; i < ring; i++) {
    const a0 = (i / ring) * Math.PI * 2;
    const a1 = ((i + 1) / ring) * Math.PI * 2;
    const rr = S * 0.39;
    const x0 = Math.cos(a0) * rr;
    const z0 = Math.sin(a0) * rr;
    const x1 = Math.cos(a1) * rr;
    const z1 = Math.sin(a1) * rr;
    const len = Math.hypot(x1 - x0, z1 - z0);
    kit.add(new THREE.BoxGeometry(len, S * 0.16, S * 0.04), COL.wallShade,
      trs((x0 + x1) / 2, S * 0.08, (z0 + z1) / 2, 0, -Math.atan2(z1 - z0, x1 - x0), 0));
  }
  if (grand) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      tower(kit, Math.cos(a) * S * 0.2, 0, Math.sin(a) * S * 0.2, S * 0.05, S * rng.range(0.9, 1.25), rng.pick(roofs), rng);
    }
    // great arched gate
    kit.add(new THREE.TorusGeometry(S * 0.1, S * 0.025, 6, 16, Math.PI), COL.gold, trs(0, S * 0.2, S * 0.29));
  }
}

function village(kit: GeoKit, R: number, rng: Rng): void {
  const n = 3 + Math.floor(R / 6);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.1, 0.65) * R;
    const w = rng.range(0.1, 0.16) * R;
    const h = w * rng.range(0.8, 1.3);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const ry = rng.range(0, Math.PI);
    kit.add(new THREE.BoxGeometry(w, h, w * 0.8), COL.wall, trs(x, h / 2, z, 0, ry, 0));
    kit.add(new THREE.ConeGeometry(w * 0.78, h * 0.8, 4), rng.chance(0.3) ? COL.roofRed : rng.pick([COL.roofA, COL.roofB]), trs(x, h + h * 0.4, z, 0, ry + Math.PI / 4, 0));
  }
  if (rng.chance(0.7)) tower(kit, 0, 0, 0, R * 0.06, R * 0.45, COL.roofA, rng);
}

/** Waterfall ribbons falling off the island lip (separate animated material). */
function waterfalls(o: IslandOpts, rng: Rng): THREE.BufferGeometry | null {
  if (o.waterfalls <= 0) return null;
  const R = o.r;
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 0; k < o.waterfalls; k++) {
    const a = rng.range(0, Math.PI * 2);
    const w = rng.range(0.1, 0.18) * R;
    const L = rng.range(1.6, 3.2) * R;
    const rows = 10;
    const posArr: number[] = [];
    const uvArr: number[] = [];
    const nrmArr: number[] = [];
    const idx: number[] = [];
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const base = out.clone().multiplyScalar(R * (1.0 + 0.02 + t * t * 0.28));
      base.y = 0.02 * R - t * L;
      const width = w * (1 + t * 0.5);
      for (const side of [-1, 1]) {
        const p = base.clone().addScaledVector(tan, (side * width) / 2);
        posArr.push(p.x, p.y, p.z);
        uvArr.push(side < 0 ? 0 : 1, (t * L) / 14);
        nrmArr.push(out.x, 0, out.z);
      }
      if (r < rows) {
        const i = r * 2;
        idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
    // Flat pool on the top edge feeding the fall.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
    g.setIndex(idx);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

export function buildIsland(name: string, o: IslandOpts): Prefab {
  const kit = new GeoKit();
  const rng = new Rng(o.seed * 7 + 3);
  islandBody(kit, o);
  const R = o.r;
  const topY = 0.03 * R;
  let top = 0.1 * R;
  if (o.deco === 'castle' || o.deco === 'grand') {
    const S = R * (o.deco === 'grand' ? 0.85 : 0.7);
    const castleKit = kit;
    castle(castleKit, S, rng, o.deco === 'grand');
    top = S * (o.deco === 'grand' ? 1.7 : 1.2);
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0, Math.PI * 2);
      tree(kit, Math.cos(a) * R * 0.78, topY, Math.sin(a) * R * 0.78, R * rng.range(0.1, 0.16), rng);
    }
  } else if (o.deco === 'village') {
    village(kit, R, rng);
    top = R * 0.6;
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      tree(kit, Math.cos(a) * R * rng.range(0.6, 0.85), topY, Math.sin(a) * R * rng.range(0.6, 0.85), R * rng.range(0.12, 0.2), rng);
    }
  } else if (o.deco === 'tower') {
    tower(kit, 0, topY, 0, R * 0.14, R * 1.1, COL.roofA, rng);
    top = R * 1.6;
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI * 2);
      tree(kit, Math.cos(a) * R * 0.6, topY, Math.sin(a) * R * 0.6, R * 0.25, rng);
    }
  } else if (o.deco === 'trees') {
    const n = 4 + Math.floor(R / 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * R * 0.8;
      tree(kit, Math.cos(a) * rr, topY, Math.sin(a) * rr, R * rng.range(0.15, 0.3), rng);
    }
    top = R * 0.35;
  }
  const parts: PrefabPart[] = [{ geometry: kit.merge(), material: 'world' }];
  const water = waterfalls(o, rng);
  if (water) parts.push({ geometry: water, material: 'water' });
  return { name, parts, radius: R * 1.3, top, bottom: R * 1.6 * o.depth + (o.waterfalls > 0 ? R * 3 : 0) };
}

// ---------------------------------------------------------------- balloon

export function buildBalloon(): Prefab {
  const kit = new GeoKit();
  const stripes = [0xff6f91, 0xffd166, 0x7fd1ff, 0xff9f6b, 0xff6f91, 0xffd166, 0x9d7bff, 0x7fd1ff];
  const sphere = new THREE.SphereGeometry(4, 24, 16);
  kit.add(sphere, (p) => {
    const a = (Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2);
    tmpC.setHex(stripes[Math.floor(a * stripes.length) % stripes.length]);
    return tmpC.multiplyScalar(0.8 + 0.2 * clamp01(p.y / 4 + 0.5));
  }, trs(0, 5, 0, 0, 0, 0, 1, 1.18, 1));
  kit.add(new THREE.CylinderGeometry(1.6, 0.8, 1.6, 12), 0xff8fa8, trs(0, 0.6, 0));
  kit.add(new THREE.BoxGeometry(1.4, 1.1, 1.4), 0x8a5a34, trs(0, -2.2, 0));
  for (const [x, z] of [
    [0.6, 0.6],
    [-0.6, 0.6],
    [0.6, -0.6],
    [-0.6, -0.6],
  ]) {
    kit.add(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 3), 0x5a4030, trs(x, -0.7, z, x * 0.2, 0, z * 0.2));
  }
  return { name: 'balloon', parts: [{ geometry: kit.merge(), material: 'world' }], radius: 5, top: 10, bottom: 3 };
}

// ------------------------------------------------------------- sky bridge

/** Distant arched stone bridge with a glowing rail on top (background structure). */
export function buildBridge(length: number): Prefab {
  const kit = new GeoKit();
  const spans = Math.max(2, Math.round(length / 24));
  const span = length / spans;
  kit.add(new THREE.BoxGeometry(length, 1.6, 4), COL.wallShade, trs(0, 0, 0));
  for (let i = 0; i <= spans; i++) {
    const x = -length / 2 + i * span;
    kit.add(new THREE.BoxGeometry(2.2, 14, 2.6), COL.wall, trs(x, -7.8, 0));
    if (i < spans) kit.add(new THREE.TorusGeometry(span / 2 - 1, 1.1, 5, 12, Math.PI), COL.wall, trs(x + span / 2, -1, 0, 0, 0, 0));
  }
  for (const x of [-length / 2, length / 2]) {
    tower(kit, x, 0, 0, 2.2, 12, COL.roofA, new Rng(Math.round(x)));
  }
  // glowing rail line on the deck
  kit.add(new THREE.BoxGeometry(length, 0.5, 0.8), new THREE.Color(1.6, 1.25, 0.5), trs(0, 1.0, 0));
  return { name: 'bridge', parts: [{ geometry: kit.merge(), material: 'world' }], radius: length / 2, top: 20, bottom: 16 };
}

// ------------------------------------------------------------- catalogue

export interface SceneryCatalogue {
  small: Prefab[];
  medium: Prefab[];
  large: Prefab[];
  grand: Prefab;
  balloon: Prefab;
  bridge: Prefab;
}

export function buildCatalogue(): SceneryCatalogue {
  return {
    small: [
      buildIsland('small-trees-a', { r: 9, depth: 1.1, seed: 1, deco: 'trees', waterfalls: 0 }),
      buildIsland('small-trees-b', { r: 7, depth: 1.3, seed: 2, deco: 'trees', waterfalls: 1 }),
      buildIsland('small-tower', { r: 8, depth: 1.4, seed: 3, deco: 'tower', waterfalls: 0 }),
      buildIsland('rock', { r: 5, depth: 1.6, seed: 4, deco: 'none', waterfalls: 0 }),
    ],
    medium: [
      buildIsland('village-a', { r: 15, depth: 1.1, seed: 5, deco: 'village', waterfalls: 1 }),
      buildIsland('castle-a', { r: 18, depth: 1.2, seed: 6, deco: 'castle', waterfalls: 1 }),
      buildIsland('trees-falls', { r: 14, depth: 1.0, seed: 7, deco: 'trees', waterfalls: 2 }),
    ],
    large: [
      buildIsland('castle-b', { r: 28, depth: 1.15, seed: 8, deco: 'castle', waterfalls: 2 }),
      buildIsland('village-b', { r: 24, depth: 1.25, seed: 9, deco: 'village', waterfalls: 2 }),
    ],
    grand: buildIsland('citadel', { r: 70, depth: 1.1, seed: 10, deco: 'grand', waterfalls: 3 }),
    balloon: buildBalloon(),
    bridge: buildBridge(140),
  };
}
