import * as THREE from 'three';
import { clamp, damp } from '../core/MathUtil';
import { GeoKit, trs } from '../render/GeoKit';
import { textures } from '../render/Textures';

/** Outfit palette taken from the reference art. */
const C = {
  skin: 0xf2c29e,
  skinShade: 0xd99f7c,
  hair: 0x6a3a1d,
  hairTip: 0xa4642f,
  jacket: 0x2c58cc,
  jacketDark: 0x1c3480,
  orange: 0xff8a1e,
  pants: 0x1f2740,
  pantsDark: 0x151a2c,
  glove: 0x17181f,
  bracer: 0x3a4254,
  boot: 0x1e2436,
  bootStripe: 0x2f86ff,
  sole: 0x0e1018,
  pack: 0x2b3858,
  packFrame: 0x56627e,
  eyeWhite: 0xffffff,
  iris: 0x4a2a16,
  brow: 0x4b2812,
  mouth: 0x9a3b2f,
};

// Skeleton dimensions (metres).
const THIGH = 0.3;
const SHIN = 0.3;
const ANKLE_H = 0.13;
const HIP_H = THIGH + SHIN + ANKLE_H;

/** Target pose parameters; the model eases toward them every frame. */
export interface BoyPose {
  crouch: number;
  lean: number;
  roll: number;
  twist: number;
  armSpread: number;
  armUp: number;
  stance: number;
  wobble: number;
  boost: number;
  /** Lateral shift direction while moving between rails (-1..1). */
  shift: number;
}

export function defaultPose(): BoyPose {
  return { crouch: 0.35, lean: 0.38, roll: 0, twist: 0, armSpread: 1, armUp: 0, stance: 1, wobble: 0, boost: 0, shift: 0 };
}

interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
  end: THREE.Group;
}

/**
 * The SKIZGAIROS hero. Built from sculpted primitives merged per bone
 * (vertex-coloured, one material), animated procedurally: legs use 2-bone
 * IK so the hover-skates stay planted on the rail while he crouches,
 * leans and rolls into curves.
 */
