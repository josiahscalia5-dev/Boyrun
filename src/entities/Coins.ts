import * as THREE from 'three';
import { makeFrame } from '../course/Course';
import type { CollectibleSpawn, LevelData } from '../course/LevelData';
import { BillboardHandle, BillboardLayer } from '../render/Billboards';
import { GeoKit, trs } from '../render/GeoKit';
import { textures } from '../render/Textures';

export const COIN_RADIUS = 0.5;
const VIEW_AHEAD = 420;
const VIEW_BEHIND = 12;
const CAPACITY = 260;

interface CoinState {
  spawn: CollectibleSpawn;
  world: THREE.Vector3;
  basis: THREE.Quaternion;
  collected: boolean;
  glow: BillboardHandle | null;
  phase: number;
}

/** Gold star coin geometry (gold face, orange rim, raised star) like the reference. */
function coinGeometry(): THREE.BufferGeometry {
  const k = new GeoKit();
  const gold = new THREE.Color(0xffc21f);
  const rim = new THREE.Color(0xff9300);
  const face = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.09, 36);
  face.rotateX(Math.PI / 2);
  k.add(face, (_p, n) => (Math.abs(n.z) > 0.6 ? gold : rim));
  for (const z of [0.045, -0.045]) {
    k.add(new THREE.TorusGeometry(COIN_RADIUS * 0.86, 0.028, 8, 36), new THREE.Color(0xffb000), trs(0, 0, z));
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? COIN_RADIUS * 0.62 : COIN_RADIUS * 0.27;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    const star = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
    if (z < 0) star.rotateY(Math.PI);
    star.translate(0, 0, z);
    k.add(star, new THREE.Color(0xffe066));
  }
  return k.merge();
}

/**
 * All coins of the level, drawn with one InstancedMesh plus one glow
 * billboard layer. Only coins near the camera are live.
 */
export class Coins {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private readonly glows: BillboardLayer;
  private coins: CoinState[] = [];
  private cursor = 0;
  private time = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly Y = new THREE.Vector3(0, 1, 0);

  constructor() {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.62,
      roughness: 0.26,
      emissive: new THREE.Color(0x6a3a00),
      emissiveIntensity: 0.55,
    });
    this.mesh = new THREE.InstancedMesh(coinGeometry(), mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.glows = new BillboardLayer(textures().glow, CAPACITY, { additive: true, fadeNear: 2, fogAmount: 1 });
    this.glows.mesh.renderOrder = 5;
    this.group.add(this.glows.mesh);
  }

  setLevel(level: LevelData): void {
    this.glows.clear();
    const frame = makeFrame();
    const basisM = new THREE.Matrix4();
    this.coins = level.collectibles.map((spawn, i) => {
      const world = level.course.toWorld(spawn.s, spawn.lat, spawn.h, new THREE.Vector3(), frame);
      // Face the rider: coin disc normal along the course forward.
      const back = frame.forward.clone().negate();
      const right = new THREE.Vector3().crossVectors(frame.up, back).normalize();
      const up = new THREE.Vector3().crossVectors(back, right).normalize();
      basisM.makeBasis(right, up, back);
      return { spawn, world, basis: new THREE.Quaternion().setFromRotationMatrix(basisM), collected: false, glow: null, phase: i * 0.37 };
    });
    this.cursor = 0;
  }

  /** Reset every coin (restart). */
  reset(): void {
    for (const c of this.coins) {
      c.collected = false;
      if (c.glow) this.glows.remove(c.glow);
      c.glow = null;
    }
    this.cursor = 0;
  }

  /**
   * Collect coins the rider passed through between sPrev and sNow.
   * Returns the collected coins' world positions via callback.
   */
  collect(sPrev: number, sNow: number, lat: number, h: number, onCollect: (world: THREE.Vector3) => void): void {
    for (let i = this.cursor; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (c.spawn.s > sNow + 1.2) break;
      if (c.collected || c.spawn.s < sPrev - 1.2) continue;
      if (Math.abs(c.spawn.lat - lat) < 1.05 && Math.abs(c.spawn.h - (h + 0.8)) < 1.4) {
        c.collected = true;
        if (c.glow) {
          this.glows.remove(c.glow);
          c.glow = null;
        }
        onCollect(c.world);
      }
    }
  }

  update(dt: number, camS: number): void {
    this.time += dt;
    while (this.cursor < this.coins.length && this.coins[this.cursor].spawn.s < camS - VIEW_BEHIND) {
      const c = this.coins[this.cursor];
      if (c.glow) {
        this.glows.remove(c.glow);
        c.glow = null;
      }
      this.cursor++;
    }
    let n = 0;
    for (let i = this.cursor; i < this.coins.length && n < CAPACITY; i++) {
      const c = this.coins[i];
      if (c.spawn.s > camS + VIEW_AHEAD) break;
      if (c.collected) continue;
      const bob = Math.sin(this.time * 3 + c.phase) * 0.08;
      this.spin.setFromAxisAngle(this.Y, Math.sin(this.time * 2.2 + c.phase) * 0.55);
      this.q.copy(c.basis).multiply(this.spin);
      this.v.copy(c.world);
      this.v.y += bob;
      this.m.compose(this.v, this.q, this.one);
      this.mesh.setMatrixAt(n++, this.m);
      const glowA = 0.4 + 0.12 * Math.sin(this.time * 5 + c.phase);
      if (!c.glow) c.glow = this.glows.add(this.v.x, this.v.y, this.v.z, 1.5, 1.5, 1.0, 0.72, 0.2, glowA);
      else this.glows.update(c.glow, this.v.x, this.v.y, this.v.z, 1.5, 1.5, 1.0, 0.72, 0.2, glowA);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Coins remaining ahead of s (for tests / autopilot). */
  ahead(s: number, range: number): CollectibleSpawn[] {
    const out: CollectibleSpawn[] = [];
    for (let i = this.cursor; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (c.spawn.s > s + range) break;
      if (!c.collected && c.spawn.s >= s) out.push(c.spawn);
    }
    return out;
  }

  get total(): number {
    return this.coins.length;
  }
}
