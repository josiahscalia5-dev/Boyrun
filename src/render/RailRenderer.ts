import * as THREE from 'three';
import { Pool } from '../core/Pool';
import { makeFrame } from '../course/Course';
import type { LevelData } from '../course/LevelData';
import type { RailDef } from '../course/RailNetwork';
import { RAIL_TYPES } from '../course/RailTypes';
import { textures } from './Textures';

const CHUNK = 48; // metres per chunk
const STEP = 1; // metres between cross-sections
const MAX_SAMPLES = CHUNK / STEP + 1;
const VIEW_AHEAD = 620;
const VIEW_BEHIND = 40;
const BRACKET_EVERY = 6;

/**
 * Cross-section of a sky rail (x = lateral, y = up). The top is a glowing
 * energy channel with raised lips; below is a steel beam with clamps.
 */
// [x, y, nx, ny, u, colourMix (0 edge .. 1 core)]
const GLOW: number[][] = [
  [-0.62, 0.0, -0.9, 0.44, 0.0, 0],
  [-0.56, 0.12, -0.4, 0.92, 0.07, 0.05],
  [-0.45, 0.07, 0.15, 0.99, 0.18, 0.35],
  [-0.2, 0.02, 0.05, 1, 0.38, 0.9],
  [0.2, 0.02, -0.05, 1, 0.62, 0.9],
  [0.45, 0.07, -0.15, 0.99, 0.82, 0.35],
  [0.56, 0.12, 0.4, 0.92, 0.93, 0.05],
  [0.62, 0.0, 0.9, 0.44, 1.0, 0],
];
const METAL: number[][] = [
  [0.62, 0.0, 0.95, 0.3],
  [0.5, -0.2, 0.8, -0.6],
  [0.28, -0.34, 0.3, -0.95],
  [-0.28, -0.34, -0.3, -0.95],
  [-0.5, -0.2, -0.8, -0.6],
  [-0.62, 0.0, -0.95, 0.3],
];
// Bracket box (clamp under the rail).
const BR_W = 0.8;
const BR_H = 0.34;
const BR_D = 0.38;
const BR_Y = -0.42;
const BRACKETS_PER_CHUNK = Math.ceil(CHUNK / BRACKET_EVERY) + 1;

const GLOW_VERTS = MAX_SAMPLES * GLOW.length;
const METAL_VERTS = MAX_SAMPLES * METAL.length + BRACKETS_PER_CHUNK * 24;
const HALO_VERTS = MAX_SAMPLES * 2;

class RailChunk {
  readonly body: THREE.Mesh;
  readonly halo: THREE.Mesh;
  readonly bodyGeo = new THREE.BufferGeometry();
  readonly haloGeo = new THREE.BufferGeometry();
  key = '';
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly uv: Float32Array;
  private readonly col: Float32Array;
  private readonly idx: Uint32Array;
  private readonly hPos: Float32Array;
  private readonly hUv: Float32Array;
  private readonly hCol: Float32Array;
  private readonly hIdx: Uint32Array;

  constructor(glowMat: THREE.Material, metalMat: THREE.Material, haloMat: THREE.Material) {
    const total = GLOW_VERTS + METAL_VERTS;
    this.pos = new Float32Array(total * 3);
    this.nor = new Float32Array(total * 3);
    this.uv = new Float32Array(total * 2);
    this.col = new Float32Array(total * 3);
    this.idx = new Uint32Array((MAX_SAMPLES * (GLOW.length + METAL.length)) * 6 + BRACKETS_PER_CHUNK * 36);
    this.bodyGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.bodyGeo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    this.bodyGeo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.bodyGeo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.bodyGeo.setIndex(new THREE.BufferAttribute(this.idx, 1));
    this.body = new THREE.Mesh(this.bodyGeo, [glowMat, metalMat]);
    this.body.frustumCulled = false;

    this.hPos = new Float32Array(HALO_VERTS * 3);
    this.hUv = new Float32Array(HALO_VERTS * 2);
    this.hCol = new Float32Array(HALO_VERTS * 3);
    this.hIdx = new Uint32Array(MAX_SAMPLES * 6);
    this.haloGeo.setAttribute('position', new THREE.BufferAttribute(this.hPos, 3));
    this.haloGeo.setAttribute('uv', new THREE.BufferAttribute(this.hUv, 2));
    this.haloGeo.setAttribute('color', new THREE.BufferAttribute(this.hCol, 3));
    this.haloGeo.setIndex(new THREE.BufferAttribute(this.hIdx, 1));
    this.halo = new THREE.Mesh(this.haloGeo, haloMat);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 4;
  }