export class BoyModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly pelvis = new THREE.Group();
  readonly spine = new THREE.Group();
  readonly chest = new THREE.Group();
  readonly head = new THREE.Group();
  readonly hair = new THREE.Group();
  readonly armL: Limb;
  readonly armR: Limb;
  readonly legL: Limb;
  readonly legR: Limb;
  readonly bootGlows: THREE.Sprite[] = [];
  readonly pose: BoyPose = defaultPose();
  private readonly target: BoyPose = defaultPose();
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private t = 0;
  private hairLag = 0;
  private hairLagV = 0;
  private readonly footTarget = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();

  constructor() {
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 2.4, 2.8) });

    this.root.add(this.body);
    this.body.add(this.pelvis);
    this.pelvis.add(this.spine);
    this.spine.position.y = 0.08;
    this.spine.add(this.chest);
    this.chest.position.y = 0.02;
    this.chest.add(this.head);
    this.head.position.y = 0.42;
    this.head.add(this.hair);

    this.buildPelvis();
    this.buildChest();
    this.buildHead();
    this.armL = this.buildArm(-1);
    this.armR = this.buildArm(1);
    this.legL = this.buildLeg(-1);
    this.legR = this.buildLeg(1);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });
  }

  private mesh(kit: GeoKit, parent: THREE.Object3D, material: THREE.Material = this.mat): THREE.Mesh {
    const m = new THREE.Mesh(kit.merge(), material);
    parent.add(m);
    return m;
  }

  private buildPelvis(): void {
    const k = new GeoKit();
    k.add(new THREE.CapsuleGeometry(0.13, 0.08, 4, 12), C.pants, trs(0, 0.0, 0, 0, 0, Math.PI / 2, 1, 1.15, 0.85));
    k.add(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 16), C.pantsDark, trs(0, 0.07, 0));
    k.add(new THREE.BoxGeometry(0.06, 0.045, 0.02), C.orange, trs(0, 0.07, -0.155));
    // cargo pockets
    k.add(new THREE.BoxGeometry(0.05, 0.09, 0.07), C.pantsDark, trs(-0.16, -0.05, 0));
    k.add(new THREE.BoxGeometry(0.05, 0.09, 0.07), C.pantsDark, trs(0.16, -0.05, 0));
    this.mesh(k, this.pelvis);
  }

  private buildChest(): void {
    const k = new GeoKit();
    // Jacket torso: tapered capsule.
    k.add(new THREE.CapsuleGeometry(0.15, 0.16, 6, 16), (p, n) => {
      const c = new THREE.Color(C.jacket);
      if (p.y < 0.07) c.set(C.jacketDark);
      return c.multiplyScalar(0.85 + 0.15 * Math.max(0, n.y));
    }, trs(0, 0.2, 0, 0, 0, 0, 1.2, 1, 0.82));
    // Orange hood bunched behind the neck and collar.
    k.add(new THREE.TorusGeometry(0.1, 0.045, 8, 16), C.orange, trs(0, 0.38, 0.0, Math.PI / 2, 0, 0, 1, 1, 0.8));
    k.add(new THREE.SphereGeometry(0.1, 12, 8), C.orange, trs(0, 0.37, 0.1, 0, 0, 0, 1.3, 0.7, 0.8));
    // Orange shoulder panels.
    k.add(new THREE.SphereGeometry(0.075, 10, 8), C.orange, trs(-0.18, 0.33, 0, 0, 0, 0, 1, 0.8, 1.1));
    k.add(new THREE.SphereGeometry(0.075, 10, 8), C.orange, trs(0.18, 0.33, 0, 0, 0, 0, 1, 0.8, 1.1));
    // Backpack straps (over the shoulders, down the front).
    for (const sx of [-1, 1]) {
      k.add(new THREE.BoxGeometry(0.045, 0.3, 0.02), C.orange, trs(sx * 0.1, 0.2, -0.125, 0.1, 0, 0));
      k.add(new THREE.BoxGeometry(0.045, 0.02, 0.2), C.orange, trs(sx * 0.1, 0.35, 0.0));
    }
    // Neck.
    k.add(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), C.skinShade, trs(0, 0.42, 0));
    this.mesh(k, this.chest);

    // Backpack (seen from behind by the camera - the reference hero shot).
    const b = new GeoKit();
    b.add(new THREE.BoxGeometry(0.3, 0.34, 0.14), (_p, n) => new THREE.Color(C.pack).multiplyScalar(0.8 + 0.25 * Math.max(0, n.y + n.z * 0.5)), trs(0, 0.21, 0.16));
    b.add(new THREE.BoxGeometry(0.33, 0.05, 0.16), C.packFrame, trs(0, 0.38, 0.16));
    b.add(new THREE.BoxGeometry(0.33, 0.04, 0.16), C.packFrame, trs(0, 0.05, 0.16));
    for (const sx of [-1, 1]) b.add(new THREE.BoxGeometry(0.04, 0.34, 0.16), C.packFrame, trs(sx * 0.165, 0.21, 0.16));
    b.add(new THREE.BoxGeometry(0.2, 0.12, 0.06), C.packFrame, trs(0, 0.11, 0.25));
    b.add(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), C.packFrame, trs(0, 0.41, 0.16));
    // Side canisters.
    for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), C.orange, trs(sx * 0.19, 0.2, 0.16));
    this.mesh(b, this.chest);
    // Glowing emblem panel on the back of the pack.
    const emblem = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshBasicMaterial({ map: textures().emblem, transparent: true, color: new THREE.Color(1.6, 2.2, 2.4), depthWrite: false }),
    );
    emblem.position.set(0, 0.24, 0.232);
    this.chest.add(emblem);
    // Glow strip along the pack bottom.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.01), this.glowMat);
    strip.position.set(0, 0.075, 0.235);
    this.chest.add(strip);
  }

  private buildHead(): void {
    const k = new GeoKit();
    k.add(new THREE.SphereGeometry(0.14, 20, 16), (p) => {
      const c = new THREE.Color(C.skin);
      if (p.y < -0.05) c.lerp(new THREE.Color(C.skinShade), 0.4);
      return c;
    }, trs(0, 0.12, 0, 0, 0, 0, 1, 1.06, 1.02));
    // Ears.
    for (const sx of [-1, 1]) k.add(new THREE.SphereGeometry(0.035, 8, 6), C.skinShade, trs(sx * 0.14, 0.11, 0.01, 0, 0, 0, 0.6, 1, 0.9));
    // Face (visible on the title / results views).
    for (const sx of [-1, 1]) {
      k.add(new THREE.SphereGeometry(0.034, 12, 10), C.eyeWhite, trs(sx * 0.055, 0.13, -0.118, 0, 0, 0, 0.9, 1.15, 0.5));
      k.add(new THREE.SphereGeometry(0.021, 10, 8), C.iris, trs(sx * 0.053, 0.125, -0.134, 0, 0, 0, 1, 1.1, 0.5));
      k.add(new THREE.SphereGeometry(0.007, 6, 4), 0xffffff, trs(sx * 0.047, 0.135, -0.143));
      k.add(new THREE.BoxGeometry(0.055, 0.012, 0.02), C.brow, trs(sx * 0.058, 0.185, -0.123, 0, 0, sx * -0.18));
    }
    k.add(new THREE.SphereGeometry(0.018, 8, 6), C.skinShade, trs(0, 0.09, -0.142));
    k.add(new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), C.mouth, trs(0, 0.055, -0.128, 0, 0, Math.PI));
    this.mesh(k, this.head);

    // Spiky brown hair (merged, gradient from root to tip).
    const h = new GeoKit();
    const hairColor = (p: THREE.Vector3) => {
      const t = clamp((p.y - 0.12) / 0.2 + Math.max(0, p.z) * 1.2, 0, 1);
      return new THREE.Color(C.hair).lerp(new THREE.Color(C.hairTip), t * 0.6);
    };
    h.add(new THREE.SphereGeometry(0.152, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hairColor, trs(0, 0.135, 0.012));
    // Back of head coverage.
    h.add(new THREE.SphereGeometry(0.148, 16, 10, 0, Math.PI, 0, Math.PI * 0.95), hairColor, trs(0, 0.12, 0.015, 0, Math.PI / 2 + Math.PI / 2, 0, 1, 1, 1.05));
    // Spikes: [x, y, z, rotX, rotZ, radius, length]
    const spikes: number[][] = [
      [0, 0.28, 0.0, 0.45, 0, 0.06, 0.2],
      [-0.07, 0.27, 0.02, 0.55, 0.45, 0.055, 0.18],
      [0.07, 0.27, 0.02, 0.55, -0.45, 0.055, 0.18],
      [0, 0.25, 0.08, 1.1, 0, 0.06, 0.2],
      [-0.08, 0.23, 0.08, 1.15, 0.5, 0.055, 0.17],
      [0.08, 0.23, 0.08, 1.15, -0.5, 0.055, 0.17],
      [0, 0.17, 0.13, 1.6, 0, 0.055, 0.17],
      [-0.1, 0.15, 0.1, 1.6, 0.7, 0.05, 0.14],
      [0.1, 0.15, 0.1, 1.6, -0.7, 0.05, 0.14],
      [-0.13, 0.2, 0.0, 0.8, 1.0, 0.045, 0.13],
      [0.13, 0.2, 0.0, 0.8, -1.0, 0.045, 0.13],
      // front fringe sweeping up and forward
      [-0.05, 0.25, -0.1, -0.5, 0.35, 0.05, 0.15],
      [0.04, 0.26, -0.1, -0.55, -0.2, 0.05, 0.16],
      [0.0, 0.22, -0.13, -0.95, 0.0, 0.04, 0.12],
    ];
    for (const [x, y, z, rx, rz, r, len] of spikes) {
      const cone = new THREE.ConeGeometry(r, len, 7);
      cone.translate(0, len / 2, 0);
      h.add(cone, hairColor, trs(x, y - 0.05, z, rx, 0, rz));
    }
    this.mesh(h, this.hair);
  }

  private buildArm(side: -1 | 1): Limb {
    const upper = new THREE.Group();
    upper.position.set(side * 0.21, 0.33, 0);
    this.chest.add(upper);
    const ku = new GeoKit();
    ku.add(new THREE.CapsuleGeometry(0.055, 0.14, 4, 10), C.jacket, trs(0, -0.1, 0));
    ku.add(new THREE.CylinderGeometry(0.062, 0.062, 0.035, 12), C.orange, trs(0, -0.19, 0));
    this.mesh(ku, upper);

    const lower = new THREE.Group();
    lower.position.y = -0.22;
    upper.add(lower);
    const kl = new GeoKit();
    kl.add(new THREE.CapsuleGeometry(0.043, 0.12, 4, 10), C.skin, trs(0, -0.07, 0));
    kl.add(new THREE.CylinderGeometry(0.052, 0.048, 0.085, 12), C.bracer, trs(0, -0.155, 0));
    this.mesh(kl, lower);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 6, 16), this.glowMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.14;
    lower.add(ring);

    const hand = new THREE.Group();
    hand.position.y = -0.21;
    lower.add(hand);
    const kh = new GeoKit();
    kh.add(new THREE.BoxGeometry(0.085, 0.09, 0.045), C.glove, trs(0, -0.035, 0));
    kh.add(new THREE.BoxGeometry(0.08, 0.06, 0.035), C.glove, trs(0, -0.1, -0.004, 0.25, 0, 0));
    kh.add(new THREE.CapsuleGeometry(0.016, 0.04, 3, 6), C.glove, trs(side * -0.045, -0.04, -0.02, 0, 0, side * 0.6));
    this.mesh(kh, hand);
    return { upper, lower, end: hand };
  }

  private buildLeg(side: -1 | 1): Limb {
    const upper = new THREE.Group();
    upper.position.set(side * 0.09, -0.04, 0);
    this.pelvis.add(upper);
    const ku = new GeoKit();
    ku.add(new THREE.CapsuleGeometry(0.075, THIGH - 0.08, 4, 10), C.pants, trs(0, -THIGH / 2, 0));
    this.mesh(ku, upper);

    const lower = new THREE.Group();
    lower.position.y = -THIGH;
    upper.add(lower);
    const kl = new GeoKit();
    kl.add(new THREE.CapsuleGeometry(0.062, SHIN - 0.1, 4, 10), C.pants, trs(0, -SHIN / 2, 0));
    kl.add(new THREE.SphereGeometry(0.05, 8, 6), C.pantsDark, trs(0, -0.01, -0.04, 0, 0, 0, 1, 1, 0.7));
    this.mesh(kl, lower);

    const foot = new THREE.Group();
    foot.position.y = -SHIN;
    lower.add(foot);
    const kf = new GeoKit();
    // High-top hover-skate boot.
    kf.add(new THREE.CylinderGeometry(0.075, 0.08, 0.12, 12), C.boot, trs(0, -0.02, 0.01));
    kf.add(new THREE.BoxGeometry(0.125, 0.1, 0.26), C.boot, trs(0, -0.075, -0.04));
    kf.add(new THREE.SphereGeometry(0.066, 10, 8), C.boot, trs(0, -0.08, -0.16, 0, 0, 0, 0.95, 0.75, 1));
    kf.add(new THREE.BoxGeometry(0.13, 0.025, 0.2), C.bootStripe, trs(0, -0.04, -0.05));
    kf.add(new THREE.BoxGeometry(0.14, 0.04, 0.32), C.sole, trs(0, -0.125, -0.045));
    kf.add(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), C.bootStripe, trs(0, 0.035, 0.01));
    this.mesh(kf, foot);
    // Glowing hover wheels / thrusters.
    for (const z of [-0.15, 0.07]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.12, 14), this.glowMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, -0.15, z);
      foot.add(w);
    }
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: textures().glow, color: 0x6fe6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }),
    );
    glow.scale.set(0.55, 0.3, 1);
    glow.position.set(0, -0.16, -0.04);
    foot.add(glow);
    this.bootGlows.push(glow);
    return { upper, lower, end: foot };
  }

  /** Set the pose the model should ease toward. */
  setTarget(p: Partial<BoyPose>): void {
    Object.assign(this.target, p);
  }

  /**
   * Advance the procedural animation.
   * @param speed  forward speed (m/s) - drives sway rhythm
   * @param vAccel vertical acceleration (for hair bounce)
   */
  update(dt: number, speed: number, vAccel = 0): void {
    this.t += dt;
    const P = this.pose;
    const T = this.target;
    P.crouch = damp(P.crouch, T.crouch, 10, dt);
    P.lean = damp(P.lean, T.lean, 8, dt);
    P.roll = damp(P.roll, T.roll, 9, dt);
    P.twist = damp(P.twist, T.twist, 8, dt);
    P.armSpread = damp(P.armSpread, T.armSpread, 7, dt);
    P.armUp = damp(P.armUp, T.armUp, 8, dt);
    P.stance = damp(P.stance, T.stance, 6, dt);
    P.wobble = damp(P.wobble, T.wobble, 6, dt);
    P.boost = damp(P.boost, T.boost, 5, dt);
    P.shift = damp(P.shift, T.shift, 14, dt);

    const t = this.t;
    const sway = Math.sin(t * 2.4 * (0.6 + speed / 60)) * (1 - P.boost * 0.6);
    const wob = P.wobble;

    // Body placement: crouch lowers the hips; bob and sway add life.
    const crouch = clamp(P.crouch + P.boost * 0.2, 0, 1);
    const hipY = HIP_H - crouch * 0.24 + Math.sin(t * 7) * 0.01;
    this.body.position.set(0.02 * sway + P.shift * 0.08, hipY, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.rotation.z = -P.roll - P.shift * 0.18 + Math.sin(t * 17) * 0.12 * wob;
    this.pelvis.rotation.set(-P.lean * 0.25, sway * 0.06 + P.twist * 0.3, 0);
    this.spine.rotation.set(-P.lean * 0.75 - P.boost * 0.2, P.twist * 0.5, P.shift * 0.12);
    this.chest.rotation.set(-0.05, P.twist * 0.3 - sway * 0.05, 0);
    // Keep the head looking down the rail.
    this.head.rotation.set(P.lean * 0.7 + P.boost * 0.15 - 0.1, -P.twist * 0.6, P.roll * 0.4 + P.shift * 0.08);

    // Hair: spring lag from vertical acceleration and wobble.
    const hairTarget = clamp(-vAccel * 0.004, -0.25, 0.25) + wob * Math.sin(t * 23) * 0.1;
    this.hairLagV += (hairTarget - this.hairLag) * 120 * dt;
    this.hairLagV *= Math.exp(-10 * dt);
    this.hairLag += this.hairLagV * dt;
    this.hair.rotation.x = this.hairLag + 0.02 * Math.sin(t * 13);

    // Arms: spread for balance like the reference, swept back when boosting.
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      const spread = P.armSpread * (1 - P.boost * 0.5);
      const abduct = 0.35 + spread * 1.0 + P.armUp * 0.9 + side * P.roll * 0.35 + side * P.shift * 0.25;
      const fwd = 0.25 * (1 - spread) - P.boost * 0.9 + side * sway * 0.12 + Math.sin(t * 19 + side) * 0.5 * wob;
      arm.upper.rotation.set(fwd, 0, side * abduct, 'ZXY');
      arm.lower.rotation.set(0.25 + P.boost * 0.2, 0, side * (0.25 - spread * 0.15), 'XYZ');
      arm.end.rotation.set(-0.2, side * 0.25, side * 0.35);
    }

    // Legs: 2-bone IK keeps the hover-skates planted on the rail.
    const stance = 0.12 * P.stance;
    this.solveLeg(this.legL, -0.11, -stance + sway * 0.02);
    this.solveLeg(this.legR, 0.11, stance * 0.7 - sway * 0.02);

    const glowPulse = 0.8 + 0.2 * Math.sin(t * 30);
    for (const g of this.bootGlows) g.material.opacity = glowPulse;
  }

  private solveLeg(leg: Limb, x: number, z: number): void {
    // Foot target in root space: sole on the rail surface.
    this.footTarget.set(x, ANKLE_H + 0.02, z);
    this.root.updateMatrixWorld(true);
    const world = this.root.localToWorld(this.tmp.copy(this.footTarget));
    const local = this.pelvis.worldToLocal(world);
    const d = local.sub(leg.upper.position);
    const dyz = Math.hypot(d.y, d.z);
    const L = clamp(dyz, 0.1, THIGH + SHIN - 0.002);
    const cosK = clamp((THIGH * THIGH + SHIN * SHIN - L * L) / (2 * THIGH * SHIN), -1, 1);
    const knee = Math.PI - Math.acos(cosK);
    const a = Math.atan2(-d.z, -d.y);
    const cosB = clamp((THIGH * THIGH + L * L - SHIN * SHIN) / (2 * THIGH * L), -1, 1);
    const b = Math.acos(cosB);
    leg.upper.rotation.set(a + b, 0, clamp(Math.atan2(d.x, -d.y), -0.4, 0.4));
    leg.lower.rotation.set(-knee, 0, 0);
    // Foot flat on the rail: cancel the accumulated parent rotation.
    leg.upper.updateMatrixWorld(true);
    leg.lower.getWorldQuaternion(this.tmpQ);
    this.root.getWorldQuaternion(this.tmpQ2);
    leg.end.quaternion.copy(this.tmpQ.invert().multiply(this.tmpQ2));
  }

  /** Height of the hips above the rail at the current pose (for effects). */
  get hipHeight(): number {
    return this.body.position.y;
  }
}
