import * as THREE from 'three';
import { Audio } from '../core/Audio';
import { EventBus } from '../core/EventBus';
import { Input, InputAction } from '../core/Input';
import { clamp01 } from '../core/MathUtil';
import { loadSave, SaveData, writeSave } from '../core/Save';
import { CameraRig } from '../camera/CameraRig';
import type { LevelData } from '../course/LevelData';
import { buildLevel } from '../course/Levels';
import { Blocks } from '../entities/Blocks';
import { Coins } from '../entities/Coins';
import { Player } from '../player/Player';
import { PlayerView } from '../player/PlayerView';
import { Particles } from '../render/Particles';
import { RailRenderer } from '../render/RailRenderer';
import { createCloudSea, Scenery } from '../render/Scenery';
import { SpeedLines } from '../render/SpeedLines';
import { Stage } from '../render/Stage';
import { Hud } from '../ui/Hud';
import { Screens } from '../ui/Screens';

export type GameState = 'title' | 'countdown' | 'playing' | 'paused' | 'crashed' | 'complete';

const COIN_POINTS = 25;
const DISTANCE_POINTS = 5; // per metre
const BOOST_POINTS = 100;
const SIM_STEP = 1 / 120;

/**
 * Orchestrates the Gameplay Screen: world, rider, camera, HUD and flow
 * (title -> countdown -> ride -> crash/finish).
 */
export class Game {
  readonly bus = new EventBus();
  readonly stage: Stage;
  readonly scenery = new Scenery();
  readonly rails = new RailRenderer();
  readonly coins = new Coins();
  readonly blocks = new Blocks();
  readonly particles = new Particles(900);
  readonly speedLines = new SpeedLines();
  readonly view = new PlayerView();
  readonly audio = new Audio();
  readonly hud: Hud;
  readonly screens: Screens;
  readonly input: Input;
  readonly cameraRig: CameraRig;
  readonly cloudSea = createCloudSea();
  level!: LevelData;
  player!: Player;
  state: GameState = 'title';
  score = 0;
  coinCount = 0;
  elapsed = 0;
  private save: SaveData = loadSave();
  private countdownT = 0;
  private countdownStep = -1;
  private stateTime = 0;
  private tutorialIdx = 0;
  private lastFrame = 0;
  private running = false;
  private frameTimes: number[] = [];
  private qualityCheck = 0;
  private readonly stageEl: HTMLElement;
  private readonly tmpV = new THREE.Vector3();
  /** Set by tests: freeze the real-time loop so time only advances via advance(). */
  manualTime = false;

  constructor(canvas: HTMLCanvasElement, hudEl: HTMLElement, screensEl: HTMLElement, stageEl: HTMLElement) {
    this.stageEl = stageEl;
    this.stage = new Stage(canvas);
    this.hud = new Hud(hudEl);
    this.screens = new Screens(screensEl);
    this.input = new Input({ left: this.hud.leftBtn, right: this.hud.rightBtn, pause: this.hud.pauseBtn });
    this.cameraRig = new CameraRig(this.stage.camera);
    this.audio.setEnabled(this.save.sound);

    const scene = this.stage.scene;
    scene.add(this.rails.group, this.coins.group, this.blocks.group, this.view.group, this.particles.points, this.scenery.group);
    this.stage.camera.add(this.speedLines.mesh);
    this.stage.backdrop.add(this.cloudSea, this.scenery.backdrop);

    this.bindEvents();
    this.loadLevel(1);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    window.visualViewport?.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing' || this.state === 'countdown') this.pause();
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
    this.toTitle();
  }

  // ------------------------------------------------------------ setup

  private loadLevel(index: number): void {
    this.level = buildLevel(index);
    this.player = new Player(this.level, this.bus);
    this.rails.setLevel(this.level);
    this.coins.setLevel(this.level);
    this.blocks.setLevel(this.level);
    this.scenery.setLevel(this.level);
    this.hud.setLevel(this.level.index);
    this.resetRun();
  }

  private resetRun(): void {
    this.player.reset();
    this.coins.reset();
    this.blocks.reset();
    this.particles.clear();
    this.view.resetTrail();
    this.score = 0;
    this.coinCount = 0;
    this.elapsed = 0;
    this.tutorialIdx = 0;
    this.hud.reset();
    this.hud.setZone('SKY RAILS');
    this.rails.prime(this.player.s);
    this.scenery.prime(this.player.s);
    this.cameraRig.snap();
  }

