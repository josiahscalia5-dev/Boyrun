import * as THREE from 'three';
import { Rng } from '../core/MathUtil';
import type { LevelData } from '../course/LevelData';
import { BillboardHandle, BillboardLayer } from './Billboards';
import { buildCatalogue, Prefab, SceneryCatalogue } from './Prefabs';
import { textures } from './Textures';

interface Slot {
  batch: PrefabBatch;
  index: number;
}

/**
 * One InstancedMesh per prefab part. Instances are packed densely using
 * swap-remove so released props cost nothing to draw.
 */
class PrefabBatch {
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly slots: Slot[] = [];
  private count = 0;

  constructor(readonly prefab: Prefab, readonly capacity: number, materials: Record<'world' | 'water', THREE.Material>, parent: THREE.Object3D) {
    for (const part of prefab.parts) {
      const m = new THREE.InstancedMesh(part.geometry, materials[part.material], capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      if (part.material === 'water') m.renderOrder = 2;
      parent.add(m);
      this.meshes.push(m);
    }
  }

  acquire(matrix: THREE.Matrix4): Slot | null {
    if (this.count >= this.capacity) return null;
    const i = this.count++;
    const slot: Slot = { batch: this, index: i };
    this.slots[i] = slot;
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.count = this.count;
      m.instanceMatrix.needsUpdate = true;
    }
    return slot;
  }