  build(level: LevelData, rail: RailDef, s0: number, s1: number): void {
    const course = level.course;
    const type = RAIL_TYPES[rail.type];
    const edge = new THREE.Color(type.edge);
    const core = new THREE.Color(type.core);
    const haloC = new THREE.Color(type.halo);
    const W = type.width;
    const metalTop = new THREE.Color(0x6e7890);
    const metalBot = new THREE.Color(0x2c3246);
    const c = new THREE.Color();
    const frame = makeFrame();
    const p = new THREE.Vector3();
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    const T = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3();
    const n = new THREE.Vector3();

    const samples: number[] = [];
    for (let s = s0; s < s1 - 1e-4; s += STEP) samples.push(s);
    samples.push(s1);
    const ns = samples.length;

    let v = 0;
    let hv = 0;
    const frames: { p: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; T: THREE.Vector3 }[] = [];
    for (let i = 0; i < ns; i++) {
      const s = samples[i];
      course.toWorld(s, rail.lat.at(s), rail.h.at(s), p, frame);
      course.toWorld(s + 0.5, rail.lat.at(s + 0.5), rail.h.at(s + 0.5), pb);
      course.toWorld(s - 0.5, rail.lat.at(s - 0.5), rail.h.at(s - 0.5), pa);
      T.subVectors(pb, pa).normalize();
      course.frame(s, frame);
      side.crossVectors(T, frame.up).normalize();
      up.crossVectors(side, T).normalize();
      frames.push({ p: p.clone(), side: side.clone(), up: up.clone(), T: T.clone() });
    }

    // Glow channel.
    for (let i = 0; i < ns; i++) {
      const f = frames[i];
      for (const [x0, y, nx, ny, u, mix] of GLOW) {
        const x = x0 * W;
        this.pos[v * 3] = f.p.x + f.side.x * x + f.up.x * y;
        this.pos[v * 3 + 1] = f.p.y + f.side.y * x + f.up.y * y;
        this.pos[v * 3 + 2] = f.p.z + f.side.z * x + f.up.z * y;
        n.copy(f.side).multiplyScalar(nx).addScaledVector(f.up, ny).normalize();
        this.nor[v * 3] = n.x;
        this.nor[v * 3 + 1] = n.y;
        this.nor[v * 3 + 2] = n.z;
        this.uv[v * 2] = u;
        this.uv[v * 2 + 1] = samples[i] / 7;
        c.copy(edge).lerp(core, mix);
        this.col[v * 3] = c.r;
        this.col[v * 3 + 1] = c.g;
        this.col[v * 3 + 2] = c.b;
        v++;
      }
    }
    const glowVerts = v;
    // Metal underbody.
    for (let i = 0; i < ns; i++) {
      const f = frames[i];
      for (const [x0, y, nx, ny] of METAL) {
        const x = x0 * W;
        this.pos[v * 3] = f.p.x + f.side.x * x + f.up.x * y;
        this.pos[v * 3 + 1] = f.p.y + f.side.y * x + f.up.y * y;
        this.pos[v * 3 + 2] = f.p.z + f.side.z * x + f.up.z * y;
        n.copy(f.side).multiplyScalar(nx).addScaledVector(f.up, ny).normalize();
        this.nor[v * 3] = n.x;
        this.nor[v * 3 + 1] = n.y;
        this.nor[v * 3 + 2] = n.z;
        this.uv[v * 2] = 0;
        this.uv[v * 2 + 1] = 0;
        c.copy(metalBot).lerp(metalTop, Math.max(0, ny * 0.5 + 0.5));
        this.col[v * 3] = c.r;
        this.col[v * 3 + 1] = c.g;
        this.col[v * 3 + 2] = c.b;
        v++;
      }
    }
    const metalRingStart = glowVerts;

    let ii = 0;
    // Glow indices (group 0).
    for (let i = 0; i < ns - 1; i++) {
      for (let k = 0; k < GLOW.length - 1; k++) {
        const a = i * GLOW.length + k;
        const b = a + GLOW.length;
        this.idx[ii++] = a;
        this.idx[ii++] = a + 1;
        this.idx[ii++] = b;
        this.idx[ii++] = a + 1;
        this.idx[ii++] = b + 1;
        this.idx[ii++] = b;
      }
    }
    const glowIdxCount = ii;
    // Metal indices (group 1).
    for (let i = 0; i < ns - 1; i++) {
      for (let k = 0; k < METAL.length - 1; k++) {
        const a = metalRingStart + i * METAL.length + k;
        const b = a + METAL.length;
        this.idx[ii++] = a;
        this.idx[ii++] = a + 1;
        this.idx[ii++] = b;
        this.idx[ii++] = a + 1;
        this.idx[ii++] = b + 1;
        this.idx[ii++] = b;
      }
    }
    // Brackets every BRACKET_EVERY metres (world-aligned so chunks line up).
    const firstB = Math.ceil(s0 / BRACKET_EVERY) * BRACKET_EVERY;
    for (let bs = firstB; bs <= s1 - 0.5; bs += BRACKET_EVERY) {
      const i = Math.min(ns - 1, Math.max(0, Math.round((bs - s0) / STEP)));
      const f = frames[i];
      const base = v;
      // 6 faces x 4 verts
      const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, number, number][] = [
        [f.side, f.up, f.T, 1, BR_W / 2],
        [f.side, f.up, f.T, -1, BR_W / 2],
        [f.up, f.T, f.side, 1, BR_H / 2],
        [f.up, f.T, f.side, -1, BR_H / 2],
        [f.T, f.side, f.up, 1, BR_D / 2],
        [f.T, f.side, f.up, -1, BR_D / 2],
      ];
      const halfs = new Map<THREE.Vector3, number>([
        [f.side, BR_W / 2],
        [f.up, BR_H / 2],
        [f.T, BR_D / 2],
      ]);
      for (const [nAxis, uAxis, vAxis, sign, dist] of faces) {
        const hu = halfs.get(uAxis)!;
        const hvv = halfs.get(vAxis)!;
        const shade = nAxis === f.up ? (sign > 0 ? 1 : 0.35) : 0.7;
        for (const [su, sv] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const px = f.p.x + f.up.x * BR_Y + nAxis.x * dist * sign + uAxis.x * hu * su + vAxis.x * hvv * sv;
          const py = f.p.y + f.up.y * BR_Y + nAxis.y * dist * sign + uAxis.y * hu * su + vAxis.y * hvv * sv;
          const pz = f.p.z + f.up.z * BR_Y + nAxis.z * dist * sign + uAxis.z * hu * su + vAxis.z * hvv * sv;
          this.pos[v * 3] = px;
          this.pos[v * 3 + 1] = py;
          this.pos[v * 3 + 2] = pz;
          this.nor[v * 3] = nAxis.x * sign;
          this.nor[v * 3 + 1] = nAxis.y * sign;
          this.nor[v * 3 + 2] = nAxis.z * sign;
          this.uv[v * 2] = 0;
          this.uv[v * 2 + 1] = 0;
          this.col[v * 3] = 0.52 * shade + 0.1;
          this.col[v * 3 + 1] = 0.56 * shade + 0.1;
          this.col[v * 3 + 2] = 0.64 * shade + 0.12;
          v++;
        }
      }
      faces.forEach(([nAxis, uAxis, vAxis, sign], face) => {
        const q = base + face * 4;
        // Wind each face so its geometric normal matches the outward normal.
        const outward = n.crossVectors(uAxis, vAxis).dot(nAxis) * sign > 0;
        if (outward) {
          this.idx[ii++] = q;
          this.idx[ii++] = q + 1;
          this.idx[ii++] = q + 2;
          this.idx[ii++] = q;
          this.idx[ii++] = q + 2;
          this.idx[ii++] = q + 3;
        } else {
          this.idx[ii++] = q;
          this.idx[ii++] = q + 2;
          this.idx[ii++] = q + 1;
          this.idx[ii++] = q;
          this.idx[ii++] = q + 3;
          this.idx[ii++] = q + 2;
        }
      });
    }

