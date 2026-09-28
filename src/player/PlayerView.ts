import * as THREE from 'three';
import { clamp, clamp01 } from '../core/MathUtil';
import { makeFrame } from '../course/Course';
import type { LevelData } from '../course/LevelData';
import { RAIL_TYPES } from '../course/RailTypes';
import type { Particles } from '../render/Particles';
import { textures } from '../render/Textures';
import { BoyModel } from './BoyModel';
import type { Player } from './Player';

const TRAIL_POINTS = 28;
const TRAIL_SECONDS = 0.42;

/**
 * Renders the rider: places the boy on the rail with the rail's frame,
 * drives his procedural pose from the ride state, and draws the light
 * trail, contact glow and soft shadow that tie him to the rail.
 */
export class PlayerView {
  readonly group = new THREE.Group();
  readonly model = new BoyModel();
  private readonly frame = makeFrame();
  private readonly shadow: THREE.Mesh;
  private readonly contact: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly trailCore: THREE.Mesh;
  private readonly trailPos: Float32Array;
  private readonly trailCorePos: Float32Array;
  private readonly history: { s: number; lat: number; h: number; t: number }[] = [];
  private time = 0;
  private sparkAcc = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  readonly worldPos = new THREE.Vector3();

  constructor() {
    const tx = textures();
    this.group.add(this.model.root);

    const shadowTex = tx.softGlow;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.1),
      new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x0a1020, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.renderOrder = 3;
    this.group.add(this.shadow);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 2.0),
      new THREE.MeshBasicMaterial({ map: tx.glow, color: 0x9ff0ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.contact.renderOrder = 7;
    this.group.add(this.contact);

    const makeTrail = (width: number, color: THREE.Color, opacity: number): [THREE.Mesh, Float32Array] => {
      const pos = new Float32Array(TRAIL_POINTS * 2 * 3);
      const uv = new Float32Array(TRAIL_POINTS * 2 * 2);
      const idx: number[] = [];
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const v = i / (TRAIL_POINTS - 1);
        uv.set([0, v, 1, v], i * 4);
        if (i < TRAIL_POINTS - 1) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ map: tx.trail, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      m.frustumCulled = false;
      m.renderOrder = 6;
      m.userData.width = width;
      this.group.add(m);
      return [m, pos];
    };
    [this.trail, this.trailPos] = makeTrail(1.25, new THREE.Color(0.45, 0.8, 1.6), 0.9);
    [this.trailCore, this.trailCorePos] = makeTrail(0.4, new THREE.Color(1.2, 1.3, 1.5), 1);
  }

  resetTrail(): void {
    this.history.length = 0;
  }

  update(dt: number, p: Player, level: LevelData, particles: Particles): void {
    this.time += dt;
    const course = level.course;
    const f = course.frame(p.s, this.frame);
    course.toWorld(p.s, p.lat, p.h, this.worldPos, f);

    // Orientation: rail frame, turned slightly toward the slide direction.
    const back = this.tmp.copy(f.forward).negate();
    const right = this.tmp2.crossVectors(f.up, back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right).normalize();
    this.basis.makeBasis(right, up, back);
    const root = this.model.root;
    root.position.copy(this.worldPos);
    root.quaternion.setFromRotationMatrix(this.basis);
    const yawToward = clamp(-p.latVel / Math.max(8, p.speed), -0.35, 0.35);
    root.rotateY(yawToward);

    // Pose from ride dynamics.
    const g = p.speed * p.speed * f.curvature; // lateral acceleration in curves
    const moving = p.move ? p.move.dir : 0;
    const boost = p.boosting ? 1 : 0;
    const pose = this.model;
    if (p.state === 'crashed') {
      const t = p.crashTime;
      pose.setTarget({ crouch: 0.75, lean: -0.2, roll: 0, armSpread: 0.6, armUp: 0.6, wobble: Math.max(0, 1 - t), boost: 0, shift: 0 });
      // Knocked back off the gate: a hop, then he stumbles down to one side.
      const side = p.lat > 0.1 ? -1 : 1;
      const fall = Math.min(1, t * 2.4);
      root.position.addScaledVector(f.up, Math.sin(Math.min(t, 0.45) * 7) * 0.3 - fall * 0.12);
      root.rotateX(-0.25 * fall);
      root.rotateZ(-side * 0.5 * fall * fall);
    } else if (p.state === 'finished') {
      pose.setTarget({ crouch: 0.1, lean: 0.05, roll: 0, armSpread: 0.6, armUp: 1, wobble: 0, boost: 0, shift: 0, stance: 0.6 });
    } else if (p.state === 'idle') {
      pose.setTarget({ crouch: 0.28, lean: 0.25, roll: 0, armSpread: 0.75, armUp: 0, wobble: 0, boost: 0, shift: 0, stance: 1 });
    } else {
      pose.setTarget({
        crouch: 0.36 + boost * 0.12 + (moving ? 0.1 : 0),
        lean: 0.36 + clamp(p.accel * 0.02, -0.15, 0.2) + boost * 0.12,
        roll: clamp(g * 0.012, -0.35, 0.35),
        armSpread: 1 - boost * 0.3,
        armUp: 0,
        wobble: 0,
        boost,
        shift: moving,
        stance: 1,
      });
    }
    pose.update(dt, p.speed, 0);

    // Contact glow & shadow on the rail surface.
    const railPos = course.toWorld(p.s, p.lat, p.h - (p.move ? Math.sin(Math.PI * p.move.t) * 0.28 : 0), new THREE.Vector3(), f);
    const lift = p.move ? Math.sin(Math.PI * p.move.t) : 0;
    this.placeFlat(this.shadow, railPos, f.up, back, 0.03);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - lift * 0.5) * (p.state === 'crashed' ? 0.5 : 1);
    this.placeFlat(this.contact, railPos, f.up, back, 0.06);
    const railColor = new THREE.Color(RAIL_TYPES[p.rail.type].halo).lerp(new THREE.Color(0xffffff), 0.45);
    const cm = this.contact.material as THREE.MeshBasicMaterial;
    cm.color.copy(railColor);
    cm.opacity = (0.5 + 0.12 * Math.sin(this.time * 24)) * (1 - lift * 0.6) * (p.state === 'crashed' ? 0.2 : 1);

    this.updateTrail(p, level, dt);

    // Sparks from the skates while sliding across or boosting.
    if (p.state === 'riding' && (p.move || p.boosting)) {
      this.sparkAcc += dt * (p.move ? 70 : 35);
      while (this.sparkAcc > 1) {
        this.sparkAcc -= 1;
        const sx = (Math.random() - 0.5) * 0.5;
        particles.emit(
          railPos.x + right.x * sx, railPos.y + 0.08, railPos.z + right.z * sx,
          f.forward.x * -p.speed * 0.25 + (Math.random() - 0.5) * 3, Math.random() * 2.5, f.forward.z * -p.speed * 0.25 + (Math.random() - 0.5) * 3,
          0.6, 1.0, 1.4, 0.16, 0.35, 3, 6,
        );
      }
    }
  }

  private placeFlat(m: THREE.Mesh, p: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3, lift: number): void {
    m.position.copy(p).addScaledVector(up, lift);
    const right = new THREE.Vector3().crossVectors(up, back).normalize();
    // Plane geometry faces +z; map its x->right, y->-back (forward), z->up.
    const fwd = back.clone().negate();
    this.basis.makeBasis(right, fwd, up);
    m.quaternion.setFromRotationMatrix(this.basis);
  }

  private updateTrail(p: Player, level: LevelData, _dt: number): void {
    const now = this.time;
    this.history.unshift({ s: p.s, lat: p.lat, h: p.h - (p.move ? Math.sin(Math.PI * p.move.t) * 0.28 : 0), t: now });
    while (this.history.length > 2 && now - this.history[this.history.length - 1].t > TRAIL_SECONDS) this.history.pop();
    const course = level.course;
    const intensity = p.state === 'riding' ? clamp01(p.speed / 20) : p.state === 'finished' ? clamp01(p.speed / 20) : 0;
    for (const [mesh, arr] of [
      [this.trail, this.trailPos],
      [this.trailCore, this.trailCorePos],
    ] as const) {
      const width = mesh.userData.width as number;
      for (let i = 0; i < TRAIL_POINTS; i++) {
        // Sample history uniformly in time.
        const ht = now - (i / (TRAIL_POINTS - 1)) * TRAIL_SECONDS;
        const h = this.sampleHistory(ht);
        course.frame(h.s, this.frame);
        course.toWorld(h.s, h.lat, h.h + 0.05, this.tmp, this.frame);
        const w = width * (1 - (i / TRAIL_POINTS) * 0.55) * (0.5 + 0.5 * intensity);
        const r = this.frame.right;
        arr[i * 6] = this.tmp.x - r.x * w * 0.5;
        arr[i * 6 + 1] = this.tmp.y - r.y * w * 0.5;
        arr[i * 6 + 2] = this.tmp.z - r.z * w * 0.5;
        arr[i * 6 + 3] = this.tmp.x + r.x * w * 0.5;
        arr[i * 6 + 4] = this.tmp.y + r.y * w * 0.5;
        arr[i * 6 + 5] = this.tmp.z + r.z * w * 0.5;
      }
      mesh.geometry.attributes.position.needsUpdate = true;
      (mesh.material as THREE.MeshBasicMaterial).opacity = intensity;
    }
  }

  private sampleHistory(t: number): { s: number; lat: number; h: number } {
    const hist = this.history;
    for (let i = 0; i < hist.length - 1; i++) {
      const a = hist[i];
      const b = hist[i + 1];
      if (t <= a.t && t >= b.t) {
        const k = a.t === b.t ? 0 : (a.t - t) / (a.t - b.t);
        return { s: a.s + (b.s - a.s) * k, lat: a.lat + (b.lat - a.lat) * k, h: a.h + (b.h - a.h) * k };
      }
    }
    const last = hist[hist.length - 1];
    // Extrapolate backwards along the rail at current speed for a full-length streak.
    const dtBack = last.t - t;
    return { s: last.s - dtBack * 25, lat: last.lat, h: last.h };
  }
}