  release(slot: Slot): void {
    const last = this.count - 1;
    const i = slot.index;
    if (i !== last) {
      const moved = this.slots[last];
      for (const m of this.meshes) {
        m.getMatrixAt(last, tmpM);
        m.setMatrixAt(i, tmpM);
      }
      moved.index = i;
      this.slots[i] = moved;
    }
    slot.index = -1;
    this.count--;
    for (const m of this.meshes) {
      m.count = this.count;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  get live(): number {
    return this.count;
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Cell {
  slots: Slot[];
  clouds: BillboardHandle[];
}

const CELL = 40;
const VIEW_AHEAD = 1000;
const VIEW_BEHIND = 80;

/**
 * Streams the sky world along the course: floating islands, castles,
 * villages, waterfalls, balloons and clouds. Placement per cell is
 * deterministic, so the same level always looks the same.
 */
export class Scenery {
  readonly group = new THREE.Group();
  readonly backdrop = new THREE.Group();
  readonly catalogue: SceneryCatalogue;
  readonly worldMaterial: THREE.MeshStandardMaterial;
  readonly waterMaterial: THREE.MeshBasicMaterial;
  private readonly batches = new Map<Prefab, PrefabBatch>();
  private readonly cells = new Map<number, Cell>();
  private readonly clouds: BillboardLayer;
  private level: LevelData | null = null;
  private readonly waterTex: THREE.Texture;
  private time = 0;

  constructor() {
    const tx = textures();
    this.catalogue = buildCatalogue();
    this.worldMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
    this.waterTex = tx.waterfall.clone();
    this.waterTex.needsUpdate = true;
    this.waterMaterial = new THREE.MeshBasicMaterial({
      map: this.waterTex,
      color: 0xe6f7ff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mats = { world: this.worldMaterial, water: this.waterMaterial };
    const cat = this.catalogue;
    for (const p of cat.small) this.batches.set(p, new PrefabBatch(p, 40, mats, this.group));
    for (const p of cat.medium) this.batches.set(p, new PrefabBatch(p, 28, mats, this.group));
    for (const p of cat.large) this.batches.set(p, new PrefabBatch(p, 18, mats, this.group));
    this.batches.set(cat.balloon, new PrefabBatch(cat.balloon, 8, mats, this.group));

    this.clouds = new BillboardLayer(tx.cloudAtlas, 420, { tiles: 3, fadeNear: 30, fogAmount: 0.7 });
    this.clouds.mesh.renderOrder = 3;
    this.group.add(this.clouds.mesh);
    this.buildBackdrop(mats);
  }

  setLevel(level: LevelData): void {
    for (const key of [...this.cells.keys()]) this.dropCell(key);
    this.level = level;
  }

  /** Far-away scenery rendered behind everything (skybox-like parallax). */
  private buildBackdrop(mats: Record<'world' | 'water', THREE.Material>): void {
    const cat = this.catalogue;
    const rng = new Rng(4242);
    const place = (p: Prefab, x: number, y: number, z: number, scale: number, rotY: number) => {
      for (const part of p.parts) {
        const m = new THREE.Mesh(part.geometry, mats[part.material]);
        m.position.set(x, y, z);
        m.scale.setScalar(scale);
        m.rotation.y = rotY;
        if (part.material === 'water') m.renderOrder = 2;
        this.backdrop.add(m);
      }
    };
    // The grand citadel dominating the horizon ahead (reference composition).
    place(cat.grand, 10, 55, -560, 1.35, 0.3);
    // A ring of distant castle islands at many heights.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng.range(-0.08, 0.08);
      const dist = rng.range(420, 640);
      const x = Math.sin(a) * dist;
      const z = -Math.cos(a) * dist;
      if (Math.abs(a) < 0.18 || Math.abs(a - Math.PI * 2) < 0.18) continue; // keep the citadel clear
      const p = rng.pick([...cat.large, ...cat.medium]);
      place(p, x, rng.range(-60, 140), z, rng.range(1.2, 2.4), rng.range(0, 6.28));
    }
    // Small islands scattered high up (fills the upper sky like the reference).
    for (let i = 0; i < 30; i++) {
      const a = rng.range(-1.2, 1.2);
      const dist = rng.range(300, 520);
      place(rng.pick(cat.small), Math.sin(a) * dist, rng.range(40, 190), -Math.cos(a) * dist, rng.range(1.4, 2.6), rng.range(0, 6.28));
    }
    // Distant sky bridges.
    for (const [x, y, z, ry] of [
      [-230, 20, -420, 0.5],
      [260, 45, -380, -0.4],
      [-360, 70, -180, 1.2],
    ]) {
      place(cat.bridge, x, y, z, 1.2, ry);
    }
    // Hot-air balloons.
    place(cat.balloon, -110, 70, -300, 2.2, 0);
    place(cat.balloon, 160, 110, -420, 2.6, 1);
  }

  private dropCell(key: number): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    for (const s of cell.slots) s.batch.release(s);
    for (const c of cell.clouds) this.clouds.remove(c);
    this.cells.delete(key);
  }

  /** Is a prop at (s, lat, h) with footprint r clear of every rail? */
  private clearOfRails(s: number, lat: number, h: number, r: number, top: number): boolean {
    const lvl = this.level!;
    for (const rail of lvl.network.railsInRange(s - r, s + r, railsTmp)) {
      const d = Math.abs(rail.lat.at(s) - lat);
      if (d < r + 9) {
        // Allowed only when entirely well below the rails.
        if (h + top > rail.h.at(s) - 12) return false;
      }
    }
    return true;
  }

  private buildCell(k: number): void {
    const lvl = this.level!;
    const rng = new Rng(k * 977 + lvl.seed * 131 + 17);
    const cell: Cell = { slots: [], clouds: [] };
    const cat = this.catalogue;
    const s0 = k * CELL;

    const put = (p: Prefab, s: number, lat: number, h: number, scale: number) => {
      if (!this.clearOfRails(s, lat, h, p.radius * scale, p.top * scale)) return;
      const batch = this.batches.get(p)!;
      lvl.course.toWorld(s, lat, h, tmpV);
      tmpQ.setFromAxisAngle(UP, rng.range(0, Math.PI * 2));
      tmpS.setScalar(scale);
      tmpM.compose(tmpV, tmpQ, tmpS);
      const slot = batch.acquire(tmpM);
      if (slot) cell.slots.push(slot);
    };

    for (const side of [-1, 1]) {
      // Near small islands.
      for (let i = 0; i < 2; i++) {
        if (rng.chance(0.75)) put(rng.pick(cat.small), s0 + rng.range(0, CELL), side * rng.range(16, 60), rng.range(-34, 14), rng.range(0.7, 1.3));
      }
      // Mid-distance villages and castles.
      if (rng.chance(0.8)) put(rng.pick(cat.medium), s0 + rng.range(0, CELL), side * rng.range(48, 150), rng.range(-55, 30), rng.range(0.8, 1.4));
      // Large castle islands further out.
      if (rng.chance(0.42)) put(rng.pick(cat.large), s0 + rng.range(0, CELL), side * rng.range(130, 330), rng.range(-45, 80), rng.range(0.9, 1.5));
      if (rng.chance(0.04)) put(cat.balloon, s0 + rng.range(0, CELL), side * rng.range(30, 110), rng.range(12, 40), rng.range(0.9, 1.3));

      // Clouds: a layer below the rails plus some drifting at rail height.
      for (let i = 0; i < 4; i++) {
        const below = rng.chance(0.55);
        const lat = side * rng.range(below ? 0 : 26, below ? 220 : 260);
        const h = below ? rng.range(-75, -28) : rng.range(-30, 45);
        const w = rng.range(40, 110) * (below ? 1.3 : 0.9);
        lvl.course.toWorld(s0 + rng.range(0, CELL), lat, h, tmpV);
        const shade = rng.range(0.94, 1.0);
        const hd = this.clouds.add(tmpV.x, tmpV.y, tmpV.z, w, w * 0.5, shade, shade, 1, rng.range(0.75, 0.95), rng.int(0, 2));
        if (hd) cell.clouds.push(hd);
      }
    }
    this.cells.set(k, cell);
  }

  update(dt: number, camS: number, camera: THREE.Camera): void {
    this.time += dt;
    this.waterTex.offset.y = -this.time * 0.9;
    this.backdrop.position.copy(camera.position);
    if (!this.level) return;
    const k0 = Math.floor((camS - VIEW_BEHIND) / CELL);
    const k1 = Math.floor((camS + VIEW_AHEAD) / CELL);
    for (const key of this.cells.keys()) if (key < k0 || key > k1) this.dropCell(key);
    // Build at most two new cells per frame to avoid hitches.
    let built = 0;
    for (let k = k0; k <= k1 && built < 2; k++) {
      if (!this.cells.has(k)) {
        this.buildCell(k);
        built++;
      }
    }
  }

  /** Build every cell in view immediately (level start / respawn). */
  prime(camS: number): void {
    const k0 = Math.floor((camS - VIEW_BEHIND) / CELL);
    const k1 = Math.floor((camS + VIEW_AHEAD) / CELL);
    for (let k = k0; k <= k1; k++) if (!this.cells.has(k)) this.buildCell(k);
  }

  get stats(): { props: number; clouds: number } {
    let props = 0;
    for (const b of this.batches.values()) props += b.live;
    return { props, clouds: this.clouds.liveCount };
  }
}

const railsTmp: import('../course/RailNetwork').RailDef[] = [];

// ------------------------------------------------------------- cloud sea

const seaVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const seaFrag = /* glsl */ `
uniform vec3 uCam;
uniform vec3 uHorizon;
uniform vec3 uShadow;
uniform float uTime;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec2 p = vWorld.xz * 0.0045 + vec2(uTime * 0.004, 0.0);
  float n = fbm(p);
  float puffs = smoothstep(0.35, 0.75, n);
  vec3 col = mix(uShadow, vec3(1.0), puffs);
  float dist = length(vWorld.xz - uCam.xz);
  col = mix(col, uHorizon, smoothstep(250.0, 1400.0, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function createCloudSea(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    vertexShader: seaVert,
    fragmentShader: seaFrag,
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uHorizon: { value: new THREE.Color(0xdfeeff) },
      uShadow: { value: new THREE.Color(0xb7cdee) },
      uTime: { value: 0 },
    },
    fog: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  return mesh;
}