    this.bodyGeo.clearGroups();
    this.bodyGeo.addGroup(0, glowIdxCount, 0);
    this.bodyGeo.addGroup(glowIdxCount, ii - glowIdxCount, 1);
    this.bodyGeo.setDrawRange(0, ii);
    for (const name of ['position', 'normal', 'uv', 'color'] as const) this.bodyGeo.attributes[name].needsUpdate = true;
    this.bodyGeo.index!.needsUpdate = true;
    this.bodyGeo.computeBoundingSphere();

    // Halo ribbon slightly below the channel so the rail occludes its centre.
    const HW = 1.9 * W;
    for (let i = 0; i < ns; i++) {
      const f = frames[i];
      for (const sd of [-1, 1]) {
        this.hPos[hv * 3] = f.p.x + f.side.x * HW * sd - f.up.x * 0.06;
        this.hPos[hv * 3 + 1] = f.p.y + f.side.y * HW * sd - f.up.y * 0.06;
        this.hPos[hv * 3 + 2] = f.p.z + f.side.z * HW * sd - f.up.z * 0.06;
        this.hUv[hv * 2] = sd < 0 ? 0 : 1;
        this.hUv[hv * 2 + 1] = 0;
        this.hCol[hv * 3] = haloC.r;
        this.hCol[hv * 3 + 1] = haloC.g;
        this.hCol[hv * 3 + 2] = haloC.b;
        hv++;
      }
    }
    let hi = 0;
    for (let i = 0; i < ns - 1; i++) {
      const a = i * 2;
      this.hIdx[hi++] = a;
      this.hIdx[hi++] = a + 2;
      this.hIdx[hi++] = a + 1;
      this.hIdx[hi++] = a + 1;
      this.hIdx[hi++] = a + 2;
      this.hIdx[hi++] = a + 3;
    }
    this.haloGeo.setDrawRange(0, hi);
    for (const name of ['position', 'uv', 'color'] as const) this.haloGeo.attributes[name].needsUpdate = true;
    this.haloGeo.index!.needsUpdate = true;
  }
}

