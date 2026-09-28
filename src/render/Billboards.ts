import * as THREE from 'three';

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iColor;
attribute float iTile;
uniform float uTiles;
uniform float uFadeNear;
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
varying float vNearFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
  vUv = vec2((uv.x + iTile) / uTiles, uv.y);
  vColor = iColor;
  vFogDepth = -mv.z;
  vNearFade = smoothstep(uFadeNear * 0.4, uFadeNear, -mv.z);
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float uFogAmount;
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
varying float vNearFade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec3 col = t.rgb * vColor.rgb;
  float f = smoothstep(fogNear, fogFar, vFogDepth) * uFogAmount;
  col = mix(col, fogColor, f);
  float a = t.a * vColor.a * vNearFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export interface BillboardHandle {
  index: number;
}

/**
 * Instanced camera-facing sprites in a single draw call (clouds, mist,
 * glows). Slots are allocated densely with swap-remove so only live
 * instances are drawn.
 */
export class BillboardLayer {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly tile: THREE.InstancedBufferAttribute;
  private readonly handles: BillboardHandle[] = [];
  private count = 0;

  constructor(
    map: THREE.Texture,
    readonly capacity: number,
    opts: { tiles?: number; additive?: boolean; fadeNear?: number; fogAmount?: number; fog?: boolean } = {},
  ) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.attributes.position);
    this.geo.setAttribute('uv', base.attributes.uv);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tile = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.pos, this.size, this.color, this.tile]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iSize', this.size);
    this.geo.setAttribute('iColor', this.color);
    this.geo.setAttribute('iTile', this.tile);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uMap: { value: map },
          uTiles: { value: opts.tiles ?? 1 },
          uFadeNear: { value: opts.fadeNear ?? 20 },
          uFogAmount: { value: opts.fogAmount ?? 0.85 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: opts.fog ?? true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // UniformsUtils.merge clones textures; re-assign the shared one.
    mat.uniforms.uMap.value = map;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  add(x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number, a: number, tile = 0): BillboardHandle | null {
    if (this.count >= this.capacity) return null;
    const i = this.count++;
    const handle: BillboardHandle = { index: i };
    this.handles[i] = handle;
    this.write(i, x, y, z, w, h, r, g, b, a, tile);
    this.geo.instanceCount = this.count;
    return handle;
  }

  update(hd: BillboardHandle, x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number, a: number, tile = 0): void {
    this.write(hd.index, x, y, z, w, h, r, g, b, a, tile);
  }

  remove(hd: BillboardHandle): void {
    const last = this.count - 1;
    const i = hd.index;
    if (i < 0) return;
    if (i !== last) {
      const moved = this.handles[last];
      this.pos.array.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.size.array.copyWithin(i * 2, last * 2, last * 2 + 2);
      this.color.array.copyWithin(i * 4, last * 4, last * 4 + 4);
      this.tile.array[i] = this.tile.array[last];
      moved.index = i;
      this.handles[i] = moved;
    }
    hd.index = -1;
    this.count--;
    this.geo.instanceCount = this.count;
    this.markDirty();
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.handles[i].index = -1;
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  private write(i: number, x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number, a: number, tile: number): void {
    const p = this.pos.array as Float32Array;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    const s = this.size.array as Float32Array;
    s[i * 2] = w;
    s[i * 2 + 1] = h;
    const c = this.color.array as Float32Array;
    c[i * 4] = r;
    c[i * 4 + 1] = g;
    c[i * 4 + 2] = b;
    c[i * 4 + 3] = a;
    (this.tile.array as Float32Array)[i] = tile;
    this.markDirty();
  }

  private markDirty(): void {
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.color.needsUpdate = true;
    this.tile.needsUpdate = true;
  }

  get liveCount(): number {
    return this.count;
  }
}
