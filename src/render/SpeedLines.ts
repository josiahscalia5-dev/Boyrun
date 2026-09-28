import * as THREE from 'three';
import { textures } from './Textures';

const COUNT = 36;
const NEAR = -1.2;
const FAR = -26;

interface Streak {
  nx: number;
  ny: number;
  z: number;
  len: number;
}

/**
 * Radial speed streaks at the screen edges, parented to the camera.
 * Intensity follows speed and boosts; they never cover the hero.
 */
export class SpeedLines {
  readonly mesh: THREE.InstancedMesh;
  private readonly streaks: Streak[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly xAxis = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly mat: THREE.MeshBasicMaterial;
  intensity = 0;

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(Math.PI / 2); // quad in local XZ (length along z), normal +y
    this.mat = new THREE.MeshBasicMaterial({
      map: textures().trail,
      color: new THREE.Color(1.2, 1.4, 1.8),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    for (let i = 0; i < COUNT; i++) this.streaks.push(this.spawn(FAR + Math.random() * (NEAR - FAR)));
  }

  private spawn(z: number): Streak {
    // Keep streaks toward the screen edges (normalised screen coords).
    let nx = Math.random() * 2 - 1;
    let ny = Math.random() * 2 - 1;
    if (Math.abs(nx) < 0.62 && Math.abs(ny) < 0.55) {
      if (Math.random() < 0.6) nx = Math.sign(nx || 1) * (0.62 + Math.random() * 0.38);
      else ny = Math.sign(ny || 1) * (0.55 + Math.random() * 0.45);
    }
    return { nx, ny, z, len: 2 + Math.random() * 4 };
  }

  update(dt: number, speed: number, camera: THREE.PerspectiveCamera): void {
    this.mat.opacity = Math.min(0.55, this.intensity * 0.55);
    this.mesh.visible = this.mat.opacity > 0.01;
    if (!this.mesh.visible) return;
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    for (let i = 0; i < COUNT; i++) {
      const st = this.streaks[i];
      st.z += speed * 1.4 * dt;
      if (st.z > NEAR) this.streaks[i] = this.spawn(FAR);
      const d = -st.z;
      this.p.set(st.nx * tanH * d, st.ny * tanV * d, st.z);
      // Streak runs along the view ray (reads as radial on screen) and its
      // quad faces the camera.
      this.zAxis.copy(this.p).normalize();
      this.yAxis.copy(this.p).negate();
      this.yAxis.addScaledVector(this.zAxis, -this.yAxis.dot(this.zAxis));
      if (this.yAxis.lengthSq() < 1e-8) this.yAxis.set(0, 1, 0);
      this.yAxis.normalize();
      this.xAxis.crossVectors(this.yAxis, this.zAxis);
      this.basis.makeBasis(this.xAxis, this.yAxis, this.zAxis);
      this.q.setFromRotationMatrix(this.basis);
      this.s.set(0.012 * d + 0.02, 1, st.len);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
