import { Audio } from '../core/Audio';
import { clamp, Spring1 } from '../core/MathUtil';
import { GameplayImages, L, waterMask } from './Assets';
import { ART_VALUES, formatScore, formatTime, Hud, HudPlacement, placeHud, Rect } from './Hud';
import { curveAt, LEVEL_LENGTH, SECTIONS } from './Level';
import {
  ART_H,
  ART_W,
  ART_Z,
  BLOCK_W,
  BOY_LANE_PX,
  centreX,
  FADE_FAR_Z,
  fadeIn,
  halfWidth,
  HIT_Z,
  laneX,
  railY,
  surfaceY,
} from './Rail';
import { BASE_SPEED, Item, Lane, MAX_SPEED, Track } from './Track';

export type GameState = 'ready' | 'riding' | 'paused' | 'crashed' | 'finished';

type Control = 'left' | 'right' | 'pause';

/** Maps the world (artwork pixels) onto the screen. */
interface World {
  x: number;
  y: number;
  s: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
}

/** A collected coin flying to the counter, in screen pixels. */
interface FlyCoin {
  x0: number;
  y0: number;
  t: number;
}

interface Streak {
  u: number;
  w: number;
}

const FEET = L.boy.feet as [number, number];
/** Where his knees and his boots fall through the sprite, top to bottom. */
const KNEE_V = ((L.boy.joints.kneeL[1] + L.boy.joints.kneeR[1]) / 2 - L.boy.y) / L.boy.h;
const FEET_V = (FEET[1] - L.boy.y) / L.boy.h;
/** The world is framed so the boy's feet sit this far down the screen. */
const FOCUS = 0.8;
/** How much of the artwork may be cropped away before it is fitted instead. */
const MAX_CROP = 1.6;

/**
 * THE GAMEPLAY SCREEN. The supplied artwork is the screen: the world, the boy,
 * his light trail, the coin trail and the HUD are the artwork's own layers,
 * put back together every frame so that the coins, gates and boosts can move
 * and the boy can answer the controls.
 */
export class GameplayScreen {
  state: GameState = 'ready';
  readonly track = new Track();
  readonly audio = new Audio();
  score = ART_VALUES.score;
  coins = ART_VALUES.coins;
  seconds = ART_VALUES.seconds;
  lane: Lane = 0;
  manualTime = false;

  private readonly bg: HTMLCanvasElement;
  private readonly fx: HTMLCanvasElement;
  private readonly bgCtx: CanvasRenderingContext2D;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly water: HTMLCanvasElement;
  private readonly shimmer: HTMLCanvasElement;
  private readonly shimmerCtx: CanvasRenderingContext2D;
  private readonly stripe: HTMLCanvasElement;
  private readonly stripePattern: CanvasPattern;
  private readonly hit: Record<Control, HTMLButtonElement>;
  private readonly cards: HTMLElement;
  private world: World = { x: 0, y: 0, s: 1 };
  private place: HudPlacement;
  private dpr = 1;
  private readonly laneSpring = new Spring1(0);
  /** Where the finger wants him, continuous between lanes. */
  private laneTarget = 0;
  private dragPerLane = 74;
  private laneVel = 0;
  private time = 0;
  private crashTime = 0;
  private shake = 0;
  private redFlash = 0;
  private blueFlash = 0;
  private press: Record<Control, number> = { left: 0, right: 0, pause: 0 };
  private sparks: Spark[] = [];
  private flying: FlyCoin[] = [];
  private streaks: Streak[] = [];
  private lastFrame = 0;
  private rideTime = 0;
  /** Skating stride: advances with the rail, drives the push-and-glide. */
  /** Safe rides in hand: one absorbs a hit that would otherwise end the run. */
  shield = 0;
  /** Briefly untouchable after a hit is absorbed, so one block cannot end it. */
  private invuln = 0;
  private staggerTime = 0;
  /** The section title that flashes up as he enters a new stretch. */
  private banner = { text: '', time: 0 };
  private stride = 0;
  /** Smoothed acceleration, -1..1: he surges forward and eases back. */
  private surge = 0;
  private prevSpeed = 0;