/**
 * Streams rail geometry in fixed-length chunks around the camera. Chunk
 * meshes are pooled and their buffers rewritten in place, so riding a
 * level never allocates GPU buffers after warm-up.
 */
export class RailRenderer {
  readonly group = new THREE.Group();
  readonly glowMaterial: THREE.MeshBasicMaterial;
  readonly metalMaterial: THREE.MeshStandardMaterial;
  readonly haloMaterial: THREE.MeshBasicMaterial;
  private readonly pool: Pool<RailChunk>;
  private readonly live = new Map<string, RailChunk>();
  private level: LevelData | null = null;
  private readonly railsTmp: RailDef[] = [];
  private flow = 0;

  constructor() {
    const tx = textures();
    this.glowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      map: tx.railTop,
      color: new THREE.Color(1.35, 1.35, 1.35),
    });
    this.metalMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.7,
      roughness: 0.38,
    });
    this.haloMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      map: tx.railHalo,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.pool = new Pool<RailChunk>(
      () => {
        const c = new RailChunk(this.glowMaterial, this.metalMaterial, this.haloMaterial);
        return c;
      },
      (c) => {
        this.group.add(c.body, c.halo);
      },
      (c) => {
        this.group.remove(c.body, c.halo);
        c.key = '';
      },
    );
    this.pool.prewarm(48);
  }

  setLevel(level: LevelData): void {
    for (const c of this.live.values()) this.pool.release(c);
    this.live.clear();
    this.level = level;
  }

  update(dt: number, camS: number, maxBuilds = 4): void {
    // Energy flowing along the rails.
    this.flow += dt * 0.6;
    this.glowMaterial.map!.offset.y = -this.flow;
    if (!this.level) return;
    const a = camS - VIEW_BEHIND;
    const b = camS + VIEW_AHEAD;
    const needed = new Set<string>();
    let builds = 0;
    for (const rail of this.level.network.railsInRange(a, b, this.railsTmp)) {
      const k0 = Math.floor(Math.max(a, rail.s0) / CHUNK);
      const k1 = Math.floor(Math.min(b, rail.s1) / CHUNK);
      for (let k = k0; k <= k1; k++) {
        const key = `${rail.id}:${k}`;
        needed.add(key);
        if (this.live.has(key) || builds >= maxBuilds) continue;
        const cs0 = Math.max(rail.s0, k * CHUNK);
        const cs1 = Math.min(rail.s1, (k + 1) * CHUNK);
        if (cs1 - cs0 < 0.5) continue;
        const chunk = this.pool.acquire();
        if (!chunk) continue;
        chunk.key = key;
        chunk.build(this.level, rail, cs0, cs1);
        this.live.set(key, chunk);
        builds++;
      }
    }
    for (const [key, chunk] of this.live) {
      if (!needed.has(key)) {
        this.pool.release(chunk);
        this.live.delete(key);
      }
    }
  }

  /** Build everything in view right away (level start). */
  prime(camS: number): void {
    this.update(0, camS, 1000);
  }

  get liveChunks(): number {
    return this.live.size;
  }
}
