import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { applyMoodToSky, createSkyDome, Mood, MOODS } from './Atmosphere';

export type Quality = 'high' | 'medium' | 'low';

const QUALITY: Record<Quality, { maxDpr: number; bloom: boolean }> = {
  high: { maxDpr: 2, bloom: true },
  medium: { maxDpr: 1.5, bloom: true },
  low: { maxDpr: 1, bloom: false },
};

/**
 * Owns the WebGL renderer, scene, camera, sky and lights. Lights are
 * re-aimed relative to the camera every frame so the hero always gets a
 * soft key light on his back plus a crisp rim light, as in the reference.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Far scenery + sky, rendered first; the play space draws over it. */
  readonly backdrop = new THREE.Scene();
  private readonly backHemi = new THREE.HemisphereLight();
  private readonly backKey = new THREE.DirectionalLight();
  readonly camera: THREE.PerspectiveCamera;
  readonly sky = createSkyDome();
  readonly hemi = new THREE.HemisphereLight();
  readonly key = new THREE.DirectionalLight();
  readonly rim = new THREE.DirectionalLight();
  readonly mood: Mood = MOODS.sky();
  quality: Quality = 'high';
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private width = 1;
  private height = 1;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x9fd0ff, 1);

    this.camera = new THREE.PerspectiveCamera(60, 9 / 16, 0.1, 2600);
    this.scene.add(this.camera);
    this.backdrop.add(this.sky);
    this.scene.fog = new THREE.Fog(this.mood.fog, this.mood.fogNear, this.mood.fogFar);
    this.backdrop.fog = new THREE.Fog(this.mood.fog, 120, 1100);
    this.scene.add(this.hemi, this.key, this.key.target, this.rim, this.rim.target);
    this.backKey.position.set(-0.4, 1, 0.6);
    this.backdrop.add(this.backHemi, this.backKey);
    this.applyMood();
    this.buildEnvironment();
  }

  /** Reflections for metal parts: a PMREM of the sky itself. */
  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const dome = createSkyDome();
    applyMoodToSky(dome, this.mood);
    dome.scale.setScalar(50);
    envScene.add(dome);
    // A few bright panels for sparkling highlights on gold and chrome.
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.4), side: THREE.DoubleSide });
    for (const [x, y, z] of [
      [0, 20, -30],
      [-25, 15, 10],
      [25, 25, 5],
    ]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), panelMat);
      p.position.set(x, y, z);
      p.lookAt(0, 0, 0);
      envScene.add(p);
    }
    const rt = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.75;
    this.backdrop.environment = rt.texture;
    this.backdrop.environmentIntensity = 0.5;
    pmrem.dispose();
  }

  applyMood(): void {
    const m = this.mood;
    applyMoodToSky(this.sky, m);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(m.fog);
    fog.near = m.fogNear;
    fog.far = m.fogFar;
    this.hemi.color.copy(m.hemiSky);
    this.hemi.groundColor.copy(m.hemiGround);
    this.hemi.intensity = m.hemiIntensity;
    const bfog = this.backdrop.fog as THREE.Fog;
    bfog.color.copy(m.fog);
    this.backHemi.color.copy(m.hemiSky);
    this.backHemi.groundColor.copy(m.hemiGround);
    this.backHemi.intensity = m.hemiIntensity * 1.1;
    this.backKey.color.copy(m.keyColor);
    this.backKey.intensity = m.keyIntensity * 0.8;
    this.key.color.copy(m.keyColor);
    this.key.intensity = m.keyIntensity;
    this.rim.color.copy(m.rimColor);
    this.rim.intensity = m.rimIntensity;
    this.renderer.toneMappingExposure = m.exposure;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.resize(this.width, this.height);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const q = QUALITY[this.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    if (q.bloom) {
      if (!this.composer) {
        const target = new THREE.WebGLRenderTarget(1, 1, {
          type: THREE.HalfFloatType,
          samples: this.renderer.capabilities.isWebGL2 ? 4 : 0,
        });
        this.composer = new EffectComposer(this.renderer, target);
        this.composer.addPass(new RenderPass(this.backdrop, this.camera));
        const main = new RenderPass(this.scene, this.camera);
        main.clear = false;
        main.clearDepth = true;
        this.composer.addPass(main);
        this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.82);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      }
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(this.width, this.height);
      // Bloom at reduced resolution keeps it cheap on phones.
      this.bloom!.resolution.set(this.width * dpr * 0.5, this.height * dpr * 0.5);
    }
  }

  /** Aim key/rim lights relative to the camera view direction. */
  updateLights(focus: THREE.Vector3): void {
    const fwd = this.camera.getWorldDirection(this.tmp);
    fwd.y = 0;
    fwd.normalize();
    const right = this.tmp2.set(-fwd.z, 0, fwd.x);
    // Key: from behind the camera, upper left.
    this.key.position.copy(focus).addScaledVector(fwd, -30).addScaledVector(right, -18).add(new THREE.Vector3(0, 40, 0));
    this.key.target.position.copy(focus);
    // Rim: from ahead, slightly right - outlines the silhouette.
    this.rim.position.copy(focus).addScaledVector(fwd, 40).addScaledVector(right, 14).add(new THREE.Vector3(0, 18, 0));
    this.rim.target.position.copy(focus);
    // Sun glow in the sky sits ahead of the camera, low on the horizon.
    const sunDir = this.sky.material.uniforms.uSunDir.value as THREE.Vector3;
    sunDir.copy(fwd).multiplyScalar(1).add(new THREE.Vector3(0, 0.16, 0)).addScaledVector(right, 0.15).normalize();
    this.sky.position.copy(this.camera.position);
  }

  render(): void {
    if (QUALITY[this.quality].bloom && this.composer) {
      this.composer.render();
      return;
    }
    const r = this.renderer;
    r.autoClear = false;
    r.clear();
    r.render(this.backdrop, this.camera);
    r.clearDepth();
    r.render(this.scene, this.camera);
  }
}