  constructor(private readonly root: HTMLElement, private readonly img: GameplayImages) {
    this.hud = new Hud(img);
    this.water = waterMask(img.flow);
    this.shimmer = document.createElement('canvas');
    this.shimmer.width = Math.round(ART_W / 2);
    this.shimmer.height = Math.round(ART_H / 2);
    this.shimmerCtx = this.shimmer.getContext('2d')!;
    // One band of light, tiled and scrolled down the falls.
    this.stripe = document.createElement('canvas');
    this.stripe.width = 1;
    this.stripe.height = 75;
    const stripeCtx = this.stripe.getContext('2d')!;
    const grad = stripeCtx.createLinearGradient(0, 0, 0, this.stripe.height);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    stripeCtx.fillStyle = grad;
    stripeCtx.fillRect(0, 0, 1, this.stripe.height);
    this.stripePattern = this.shimmerCtx.createPattern(this.stripe, 'repeat')!;
    this.bg = document.createElement('canvas');
    this.bg.className = 'layer';
    this.fx = document.createElement('canvas');
    this.fx.className = 'layer';
    root.append(this.bg, this.fx);
    this.bgCtx = this.bg.getContext('2d')!;
    this.ctx = this.fx.getContext('2d')!;
    const mk = (name: Control, label: string) => {
      const b = document.createElement('button');
      b.className = `hitbox hitbox-${name}`;
      b.setAttribute('aria-label', label);
      root.appendChild(b);
      return b;
    };
    this.hit = { left: mk('left', 'Move left'), right: mk('right', 'Move right'), pause: mk('pause', 'Pause') };
    this.cards = document.createElement('div');
    this.cards.className = 'cards';
    root.appendChild(this.cards);
    for (let i = 0; i < 64; i++) this.streaks.push({ u: Math.random() * 1.7 - 0.85, w: Math.random() * FADE_FAR_Z });
    this.place = placeHud({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    this.bindInput();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    window.addEventListener('skz-insets', () => this.layout());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'riding') this.pause();
        this.audio.suspend();
      } else this.audio.resume();
    });
  }

  // --------------------------------------------------------------- layout

  private safeArea(): Rect {
    const probe = document.createElement('div');
    probe.className = 'safe-probe';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const top = parseFloat(cs.paddingTop) || 0;
    const right = parseFloat(cs.paddingRight) || 0;
    const bottom = parseFloat(cs.paddingBottom) || 0;
    const left = parseFloat(cs.paddingLeft) || 0;
    probe.remove();
    return { x: left, y: top, w: window.innerWidth - left - right, h: window.innerHeight - top - bottom };
  }

  /**
   * The world fills the screen (the artwork is full-bleed, never stretched),
   * framed on the boy; the HUD is laid out inside the safe area. On a screen
   * shaped like the artwork the two coincide and the frame is the painting.
   */
  layout(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const safe = this.safeArea();
    const fit = Math.min(W / ART_W, H / ART_H);
    const s = Math.min(Math.max(W / ART_W, H / ART_H), fit * MAX_CROP);
    const w = ART_W * s;
    const h = ART_H * s;
    // Keep the boy where the painting puts him, without exposing an edge.
    const y = h <= H ? (H - h) / 2 : clamp(H * FOCUS - FEET[1] * s, H - h, 0);
    this.world = { x: (W - w) / 2, y, s };
    this.place = placeHud(safe);
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.bg, this.fx]) {
      c.width = Math.round(W * this.dpr);
      c.height = Math.round(H * this.dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    // Invisible touch targets exactly over the painted controls.
    const box = (b: HTMLElement, r: Rect) => {
      b.style.left = `${r.x}px`;
      b.style.top = `${r.y}px`;
      b.style.width = `${r.w}px`;
      b.style.height = `${r.h}px`;
    };
    box(this.hit.left, this.place.panels.arrow_left);
    box(this.hit.right, this.place.panels.arrow_right);
    box(this.hit.pause, this.place.panels.pause);
    // Finger travel for a full lane change, in this screen's pixels.
    this.dragPerLane = Math.max(48, window.innerWidth * 0.18);
    this.root.style.setProperty('--u', `${this.place.scale}px`);
    this.drawBackground();
    this.render();
  }

  /** The static world: drawn once per layout, under everything that moves. */
  private drawBackground(): void {
    const c = this.bgCtx;
    const W = this.bg.width;
    const H = this.bg.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    const w = this.world;
    // A soft extension of the same art fills anything the world does not cover.
    if (w.x > 0.5 || w.y > 0.5) {
      const cover = Math.max(W / ART_W, H / ART_H);
      c.save();
      c.filter = 'blur(28px) saturate(1.05)';
      c.drawImage(this.img.plate, (W - ART_W * cover) / 2, (H - ART_H * cover) / 2, ART_W * cover, ART_H * cover);
      c.restore();
    }
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.img.plate, w.x * this.dpr, w.y * this.dpr, ART_W * w.s * this.dpr, ART_H * w.s * this.dpr);
  }

  /**
   * Where the boy is drawn relative to his painted pose. He rides the rail:
   * he crosses it as he steers, leans into the turn, pushes and glides with
   * every stride, and surges forward or eases back as the pace changes.
   */
  private boyPose(): { dx: number; dy: number; angle: number; scale: number } {
    // Across the rail - the whole point of the left/right controls - plus
    // wherever the route itself has bent to at the point he has reached.
    let dx = (this.laneSpring.value + curveAt(this.track.d)) * BOY_LANE_PX;
    let dy = 0;
    let scale = 1;
    // Lean into the turn, and let the lean carry him a little further out.
    let angle = clamp(this.laneVel * 0.06, -0.22, 0.22);
    dx += clamp(this.laneVel * 0.055, -0.22, 0.22) * 34;
    if (this.state !== 'ready') {
      // Push and glide. Most of the rise and fall now comes from his knees
      // folding (see drawBoyBody); this is just the sway that goes with it.
      const push = Math.sin(this.stride);
      dy -= Math.abs(push) * 4;
      dx += push * 8;
      angle += push * 0.026;
      // Accelerating pulls him towards the viewer; braking eases him back.
      scale += this.surge * 0.05;
      dy += this.surge * 14;
    }
    if (this.staggerTime > 0) {
      const k = this.staggerTime / 0.7;
      angle += Math.sin(this.staggerTime * 34) * 0.12 * k;
      dx += Math.sin(this.staggerTime * 27) * 16 * k;
    }
    if (this.state === 'crashed') {
      const t = Math.min(1, this.crashTime * 2.2);
      const side = this.lane > 0 ? -1 : 1;
      angle += side * -0.42 * t * t;
      dy += Math.sin(Math.min(this.crashTime, 0.4) * 8) * -20 + t * 36;
      dx += side * t * 20;
    }
    return { dx, dy, angle, scale };
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    this.hit.pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.action('pause');
    });
    // The arrows let touch through to the steering gesture (a swipe may well
    // start on one); a tap is picked up on release, and a keyboard press here.
    for (const name of ['left', 'right'] as const) {
      this.hit[name].addEventListener('click', () => this.action(name));
    }
    this.bindTouchSteering();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const map: Record<string, Control | 'start'> = {
        ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Escape: 'pause', KeyP: 'pause', Space: 'start', Enter: 'start',
      };
      const a = map[e.code];
      if (!a) return;
      e.preventDefault();
      if (a === 'start') {
        if (this.state === 'ready') this.start();
        else if (this.state === 'paused') this.resume();
      } else this.action(a);
    });
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Steering is the finger, anywhere on the screen. Dragging carries him
   * across the rail as the hand moves; a flick sends him one rail over. A
   * plain tap only sets him off - it never steers, so nothing moves by
   * accident.
   */
  private bindTouchSteering(): void {
    /** Finger travel, in pixels, that carries him one full lane across. */
    const SLOP = 10; // a tap may wander this far and still be a tap
    const FLICK_MS = 260;
    const FLICK_PX = 34;
    let id: number | null = null;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let fromLane = 0;
    let steering = false;

    this.root.addEventListener('pointerdown', (e) => {
      if (id !== null) return; // one steering finger at a time
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      t0 = performance.now();
      fromLane = this.laneTarget;
      steering = false;
      this.root.setPointerCapture?.(e.pointerId);
      if (this.state === 'ready') this.start();
    });

    this.root.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0;
      if (!steering && Math.abs(dx) < SLOP) return;
      steering = true;
      if (this.state !== 'riding') return;
      // Follow the hand, but never off the rail.
      this.steerTo(fromLane + dx / this.dragPerLane);
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.root.releasePointerCapture?.(e.pointerId);
      if (this.state !== 'riding') return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      const quick = performance.now() - t0 < FLICK_MS;
      if (quick && Math.abs(dx) > FLICK_PX && Math.abs(dx) > Math.abs(dy)) {
        // A flick: one rail over from where the hand started.
        this.steerTo(Math.round(fromLane) + Math.sign(dx));
      } else if (steering) {
        // A drag: settle onto the rail he is closest to.
        this.steerTo(Math.round(this.laneTarget));
      } else {
        // A tap that never moved. On a painted arrow it still steers, so the
        // buttons in the artwork work - but they are not how you normally play.
        const on = this.arrowAt(x0, y0);
        if (on) this.action(on);
      }
    };
    this.root.addEventListener('pointerup', release);
    this.root.addEventListener('pointercancel', release);
  }

  /** Which painted arrow, if any, a point lands on. */
  private arrowAt(x: number, y: number): 'left' | 'right' | null {
    for (const [name, panel] of [['left', this.place.panels.arrow_left], ['right', this.place.panels.arrow_right]] as const) {
      const rx = panel.x + panel.w / 2;
      const ry = panel.y + panel.h / 2;
      const r = panel.w / 2;
      if ((x - rx) ** 2 + (y - ry) ** 2 <= r * r) return name;
    }
    return null;
  }

  /** Steer towards a lane, continuously - he is carried, never teleported. */
  steerTo(target: number): void {
    const next = clamp(target, -1, 1);
    if (next === this.laneTarget) return;
    const was = this.lane;
    this.laneTarget = next;
    this.lane = Math.round(next) as Lane;
    if (this.lane !== was) this.audio.whoosh(this.lane > was ? 1 : -1);
  }

  action(name: Control): void {
    this.press[name] = 0.16;
    if (name === 'pause') {
      if (this.state === 'riding') this.pause();
      else if (this.state === 'paused') this.resume();
      return;
    }
    if (this.state === 'ready') this.start();
    if (this.state !== 'riding') return;
    const dir = name === 'left' ? -1 : 1;
    const next = clamp(Math.round(this.laneTarget) + dir, -1, 1) as Lane;
    if (next === this.lane) {
      this.audio.blocked();
      return;
    }
    this.steerTo(next);
  }

  // ----------------------------------------------------------------- flow

  start(): void {
    if (this.state !== 'ready') return;
    this.audio.unlock();
    this.state = 'riding';
    this.rideTime = 0;
  }

  pause(): void {
    if (this.state !== 'riding') return;
    this.state = 'paused';
    this.audio.ride(0, false);
    this.showCard(
      `<h2>PAUSED</h2>
       <button class="btn" data-action="resume">RESUME</button>
       <button class="btn blue small" data-action="restart">RESTART</button>`,
      { resume: () => this.resume(), restart: () => this.reset() },
    );
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.hideCard();
    this.audio.unlock();
    this.state = 'riding';
    this.lastFrame = performance.now();
  }

  /**
   * Something was clipped. A safe ride absorbs it and he rides on with the
   * pace knocked out of him; without one the run ends.
   */
  private takeHit(): void {
    if (this.invuln > 0) return;
    if (this.shield > 0) {
      this.shield--;
      this.invuln = 1.1;
      this.staggerTime = 0.7;
      this.track.stagger();
      this.shake = 0.7;
      this.blueFlash = 1;
      this.audio.blocked();
      return;
    }
    this.crash();
  }

  /** A new stretch of the route: name it briefly, then get out of the way. */
  private enterSection(i: number): void {
    this.banner = { text: SECTIONS[i].name, time: 2.4 };
    this.audio.click();
  }

  /** He rode the route out. */
  private finish(): void {
    if (this.state !== 'riding') return;
    this.state = 'finished';
    this.audio.ride(0, false);
    this.banner = { text: '', time: 0 };
    this.showCard(
      `<h2>LEVEL 12 COMPLETE</h2>
       <div class="stats"><span>SCORE</span><span>${formatScore(this.score)}</span><span>COINS</span><span>${this.coins - ART_VALUES.coins}</span><span>TIME</span><span>${formatTime(this.seconds - ART_VALUES.seconds)}</span></div>
       <button class="btn" data-action="again">RIDE AGAIN</button>`,
      { again: () => this.reset() },
    );
  }

  private crash(): void {
    this.state = 'crashed';
    this.crashTime = 0;
    this.track.halt();
    this.shake = 1;
    this.redFlash = 1;
    this.audio.crash();
  }

  /** Back to the opening frame: the artwork, exactly as painted. */
  reset(): void {
    this.hideCard();
    this.track.reset();
    this.state = 'ready';
    this.score = ART_VALUES.score;
    this.coins = ART_VALUES.coins;
    this.seconds = ART_VALUES.seconds;
    this.lane = 0;
    this.laneTarget = 0;
    this.laneSpring.reset(0);
    this.laneVel = 0;
    this.time = 0;
    this.rideTime = 0;
    this.sparks = [];
    this.flying = [];
    this.shield = 0;
    this.invuln = 0;
    this.staggerTime = 0;
    this.banner = { text: '', time: 0 };
    this.shake = 0;
    this.redFlash = 0;
    this.blueFlash = 0;
    this.render();
  }

  private showCard(html: string, actions: Record<string, () => void>): void {
    this.cards.innerHTML = `<div class="dim"><div class="card">${html}</div></div>`;
    for (const [k, fn] of Object.entries(actions)) {
      this.cards.querySelector(`[data-action="${k}"]`)?.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.audio.click();
        fn();
      });
    }
    this.cards.querySelector('.dim')?.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private hideCard(): void {
    this.cards.innerHTML = '';
  }

  // ----------------------------------------------------------------- loop

  run(): void {
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (!this.manualTime) this.update(dt);
      this.render();
    };
    requestAnimationFrame(frame);
  }

  update(dt: number): void {
    for (const k of ['left', 'right', 'pause'] as const) this.press[k] = Math.max(0, this.press[k] - dt);
    if (this.state === 'paused' || this.state === 'ready' || this.state === 'finished') return;
    this.banner.time = Math.max(0, this.banner.time - dt);
    this.time += dt;
    const riding = this.state === 'riding';
    const prevLane = this.laneSpring.value;
    this.laneSpring.update(this.laneTarget, 0.085, dt);
    this.laneVel = dt > 0 ? (this.laneSpring.value - prevLane) / dt : 0;
    for (const ev of this.track.update(dt, this.laneSpring.value, riding)) {
      if (ev.type === 'coin') this.collect(ev.item);
      else if (ev.type === 'crash') this.takeHit();
      else if (ev.type === 'section') this.enterSection(ev.section ?? 0);
      else if (ev.type === 'finish') this.finish();
      else {
        this.blueFlash = 1;
        this.score += ev.superBoost ? 500 : 100;
        this.audio.boost();
        if (ev.superBoost) {
          // A full chain of chevrons: super speed, and a safe ride in hand.
          this.shield = Math.min(1, this.shield + 1);
          this.shake = Math.max(this.shake, 0.35);
        }
      }
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.staggerTime = Math.max(0, this.staggerTime - dt);
    // Locomotion: he pushes along the rail, and feels every change of pace.
    const v = this.track.speed * (this.track.boosting ? 1.4 : 1);
    this.stride += dt * (1.1 + v * 1.5);
    const accel = dt > 0 ? (v - this.prevSpeed) / dt : 0;
    this.prevSpeed = v;
    this.surge += (clamp(accel * 0.5, -1, 1) - this.surge) * Math.min(1, dt * 6);
    if (riding) {
      this.rideTime += dt;
      this.seconds += dt;
      this.score += this.track.speed * dt * 34 * (this.track.boosting ? 1.5 : 1);
    }
    if (this.state === 'crashed') {
      this.crashTime += dt;
      if (this.crashTime >= 1.1 && this.crashTime - dt < 1.1) {
        this.showCard(
          `<h2 class="red">WIPEOUT!</h2>
           <div class="stats"><span>SCORE</span><span>${formatScore(this.score)}</span><span>COINS</span><span>${this.coins}</span><span>TIME</span><span>${formatTime(this.seconds)}</span></div>
           <button class="btn" data-action="retry">TRY AGAIN</button>`,
          { retry: () => this.reset() },
        );
      }
    }
    // The light streaks on the rail travel with the ride.
    for (const st of this.streaks) {
      if (st.w - this.track.d < 0.3) {
        st.w = this.track.d + FADE_FAR_Z + Math.random() * 0.6;
        st.u = Math.random() * 1.7 - 0.85;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.redFlash = Math.max(0, this.redFlash - dt * 1.4);
    this.blueFlash = Math.max(0, this.blueFlash - dt * 2.2);
    for (const s of this.sparks) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.exp(-3 * dt);
      s.vy = s.vy * Math.exp(-3 * dt) + 120 * dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const f of this.flying) f.t += dt / 0.5;
    const landed = this.flying.filter((f) => f.t >= 1).length;
    this.flying = this.flying.filter((f) => f.t < 1);
    if (landed) this.coins += landed;
    this.audio.ride(this.track.speed * 9, riding);
  }

  private collect(item: Item): void {
    const x = laneX(this.track.curvedLane(item.w, item.lane), HIT_Z);
    const y = railY(HIT_Z);
    this.score += 25;
    this.audio.coin();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 240;
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.45, max: 0.45, size: 8 + Math.random() * 12 });
    }
    // The flight to the counter happens on the screen, not in the world.
    this.flying.push({ x0: this.world.x + x * this.world.s, y0: this.world.y + y * this.world.s, t: 0 });
  }

  // --------------------------------------------------------------- render

  render(): void {
    const c = this.ctx;
    const w = this.world;
    const d = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.fx.width, this.fx.height);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';

    // ---- the world, in the artwork's own pixels
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 16 * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 16 * this.shake : 0;
    // The camera leans into the ride; the painted world follows it as one.
    const cam = this.camera();
    const cs = w.s * cam.zoom;
    const ox = w.x + w.s * ((1 - cam.zoom) * (ART_W / 2) + cam.x * cam.zoom) + sx * w.s;
    const oy = w.y + w.s * ((1 - cam.zoom) * (ART_H / 2) + cam.y * cam.zoom) + sy * w.s;
    this.applyCameraToPlate(cam);
    c.save();
    c.setTransform(d * cs, 0, 0, d * cs, d * ox, d * oy);
    c.beginPath();
    c.rect(0, 0, ART_W, ART_H);
    c.clip();
    if (this.shake > 0) c.drawImage(this.img.plate, 0, 0);
    this.drawWaterfalls(c);
    this.drawStreaks(c);
    // Everything he did not catch keeps coming and sweeps past the viewer, so
    // the ride reads as travel. Anything nearer than the boy passes in front.
    const items = this.track.visible();
    let boyDrawn = false;
    for (const it of items) {
      const z = this.track.z(it);
      if (!boyDrawn && z <= HIT_Z) {
        this.drawBoy(c);
        boyDrawn = true;
      }
      this.drawItem(c, it, z);
    }
    if (!boyDrawn) this.drawBoy(c);
    this.drawBoostGlow(c);
    this.drawShield(c);
    this.drawSparks(c);
    c.restore();

    // ---- the HUD, in the safe area
    c.setTransform(d, 0, 0, d, 0, 0);
    this.hud.draw(c, this.place, this.score, this.coins, this.seconds, this.track.boostChain, this.track.superCharged, {
      arrow_left: this.press.left,
      arrow_right: this.press.right,
      pause: this.press.pause,
    });
    this.drawFlyingCoins(c);
    this.drawBanner(c);
    if (this.redFlash > 0) this.vignette(c, `rgba(255, 30, 40, ${0.55 * this.redFlash})`);
    if (this.blueFlash > 0) this.vignette(c, `rgba(90, 200, 255, ${0.45 * this.blueFlash})`);
  }

  /**
   * The ride's camera: it eases in as he sets off, presses closer as he picks
   * up speed, and sways after him through a lane change. It never pulls back
   * past the painting's own framing, so no edge is ever exposed.
   */
  private camera(): { x: number; y: number; zoom: number } {
    if (this.state === 'ready') return { x: 0, y: 0, zoom: 1 };
    const ramp = clamp(this.rideTime / 0.9, 0, 1);
    const pace = clamp((this.track.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
    const zoom = 1 + ramp * (0.035 + 0.03 * pace + (this.track.boosting ? 0.02 : 0));
    // The sway stays inside the margin the zoom opens up.
    const margin = ((zoom - 1) * ART_W) / 2;
    return { x: clamp(this.laneSpring.value * BOY_LANE_PX * 0.14, -margin, margin), y: 0, zoom };
  }

  /** The static plate rides the camera as a composited transform, not a redraw. */
  private applyCameraToPlate(cam: { x: number; y: number; zoom: number }): void {
    const w = this.world;
    const still = cam.zoom === 1 && cam.x === 0 && cam.y === 0;
    this.bg.style.transformOrigin = `${w.x + (ART_W * w.s) / 2}px ${w.y + (ART_H * w.s) / 2}px`;
    this.bg.style.transform = still
      ? ''
      : `translate(${cam.x * w.s * cam.zoom}px, ${cam.y * w.s * cam.zoom}px) scale(${cam.zoom})`;
  }

  /**
   * The painted waterfalls run: a scrolling band of light, kept inside the
   * falls by the flow mask cut from the artwork, so no other pixel moves.
   */
  private drawWaterfalls(c: CanvasRenderingContext2D): void {
    if (this.state === 'ready') return;
    const s = this.shimmer;
    const sc = this.shimmerCtx;
    const period = this.stripe.height;
    const off = (this.time * 110) % period;
    this.stripePattern.setTransform(new DOMMatrix().translateSelf(0, off - period));
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'copy';
    sc.fillStyle = this.stripePattern;
    sc.fillRect(0, 0, s.width, s.height);
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(this.water, 0, 0, s.width, s.height);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.3;
    c.drawImage(s, 0, 0, ART_W, ART_H);
    c.restore();
  }

  private drawStreaks(c: CanvasRenderingContext2D): void {
    if (this.state !== 'riding') return;
    const boost = this.track.boosting ? 1.6 : 1;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (const st of this.streaks) {
      const z0 = st.w - this.track.d;
      // Longer streaks the faster he goes: the rail rushing under his skates.
      const z1 = z0 + 0.1 * boost * (1 + this.track.speed * 0.45);
      if (z0 < 0.3 || z0 > FADE_FAR_Z) continue;
      const y0 = surfaceY(z0);
      const y1 = surfaceY(z1);
      const x0 = centreX(y0) + st.u * halfWidth(y0);
      const x1 = centreX(y1) + st.u * halfWidth(y1);
      const a = 0.5 * fadeIn(z0) * Math.min(1, (z0 - 0.3) * 3) * boost * Math.min(1, this.rideTime / 0.8);
      c.strokeStyle = `rgba(255, 246, 214, ${a})`;
      c.lineWidth = 3.4 / z0;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    }
    c.restore();
  }

  private drawItem(c: CanvasRenderingContext2D, it: Item, z: number): void {
    const alpha = fadeIn(z);
    if (alpha <= 0) return;
    c.save();
    c.globalAlpha = it.state === 'hit' ? 1 : alpha;
    if (it.kind === 'coin') {
      const i = it.artIndex;
      // A painted coin starts exactly where and as it is painted, then travels;
      // every coin after the painted trail is the nearest one, completed.
      const art = i !== undefined ? L.coins[i] : L.coinMaster;
      const sprite = i !== undefined ? this.img.coins[i] : this.img.coin;
      const zArt = i !== undefined ? ART_Z[i] : 1;
      const scale = zArt / z;
      // The coin's centre within its own sprite.
      const lx = i !== undefined ? art.cx - L.coins[i].x : L.coinMaster.cx;
      const ly = i !== undefined ? art.cy - L.coins[i].y : L.coinMaster.cy;
      // railY(zArt) is the painted coin's own row, so only x needs the nudge
      // from the rail's centre line onto the painted trail.
      const offX = i !== undefined ? (art.cx - laneX(0, zArt)) * scale : 0;
      const lane = this.track.curvedLane(it.w, it.lane);
      // A gentle spin; painted coins ease into it as they set off.
      const travelled = i !== undefined ? clamp((zArt - z) * 2, 0, 1) : 1;
      const spin = 1 - travelled * 0.14 * (1 - Math.cos(this.time * 3 + it.id));
      c.translate(laneX(lane, z) + offX, railY(z));
      c.scale(scale * spin, scale);
      c.drawImage(sprite, -lx, -ly);
    } else {
      const sprite = it.kind === 'gate' ? this.img.blockX : this.img.blockChevron;
      const w = BLOCK_W / z;
      const s = w / sprite.width;
      const h = sprite.height * s;
      const x = laneX(this.track.curvedLane(it.w, it.lane), z);
      const bottom = surfaceY(z);
      c.drawImage(sprite, x - w / 2, bottom - h, w, h);
      if (it.state === 'boosted') {
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.4;
        c.drawImage(sprite, x - w / 2, bottom - h, w, h);
      }
    }
    c.restore();
  }

  /** The boy and the light trail off his skates, both cut from the artwork. */
  private drawBoy(c: CanvasRenderingContext2D): void {
    const { dx, dy, angle, scale } = this.boyPose();
    const t = L.trail;
    // The jet plume is welded to his boots: it moves with him exactly at the
    // nozzles and only falls behind further down, where it is washing away
    // towards the viewer.
    c.save();
    const lag = 0.55 / (ART_H - FEET[1]);
    c.transform(1, 0, -dx * lag, 1, dx * (1 + lag * FEET[1]), 0);
    c.drawImage(this.img.trail, t.x, t.y);
    c.restore();
    c.save();
    c.translate(FEET[0] + dx, FEET[1] + dy);
    c.rotate(angle);
    c.scale(scale, scale);
    c.translate(-FEET[0], -FEET[1]);
    this.drawBoyBody(c);
    c.restore();
  }

  /**
   * The boy himself, drawn as a stack of thin slices of his own painted
   * pixels. Nothing is redrawn: the slices are nudged against each other so
   * that his knees take the push of each stride with his boots planted on the
   * rail, and his upper body leads the turn while his feet follow it.
   */
  private drawBoyBody(c: CanvasRenderingContext2D): void {
    const B = L.boy;
    const N = 26;
    const band = B.h / N;
    // How hard he is pushing through the stride, and how hard he is turning.
    const push = this.state === 'ready' ? 0 : (1 - Math.cos(this.stride * 2)) / 2;
    const lead = clamp(this.laneVel * 0.5, -1, 1);
    const twist = this.state === 'ready' ? 0 : Math.sin(this.stride);

    // A slice's height shrinks where his legs fold - most at the knee.
    const heights: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = (i + 0.5) / N;
      const knee = Math.exp(-(((v - KNEE_V) / 0.14) ** 2)); // bell around the knee
      heights.push(band * (1 - push * 0.09 * knee));
    }
    // Stack them up from his boots, which stay on the rail.
    const tops: number[] = new Array(N);
    let y = B.y + B.h;
    for (let i = N - 1; i >= 0; i--) {
      y -= heights[i];
      tops[i] = y;
    }
    for (let i = 0; i < N; i++) {
      const v = (i + 0.5) / N;
      // His shoulders lead the turn; his boots stay with the rail. His torso
      // counter-rotates a little with each push, as a skater's does.
      const above = Math.max(0, 1 - v / FEET_V);
      const sway = lead * 13 * above * above + twist * 2.6 * above * (1 - above) * 4;
      c.drawImage(
        this.img.boy,
        0, i * band, B.w, band + 1,
        B.x + sway, tops[i], B.w, heights[i] + 1,
      );
    }
  }

  private drawBoostGlow(c: CanvasRenderingContext2D): void {
    if (!this.track.boosting && !this.track.superCharged && this.blueFlash <= 0) return;
    // Stays under his skates, wherever the stride and the lean have put them.
    const pose = this.boyPose();
    const x = FEET[0] + pose.dx;
    const y = FEET[1] + pose.dy - 40;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const superb = this.track.superCharged;
    const r = superb ? 250 : 180;
    const g = c.createRadialGradient(x, y, 8, x, y, r);
    const a = (this.track.boosting || superb ? 0.45 + 0.15 * Math.sin(this.time * 30) : 0.3 * this.blueFlash) * (superb ? 1.4 : 1);
    g.addColorStop(0, superb ? `rgba(235, 250, 255, ${a})` : `rgba(170, 240, 255, ${a})`);
    g.addColorStop(1, 'rgba(60, 160, 255, 0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
    c.restore();
  }

  /** A safe ride in hand: a shell around him, shown in the world not the HUD. */
  private drawShield(c: CanvasRenderingContext2D): void {
    if (this.shield <= 0 && this.invuln <= 0) return;
    const pose = this.boyPose();
    const x = FEET[0] + pose.dx;
    const y = FEET[1] + pose.dy - 230;
    const rx = 250;
    const ry = 310;
    // It flares as it takes the hit, then settles to a steady shimmer.
    const burst = this.invuln > 0 && this.shield <= 0 ? this.invuln / 1.1 : 0;
    const a = (0.16 + 0.05 * Math.sin(this.time * 6)) * (this.shield > 0 ? 1 : 0) + burst * 0.5;
    if (a <= 0.005) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.translate(x, y);
    c.scale(1, ry / rx);
    const g = c.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx);
    g.addColorStop(0, 'rgba(120, 220, 255, 0)');
    g.addColorStop(0.82, `rgba(150, 230, 255, ${a})`);
    g.addColorStop(1, 'rgba(90, 180, 255, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, rx, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private drawSparks(c: CanvasRenderingContext2D): void {
    if (!this.sparks.length) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const k = s.life / s.max;
      const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size);
      g.addColorStop(0, `rgba(255, 250, 200, ${k})`);
      g.addColorStop(0.4, `rgba(255, 200, 60, ${0.6 * k})`);
      g.addColorStop(1, 'rgba(255, 160, 0, 0)');
      c.fillStyle = g;
      c.fillRect(s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
    }
    c.restore();
  }

  /** Collected coins fly, on screen, into the painted coin counter. */
  private drawFlyingCoins(c: CanvasRenderingContext2D): void {
    if (!this.flying.length) return;
    const m = L.coinMaster;
    const target = this.place.coinIcon;
    for (const f of this.flying) {
      const t = f.t;
      const e = t * t * (3 - 2 * t);
      const x = f.x0 + (target.x - f.x0) * e;
      const y = f.y0 + (target.y - f.y0) * e - Math.sin(Math.PI * t) * 130 * this.place.scale;
      const s = (1.4 - t) * 0.5 * this.place.scale;
      c.save();
      c.globalAlpha = t < 0.85 ? 1 : (1 - t) / 0.15;
      c.translate(x, y);
      c.scale(s, s);
      c.drawImage(this.img.coin, -m.cx, -m.cy);
      c.restore();
    }
  }

  /** The name of the stretch he has just entered, then it gets out of the way. */
  private drawBanner(c: CanvasRenderingContext2D): void {
    if (this.banner.time <= 0) return;
    const t = this.banner.time / 2.4;
    // Fade in quickly, hold, fade out.
    const a = Math.min(1, Math.min(t * 6, (1 - t) * 4));
    if (a <= 0.01) return;
    const u = this.place.scale;
    const x = window.innerWidth / 2;
    const y = this.place.panels.score.y + this.place.panels.score.h + 92 * u;
    c.save();
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 ${34 * u}px Montserrat, Roboto, Arial, sans-serif`;
    c.lineJoin = 'round';
    c.lineWidth = 7 * u;
    c.strokeStyle = 'rgba(8, 20, 60, 0.7)';
    c.strokeText(this.banner.text, x, y);
    const g = c.createLinearGradient(0, y - 20 * u, 0, y + 20 * u);
    g.addColorStop(0, '#fffbc2');
    g.addColorStop(0.5, '#ffd940');
    g.addColorStop(1, '#f29a00');
    c.fillStyle = g;
    c.fillText(this.banner.text, x, y);
    c.restore();
  }

  private vignette(c: CanvasRenderingContext2D, color: string): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, color);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  /** Where a point of the artwork currently lands on the screen. */
  private toScreen(px: number, py: number): { x: number; y: number } {
    const w = this.world;
    const cam = this.camera();
    const s = w.s * cam.zoom;
    return {
      x: w.x + w.s * ((1 - cam.zoom) * (ART_W / 2) + cam.x * cam.zoom) + s * px,
      y: w.y + w.s * ((1 - cam.zoom) * (ART_H / 2) + cam.y * cam.zoom) + s * py,
    };
  }

  /** Snapshot for tests / debugging. */
  snapshot() {
    const pose = this.boyPose();
    const feet = this.toScreen(FEET[0] + pose.dx, FEET[1] + pose.dy);
    return {
      // Where the player's character actually is on the screen, right now.
      boy: { x: feet.x, y: feet.y, lean: pose.angle, scale: pose.scale },
      /** Items that have swept past him and are rushing at the viewer. */
      passing: this.track.items.filter((it) => this.track.z(it) < HIT_Z).length,
      state: this.state,
      section: this.track.section,
      sectionName: SECTIONS[this.track.section].name,
      progress: this.track.progress,
      levelLength: LEVEL_LENGTH,
      shield: this.shield,
      boostChain: this.track.boostChain,
      superCharged: this.track.superCharged,
      lane: this.lane,
      lanePos: this.laneSpring.value,
      d: this.track.d,
      speed: this.track.speed,
      score: Math.floor(this.score),
      coins: this.coins,
      seconds: this.seconds,
      items: this.track.items.length,
      world: this.world,
      hud: this.place,
    };
  }
}
