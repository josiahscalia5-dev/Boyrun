import * as THREE from 'three';
import { lerp } from '../core/MathUtil';

/** A complete lighting/colour mood; moods can be blended smoothly. */
export interface Mood {
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  horizon: THREE.Color;
  below: THREE.Color;
  sun: THREE.Color;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  keyColor: THREE.Color;
  keyIntensity: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  exposure: number;
}

const c = (hex: number) => new THREE.Color(hex);

export const MOODS = {
  sky: (): Mood => ({
    skyTop: c(0x1f6fe0),
    skyMid: c(0x5eaeff),
    horizon: c(0xe4f3ff),
    below: c(0xc9def7),
    sun: c(0xfff0c8),
    fog: c(0xcfe6ff),
    fogNear: 220,
    fogFar: 2100,
    hemiSky: c(0xd6ecff),
    hemiGround: c(0x7a8fb8),
    hemiIntensity: 1.35,
    keyColor: c(0xfff4e2),
    keyIntensity: 2.3,
    rimColor: c(0xcfeaff),
    rimIntensity: 1.6,
    exposure: 1.0,
  }),
};

export function blendMood(a: Mood, b: Mood, t: number, out: Mood): Mood {
  const cols: (keyof Mood)[] = ['skyTop', 'skyMid', 'horizon', 'below', 'sun', 'fog', 'hemiSky', 'hemiGround', 'keyColor', 'rimColor'];
  for (const k of cols) (out[k] as THREE.Color).copy(a[k] as THREE.Color).lerp(b[k] as THREE.Color, t);
  out.fogNear = lerp(a.fogNear, b.fogNear, t);
  out.fogFar = lerp(a.fogFar, b.fogFar, t);
  out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, t);
  out.keyIntensity = lerp(a.keyIntensity, b.keyIntensity, t);
  out.rimIntensity = lerp(a.rimIntensity, b.rimIntensity, t);
  out.exposure = lerp(a.exposure, b.exposure, t);
  return out;
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.28, y));
  col = mix(col, uTop, smoothstep(0.22, 0.9, y));
  col = mix(col, uBelow, smoothstep(0.0, -0.3, y));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.35 + pow(sd, 400.0) * 0.5);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function createSkyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBelow: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 0.12, -1).normalize() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export function applyMoodToSky(sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>, m: Mood): void {
  const u = sky.material.uniforms;
  (u.uTop.value as THREE.Color).copy(m.skyTop);
  (u.uMid.value as THREE.Color).copy(m.skyMid);
  (u.uHorizon.value as THREE.Color).copy(m.horizon);
  (u.uBelow.value as THREE.Color).copy(m.below);
  (u.uSun.value as THREE.Color).copy(m.sun);
}
