import * as THREE from 'three';
import { Pool } from '../core/Pool';
import { makeFrame } from '../course/Course';
import type { BoostSpawn, LevelData, ObstacleSpawn } from '../course/LevelData';
import { GeoKit, trs } from '../render/GeoKit';
import { roundRect, textures } from '../render/Textures';

export const BLOCK_W = 1.5;
export const BLOCK_H = 1.5;
const BLOCK_D = 0.9;
const VIEW_AHEAD = 480;
const VIEW_BEHIND = 15;

function frameGeometry(steel: number, trim: number): THREE.BufferGeometry {
  const k = new GeoKit();
  const t = 0.13;
  const w = BLOCK_W / 2;
  const h = BLOCK_H / 2;
  const d = BLOCK_D / 2;
  const col = (_p: THREE.Vector3, n: THREE.Vector3) => new THREE.Color(steel).multiplyScalar(0.75 + 0.35 * Math.max(0, n.y + n.z * 0.4));
  // 4 edges along each axis
  for (const [sy, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    k.add(new THREE.BoxGeometry(BLOCK_W + t, t, t), col, trs(0, sy * h, sz * d));
    k.add(new THREE.BoxGeometry(t, t, BLOCK_D + t), col, trs(sy * w, sz * h, 0));
    k.add(new THREE.BoxGeometry(t, BLOCK_H + t, t), col, trs(sy * w, 0, sz * d));
  }
  // corner bolts
  for (const x of [-w, w]) for (const y of [-h, h]) for (const z of [-d, d]) k.add(new THREE.BoxGeometry(t * 1.5, t * 1.5, t * 1.5), trim, trs(x, y, z));
  // mounting clamp onto the rail
  k.add(new THREE.BoxGeometry(BLOCK_W * 0.7, 0.16, BLOCK_D * 0.8), trim, trs(0, -h - 0.08, 0));
  return k.merge();
}

interface BlockView {
  group: THREE.Group;
  glow: THREE.Sprite;
  panels: THREE.Mesh[];
}

interface Placed<T> {
  spawn: T;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  view: BlockView | null;
  flash: number;
}

function placeOnRail(level: LevelData, s: number, lat: number, h: number, lift: number): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const frame = makeFrame();
  level.course.frame(s, frame);
  const pos = level.course.toWorld(s, lat, h, new THREE.Vector3(), frame).addScaledVector(frame.up, lift);
  const back = frame.forward.clone().negate();
  const right = new THREE.Vector3().crossVectors(frame.up, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
  return { pos, quat };
}

/**
 * Rail-mounted blocks from the reference: red X gates (crash if you hit
 * one) and blue chevron boost blocks (ride through for speed). Views are
 * pooled and only exist near the camera.
 */
export class Blocks {
  readonly group = new THREE.Group();
  private gates: Placed<ObstacleSpawn>[] = [];
  private boosts: Placed<BoostSpawn>[] = [];
  private readonly gatePool: Pool<BlockView>;
  private readonly boostPool: Pool<BlockView>;
  private time = 0;
  finish: THREE.Group | null = null;

  constructor() {
    const tx = textures();
    const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.35 });
    const gateFrame = frameGeometry(0x3b4154, 0x8a3030);
    const boostFrame = frameGeometry(0x39507e, 0x2d7fd8);
    const gatePanelMat = new THREE.MeshBasicMaterial({ map: tx.crossX, color: new THREE.Color(1.5, 1.4, 1.4), side: THREE.DoubleSide });
    const gateSideMat = new THREE.MeshBasicMaterial({ color: 0x5a0d16, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const boostPanelMat = new THREE.MeshBasicMaterial({
      map: tx.chevron,
      color: new THREE.Color(1.3, 1.5, 1.7),
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const boostSideMat = new THREE.MeshBasicMaterial({ color: 0x1b4fb5, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const panelGeo = new THREE.PlaneGeometry(BLOCK_W - 0.1, BLOCK_H - 0.1);
    const sideGeo = new THREE.PlaneGeometry(BLOCK_D - 0.1, BLOCK_H - 0.1);

    const makeView = (frameGeo: THREE.BufferGeometry, panelMat: THREE.Material, sideMat: THREE.Material, glowColor: number): BlockView => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(frameGeo, steelMat));
      const panels: THREE.Mesh[] = [];
      for (const z of [BLOCK_D / 2, -BLOCK_D / 2]) {
        const p = new THREE.Mesh(panelGeo, panelMat);
        p.position.z = z;
        group.add(p);
        panels.push(p);
      }
      for (const x of [BLOCK_W / 2, -BLOCK_W / 2]) {
        const p = new THREE.Mesh(sideGeo, sideMat);
        p.position.x = x;
        p.rotation.y = Math.PI / 2;
        group.add(p);
      }
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tx.glow, color: glowColor, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }),
      );
      glow.scale.set(4.2, 4.2, 1);
      glow.renderOrder = 6;
      group.add(glow);
      return { group, glow, panels };
    };
    this.gatePool = new Pool(
      () => makeView(gateFrame, gatePanelMat, gateSideMat, 0xff3030),
      (v) => this.group.add(v.group),
      (v) => this.group.remove(v.group),
    );
    this.boostPool = new Pool(
      () => makeView(boostFrame, boostPanelMat, boostSideMat, 0x40b8ff),
      (v) => this.group.add(v.group),
      (v) => this.group.remove(v.group),
    );
    this.gatePool.prewarm(16);
    this.boostPool.prewarm(4);
  }

  setLevel(level: LevelData): void {
    for (const g of this.gates) if (g.view) this.gatePool.release(g.view);
    for (const b of this.boosts) if (b.view) this.boostPool.release(b.view);
    const lift = BLOCK_H / 2 + 0.24;
    this.gates = level.obstacles.map((spawn) => ({ spawn, ...placeOnRail(level, spawn.s, spawn.lat, spawn.h, lift), view: null, flash: 0 }));
    this.boosts = level.boosts.map((spawn) => ({ spawn, ...placeOnRail(level, spawn.s, spawn.lat, spawn.h, lift), view: null, flash: 0 }));
    if (this.finish) this.group.remove(this.finish);
    this.finish = buildFinishArch();
    const f = placeOnRail(level, level.finishS, 0, 0, 0);
    this.finish.position.copy(f.pos);
    this.finish.quaternion.copy(f.quat);
    this.group.add(this.finish);
  }

  /** First gate whose volume the rider intersects between sPrev and sNow. */
  hitGate(sPrev: number, sNow: number, lat: number): ObstacleSpawn | null {
    for (const g of this.gates) {
      const sp = g.spawn;
      if (sp.s < sPrev - 0.6) continue;
      if (sp.s > sNow + 0.6) break;
      if (Math.abs(sp.lat - lat) < BLOCK_W / 2 + 0.22) return sp;
    }
    return null;
  }

  /** Boost block ridden through between sPrev and sNow (flashes it). */
  hitBoost(sPrev: number, sNow: number, lat: number): BoostSpawn | null {
    for (const b of this.boosts) {
      const sp = b.spawn;
      if (sp.s < sPrev - 0.4) continue;
      if (sp.s > sNow + 0.4) break;
      if (Math.abs(sp.lat - lat) < BLOCK_W / 2 + 0.1 && b.flash <= 0) {
        b.flash = 1;
        return sp;
      }
    }
    return null;
  }

  reset(): void {
    for (const b of this.boosts) b.flash = 0;
  }

  update(dt: number, camS: number): void {
    this.time += dt;
    const stream = <T extends { s: number }>(list: Placed<T>[], pool: Pool<BlockView>) => {
      for (const p of list) {
        const inView = p.spawn.s > camS - VIEW_BEHIND && p.spawn.s < camS + VIEW_AHEAD;
        if (inView && !p.view) {
          p.view = pool.acquire();
          if (p.view) {
            p.view.group.position.copy(p.pos);
            p.view.group.quaternion.copy(p.quat);
          }
        } else if (!inView && p.view) {
          pool.release(p.view);
          p.view = null;
        }
      }
    };
    stream(this.gates, this.gatePool);
    stream(this.boosts, this.boostPool);
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 6);
    for (const g of this.gates) if (g.view) g.view.glow.material.opacity = 0.55 + 0.35 * pulse;
    for (const b of this.boosts) {
      if (!b.view) continue;
      b.flash = Math.max(0, b.flash - dt * 1.5);
      const f = b.flash;
      b.view.glow.material.opacity = 0.6 + 0.3 * pulse + f;
      b.view.glow.scale.setScalar(4.2 + f * 5);
      for (const p of b.view.panels) (p.material as THREE.MeshBasicMaterial).opacity = 0.92;
    }
  }
}

function buildFinishArch(): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.8, roughness: 0.25, emissive: 0x6a4200, emissiveIntensity: 0.5 });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.35, 12, 48, Math.PI), gold);
  arch.position.y = 0.5;
  g.add(arch);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.8) });
  const inner = new THREE.Mesh(new THREE.TorusGeometry(6.0, 0.08, 8, 48, Math.PI), glowMat);
  inner.position.y = 0.5;
  g.add(inner);
  // Banner.
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, 0, 128);
  bg.addColorStop(0, '#1d3a8a');
  bg.addColorStop(1, '#0b1a48');
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, 500, 116, 26);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffd24a';
  roundRect(ctx, 8, 8, 496, 112, 24);
  ctx.stroke();
  ctx.font = '900 76px Montserrat, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tg = ctx.createLinearGradient(0, 24, 0, 104);
  tg.addColorStop(0, '#fff6b0');
  tg.addColorStop(1, '#ffb300');
  ctx.fillStyle = tg;
  ctx.fillText('FINISH', 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
  banner.position.set(0, 6.2, 0);
  g.add(banner);
  return g;
}