  private bindEvents(): void {
    const bus = this.bus;
    bus.on('railChanged', ({ dir }) => {
      this.audio.whoosh(dir);
      this.hud.pressFeedback(dir);
    });
    bus.on('railChangeBlocked', ({ dir }) => {
      this.audio.blocked();
      this.hud.pressFeedback(dir);
    });
    bus.on('crashed', () => {
      this.audio.crash();
      this.cameraRig.addShake(1);
      this.hud.flashScreen('hit');
      this.setState('crashed');
    });
    bus.on('levelComplete', () => {
      this.audio.fanfare();
      this.setState('complete');
    });
    bus.on('coinCollected', ({ x, y, z }) => {
      this.audio.coin();
      this.particles.burst(this.tmpV.set(x, y, z), 10, 5, 1.6, 1.2, 0.35, 0.35, 0.45);
      const scr = this.tmpV.set(x, y, z).project(this.stage.camera);
      const rect = this.stageEl.getBoundingClientRect();
      this.hud.flyCoin(rect.left + ((scr.x + 1) / 2) * rect.width, rect.top + ((1 - scr.y) / 2) * rect.height);
    });
    bus.on('boost', () => {
      this.audio.boost();
      this.hud.flashScreen('boost');
      this.cameraRig.addShake(0.3);
    });
  }

  onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Portrait devices fill the screen; wide windows get a centred portrait frame.
    let sw = w;
    let sh = h;
    const framed = w / h > 0.8;
    if (framed) {
      sh = Math.round(h * 0.96);
      sw = Math.round(sh * (9 / 19.5));
    }
    this.stageEl.style.width = `${sw}px`;
    this.stageEl.style.height = `${sh}px`;
    this.stageEl.classList.toggle('framed', framed);
    const u = Math.min(sw / 512, sh / 1024);
    this.stageEl.style.setProperty('--u', `${u}px`);
    this.stage.resize(sw, sh);
    this.particles.setViewport(sh * this.stage.renderer.getPixelRatio(), this.stage.camera.fov);
  }

  // ------------------------------------------------------------ flow

  private setState(s: GameState): void {
    this.state = s;
    this.stateTime = 0;
  }

  toTitle(): void {
    this.setState('title');
    this.cameraRig.mode = 'title';
    this.hud.show(false);
    this.screens.title(this.level.index, this.level.name, () => this.beginCountdown());
  }

  beginCountdown(): void {
    this.audio.unlock();
    this.audio.click();
    if (this.state !== 'title' && this.state !== 'crashed' && this.state !== 'complete' && this.state !== 'paused') return;
    if (this.state !== 'title') this.resetRun();
    this.setState('countdown');
    this.countdownT = 0;
    this.countdownStep = -1;
    this.cameraRig.mode = 'ride';
    this.hud.show(true);
    this.screens.clear();
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.setState('paused');
    this.audio.ride(0, false);
    this.screens.pause(
      this.audio.enabled,
      () => this.resume(),
      () => {
        this.screens.clear();
        this.resetRun();
        this.setState('crashed');
        this.beginCountdown();
      },
      () => {
        this.audio.setEnabled(!this.audio.enabled);
        this.save.sound = this.audio.enabled;
        writeSave(this.save);
        this.state = 'playing';
        this.pause();
      },
    );
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.audio.unlock();
    this.screens.clear();
    // Resume through a short countdown so the player is ready.
    this.setState('countdown');
    this.countdownT = 1.2;
    this.countdownStep = 1;
  }

  // ------------------------------------------------------------ loop

  run(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (!this.manualTime) this.tick(dt);
      this.renderFrame();
      this.trackPerformance(dt);
    };
    requestAnimationFrame(frame);
  }

  /** Advance the simulation (fixed sub-steps for robust collisions). */
  tick(dt: number): void {
    for (const a of this.input.drain()) this.handleAction(a);
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(SIM_STEP, remaining);
      this.simulate(step);
      remaining -= step;
    }
    this.present(dt);
  }

  private handleAction(a: InputAction): void {
    switch (a) {
      case 'left':
      case 'right':
        if (this.state === 'playing') this.player.requestMove(a === 'left' ? -1 : 1);
        else if (this.state === 'title') this.beginCountdown();
        break;
      case 'pause':
        if (this.state === 'paused') this.resume();
        else this.pause();
        break;
      case 'confirm':
        if (this.state === 'title' || this.state === 'crashed' || this.state === 'complete') {
          if (this.stateTime > 0.8 || this.state === 'title') this.beginCountdown();
        } else if (this.state === 'paused') this.resume();
        break;
    }
  }

  private simulate(dt: number): void {
    this.stateTime += dt;
    const p = this.player;
    switch (this.state) {
      case 'countdown': {
        this.countdownT += dt;
        const step = Math.floor(this.countdownT / 0.6);
        if (step !== this.countdownStep) {
          this.countdownStep = step;
          const labels = ['3', '2', '1', 'GO!'];
          if (step < 4) {
            this.screens.countdown(labels[step]);
            this.audio.countdown(step === 3);
          }
          if (step === 3) {
            p.start();
            if (p.state === 'riding') this.setState('playing');
            window.setTimeout(() => {
              if (this.state === 'playing') this.screens.clear();
            }, 500);
          }
        }
        break;
      }
      case 'playing': {
        const sPrev = p.s;
        p.update(dt);
        this.elapsed += dt;
        this.score += (p.s - sPrev) * DISTANCE_POINTS;
        if (p.state === 'riding' || p.state === 'finished') {
          const gate = this.blocks.hitGate(sPrev, p.s, p.lat);
          if (gate && p.state === 'riding') p.crash();
          if (p.state === 'riding' && this.blocks.hitBoost(sPrev, p.s, p.lat)) {
            p.boost();
            this.score += BOOST_POINTS;
            this.bus.emit('boost', {});
          }
          this.coins.collect(sPrev, p.s, p.lat, p.h, (w) => {
            this.coinCount++;
            this.score += COIN_POINTS;
            this.bus.emit('coinCollected', { value: COIN_POINTS, x: w.x, y: w.y, z: w.z });
          });
        }
        const tut = this.level.tutorials;
        while (this.tutorialIdx < tut.length && tut[this.tutorialIdx].s <= p.s) {
          this.hud.hint(tut[this.tutorialIdx].text);
          this.tutorialIdx++;
        }
        break;
      }
      case 'crashed':
      case 'complete':
        p.update(dt);
        if (this.state === 'crashed' && this.stateTime >= 1.3 && this.stateTime - dt < 1.3) this.showCrash();
        if (this.state === 'complete' && this.stateTime >= 1.8 && this.stateTime - dt < 1.8) this.showComplete();
        break;
      case 'title':
        p.update(dt);
        break;
      case 'paused':
        break;
    }
  }

  private showCrash(): void {
    this.screens.crashed(this.stats(false), () => this.beginCountdown());
  }

  private showComplete(): void {
    const newBest = this.score > this.save.bestScore;
    if (newBest) this.save.bestScore = Math.floor(this.score);
    this.save.totalCoins += this.coinCount;
    writeSave(this.save);
    this.screens.complete(this.stats(newBest), () => this.beginCountdown());
  }

  private stats(newBest: boolean) {
    return {
      score: this.score,
      coins: this.coinCount,
      totalCoins: this.coins.total,
      time: this.elapsed,
      best: Math.max(this.save.bestScore, Math.floor(this.score)),
      newBest,
    };
  }

  /** Per-frame visuals (not physics). */
  private present(dt: number): void {
    const p = this.player;
    const paused = this.state === 'paused';
    const vdt = paused ? 0 : dt;
    this.view.update(vdt, p, this.level, this.particles);
    this.cameraRig.update(vdt, p, this.level);
    const camS = p.s - 4;
    this.rails.update(vdt, camS);
    this.coins.update(vdt, camS);
    this.blocks.update(vdt, camS);
    this.scenery.update(vdt, camS, this.stage.camera);
    this.particles.update(vdt);
    this.speedLines.intensity = this.state === 'playing' ? clamp01((p.speed - 22) / 14) + (p.boosting ? 0.6 : 0) : 0;
    this.speedLines.update(vdt, p.speed, this.stage.camera);
    this.stage.updateLights(this.view.worldPos);
    const cam = this.stage.camera.position;
    this.cloudSea.position.set(cam.x, cam.y - 170, cam.z);
    const u = this.cloudSea.material.uniforms;
    (u.uCam.value as THREE.Vector3).copy(cam);
    u.uTime.value = (u.uTime.value as number) + vdt;
    this.audio.ride(p.speed, this.state === 'playing');
    this.hud.update(dt, this.score, this.coinCount, this.elapsed);
  }

  renderFrame(): void {
    this.stage.render();
  }

  // ------------------------------------------------------------ quality

  private trackPerformance(dt: number): void {
    if (this.manualTime || this.state !== 'playing') return;
    this.frameTimes.push(dt);
    this.qualityCheck += dt;
    if (this.qualityCheck < 3) return;
    this.qualityCheck = 0;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 38) {
      if (this.stage.quality === 'high') this.setQuality('medium');
      else if (this.stage.quality === 'medium') this.setQuality('low');
    }
  }

  setQuality(q: 'high' | 'medium' | 'low'): void {
    this.stage.setQuality(q);
    this.onResize();
  }
}
