import * as THREE from 'three';
import { clamp, damp, DEG, Spring1 } from '../core/MathUtil';
import { makeFrame } from '../course/Course';
import type { LevelData } from '../course/LevelData';
import type { Player } from '../player/Player';

/**
 * Horizontal field of view we try to keep on every portrait phone, so the
 * rails fill the width the same way on tall and short screens. Vertical
 * FOV grows on taller screens (more sky), within limits.
 */
const TARGET_HFOV = 50 * DEG;
const MIN_VFOV = 56;
const MAX_VFOV = 84;

export function verticalFov(aspect: number): number {
  const v = (2 * Math.atan(Math.tan(TARGET_HFOV / 2) / aspect)) / DEG;
  return clamp(v, MIN_VFOV, MAX_VFOV);
}

interface Offsets {
  back: number;
  up: number;
  ahead: number;
  lookUp: number;
}

const RIDE: Offsets = { back: 3.9, up: 2.35, ahead: 7.5, lookUp: 0.75 };

/**
 * Third-person chase camera. Its anchor lives in course space (behind the
 * rider along the rail) so it follows curves and hills naturally; springs
 * smooth everything so it never snaps.
 */
export class CameraRig {
  private readonly frame = makeFrame();
  private readonly camPos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly springs = {
    px: new Spring1(), py: new Spring1(), pz: new Spring1(),
    lx: new Spring1(), ly: new Spring1(), lz: new Spring1(),
  };
  private readonly latSpring = new Spring1();
  private roll = 0;
  private fovBonus = 0;
  private shake = 0;
  private time = 0;
  /** 0 = title orbit, 1 = ride camera. */
  private rideBlend = 0;
  mode: 'title' | 'ride' = 'title';
  private initialized = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  snap(): void {
    this.initialized = false;
  }

  update(dt: number, p: Player, level: LevelData): void {
    this.time += dt;
    const course = level.course;
    this.rideBlend = damp(this.rideBlend, this.mode === 'ride' ? 1 : 0, 2.2, dt);

    const lat = this.latSpring.update(p.lat, 0.16, dt);
    const o = RIDE;
    // Ride camera: behind and above the rider along the rail.
    const camS = p.s - o.back;
    course.toWorld(camS, lat * 0.82, p.h + o.up, this.desiredPos, this.frame);
    course.toWorld(p.s + o.ahead, lat * 0.62, p.h + o.lookUp, this.desiredLook, this.frame);

    // Title camera: slow orbit showing the hero from the side/front.
    if (this.rideBlend < 0.999) {
      course.frame(p.s, this.frame);
      const a = 2.5 + Math.sin(this.time * 0.25) * 0.35;
      const center = course.toWorld(p.s, p.lat, p.h + 0.95, new THREE.Vector3(), this.frame);
      const orbit = center
        .clone()
        .addScaledVector(this.frame.forward, Math.cos(a) * 3.3)
        .addScaledVector(this.frame.right, Math.sin(a) * 3.3)
        .addScaledVector(this.frame.up, 0.55);
      this.desiredPos.lerpVectors(orbit, this.desiredPos, this.rideBlend);
      this.desiredLook.lerpVectors(center.addScaledVector(this.frame.up, -0.05), this.desiredLook, this.rideBlend);
    }

    const sp = this.springs;
    if (!this.initialized) {
      sp.px.reset(this.desiredPos.x);
      sp.py.reset(this.desiredPos.y);
      sp.pz.reset(this.desiredPos.z);
      sp.lx.reset(this.desiredLook.x);
      sp.ly.reset(this.desiredLook.y);
      sp.lz.reset(this.desiredLook.z);
      this.latSpring.reset(p.lat);
      this.initialized = true;
    }
    const posT = 0.07;
    const lookT = 0.05;
    this.camPos.set(sp.px.update(this.desiredPos.x, posT, dt), sp.py.update(this.desiredPos.y, posT, dt), sp.pz.update(this.desiredPos.z, posT, dt));
    this.look.set(sp.lx.update(this.desiredLook.x, lookT, dt), sp.ly.update(this.desiredLook.y, lookT, dt), sp.lz.update(this.desiredLook.z, lookT, dt));

    // Shake (crash / landing), decays quickly.
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.35;
      this.camPos.x += (Math.random() - 0.5) * s;
      this.camPos.y += (Math.random() - 0.5) * s;
      this.camPos.z += (Math.random() - 0.5) * s;
    }

    // Subtle tilt: into curves and toward rail changes.
    course.frame(p.s, this.frame);
    const tiltTarget = clamp(-p.latVel * 0.012, -0.08, 0.08) - this.frame.bank * 0.35;
    this.roll = damp(this.roll, tiltTarget * this.rideBlend, 6, dt);
    const up = this.frame.up.clone().applyAxisAngle(this.frame.forward, this.roll);

    this.camera.position.copy(this.camPos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.look);

    // Field of view: aspect-aware base, widened by speed and boosts.
    const base = verticalFov(this.camera.aspect);
    const speedBonus = clamp((p.speed - level.baseSpeed) * 0.35, -2, 6) + (p.boosting ? 5 : 0);
    this.fovBonus = damp(this.fovBonus, speedBonus * this.rideBlend, 3, dt);
    const fov = base + this.fovBonus;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
