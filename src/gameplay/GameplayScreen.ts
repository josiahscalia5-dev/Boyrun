import { Audio } from '../core/Audio';
import { clamp, Spring1 } from '../core/MathUtil';
import { GameplayImages, L, waterMask } from './Assets';
import { ART_VALUES, formatScore, formatTime, Hud, HudPlacement, placeHud, Rect } from './Hud';
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
import { Item, Lane, Track } from './Track';

export type GameState = 'ready' | 'riding' | 'paused' | 'crashed';

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
  private readonly hit: Record<Control, HTMLButtonElement>;
  private readonly cards: HTMLElement;
  private world: World = { x: 0, y: 0, s: 1 };
  private place: HudPlacement;
  private dpr = 1;
  private readonly laneSpring = new Spring1(0);
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

  constructor(private readonly root: HTMLElement, private readonly img: GameplayImages) {
    this.hud = new Hud(img);
    this.water = waterMask(img.flow);
    this.shimmer = document.createElement('canvas');
    this.shimmer.width = Math.round(ART_W / 2);
    this.shimmer.height = Math.round(ART_H / 2);
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
    for (let i = 0; i < 34; i++) this.streaks.push({ u: Math.random() * 1.7 - 0.85, w: Math.random() * FADE_FAR_Z });
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

  /** Where the boy is drawn relative to his painted pose. */
  private boyPose(): { dx: number; dy: number; angle: number } {
    let dx = this.laneSpring.value * BOY_LANE_PX;
    let dy = 0;
    let angle = clamp(this.laneVel * 0.045, -0.16, 0.16);
    if (this.state === 'crashed') {
      const t = Math.min(1, this.crashTime * 2.2);
      const side = this.lane > 0 ? -1 : 1;
      angle += side * -0.42 * t * t;
      dy += Math.sin(Math.min(this.crashTime, 0.4) * 8) * -20 + t * 36;
      dx += side * t * 20;
    }
    return { dx, dy, angle };
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const down = (name: Control) => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.action(name);
    };
    this.hit.left.addEventListener('pointerdown', down('left'));
    this.hit.right.addEventListener('pointerdown', down('right'));
    this.hit.pause.addEventListener('pointerdown', down('pause'));
    this.root.addEventListener('pointerdown', () => {
      if (this.state === 'ready') this.start();
    });
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
    const next = clamp(this.lane + dir, -1, 1) as Lane;
    if (next === this.lane) {
      this.audio.blocked();
      return;
    }
    this.lane = next;
    this.audio.whoosh(dir);
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
    this.laneSpring.reset(0);
    this.laneVel = 0;
    this.time = 0;
    this.rideTime = 0;
    this.sparks = [];
    this.flying = [];
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
    if (this.state === 'paused' || this.state === 'ready') return;
    this.time += dt;
    const riding = this.state === 'riding';
    const prevLane = this.laneSpring.value;
    this.laneSpring.update(this.lane, 0.085, dt);
    this.laneVel = dt > 0 ? (this.laneSpring.value - prevLane) / dt : 0;
    for (const ev of this.track.update(dt, this.laneSpring.value, riding)) {
      if (ev.type === 'coin') this.collect(ev.item);
      else if (ev.type === 'crash') this.crash();
      else {
        this.blueFlash = 1;
        this.score += 100;
        this.audio.boost();
      }
    }
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
    const x = laneX(item.lane, HIT_Z);
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
    c.save();
    c.setTransform(d * w.s, 0, 0, d * w.s, d * (w.x + sx * w.s), d * (w.y + sy * w.s));
    c.beginPath();
    c.rect(0, 0, ART_W, ART_H);
    c.clip();
    if (this.shake > 0) c.drawImage(this.img.plate, 0, 0);
    this.drawWaterfalls(c);
    this.drawStreaks(c);
    // Anything the boy did not catch slips away behind him at his depth; the
    // gate he crashed into stays just in front of him.
    const items = this.track.visible().filter((it) => it.state === 'hit' || this.track.z(it) > HIT_Z);
    let boyDrawn = false;
    for (const it of items) {
      const z = this.track.z(it);
      if (!boyDrawn && z < HIT_Z && it.state !== 'hit') {
        this.drawBoy(c);
        boyDrawn = true;
      }
      this.drawItem(c, it, z);
    }
    if (!boyDrawn) this.drawBoy(c);
    this.drawBoostGlow(c);
    this.drawSparks(c);
    c.restore();

    // ---- the HUD, in the safe area
    c.setTransform(d, 0, 0, d, 0, 0);
    this.hud.draw(c, this.place, this.score, this.coins, this.seconds, {
      arrow_left: this.press.left,
      arrow_right: this.press.right,
      pause: this.press.pause,
    });
    this.drawFlyingCoins(c);
    if (this.redFlash > 0) this.vignette(c, `rgba(255, 30, 40, ${0.55 * this.redFlash})`);
    if (this.blueFlash > 0) this.vignette(c, `rgba(90, 200, 255, ${0.45 * this.blueFlash})`);
  }

  /** The painted waterfalls run, using the flow mask cut from the artwork. */
  private drawWaterfalls(c: CanvasRenderingContext2D): void {
    if (this.state === 'ready') return;
    const s = this.shimmer;
    const sc = s.getContext('2d')!;
    const k = s.height / ART_H;
    const period = 150 * k;
    const off = (this.time * 220 * k) % period;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'copy';
    const g = sc.createLinearGradient(0, off - period, 0, off);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = g;
    sc.fillRect(0, 0, s.width, s.height);
    for (let y = off; y < s.height; y += period) {
      sc.globalCompositeOperation = 'source-over';
      const g2 = sc.createLinearGradient(0, y, 0, y + period);
      g2.addColorStop(0, 'rgba(255,255,255,0)');
      g2.addColorStop(0.5, 'rgba(255,255,255,1)');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      sc.fillStyle = g2;
      sc.fillRect(0, y, s.width, period);
    }
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
      const z1 = z0 + 0.16 * boost;
      if (z0 < 0.3 || z0 > FADE_FAR_Z) continue;
      const y0 = surfaceY(z0);
      const y1 = surfaceY(z1);
      const x0 = centreX(y0) + st.u * halfWidth(y0);
      const x1 = centreX(y1) + st.u * halfWidth(y1);
      const a = 0.34 * fadeIn(z0) * Math.min(1, (z0 - 0.3) * 3) * boost * Math.min(1, this.rideTime / 0.8);
      c.strokeStyle = `rgba(255, 246, 214, ${a})`;
      c.lineWidth = 2.6 / z0;
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
      // A gentle spin; painted coins ease into it as they set off.
      const travelled = i !== undefined ? clamp((zArt - z) * 2, 0, 1) : 1;
      const spin = 1 - travelled * 0.14 * (1 - Math.cos(this.time * 3 + it.id));
      c.translate(laneX(it.lane, z) + offX, railY(z));
      c.scale(scale * spin, scale);
      c.drawImage(sprite, -lx, -ly);
    } else {
      const sprite = it.kind === 'gate' ? this.img.blockX : this.img.blockChevron;
      const w = BLOCK_W / z;
      const s = w / sprite.width;
      const h = sprite.height * s;
      const x = laneX(it.lane, z);
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
    const { dx, dy, angle } = this.boyPose();
    const t = L.trail;
    // The trail leans after him: its top follows his skates, its far end lags.
    c.save();
    const lag = 0.55 / (ART_H - t.y);
    c.transform(1, 0, -dx * lag, 1, dx * (1 + lag * t.y), 0);
    c.drawImage(this.img.trail, t.x, t.y);
    c.restore();
    c.save();
    c.translate(FEET[0] + dx, FEET[1] + dy);
    c.rotate(angle);
    c.translate(-FEET[0], -FEET[1]);
    c.drawImage(this.img.boy, L.boy.x, L.boy.y);
    c.restore();
  }

  private drawBoostGlow(c: CanvasRenderingContext2D): void {
    if (!this.track.boosting && this.blueFlash <= 0) return;
    const x = FEET[0] + this.laneSpring.value * BOY_LANE_PX;
    const y = FEET[1] - 40;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(x, y, 8, x, y, 180);
    const a = this.track.boosting ? 0.45 + 0.15 * Math.sin(this.time * 30) : 0.3 * this.blueFlash;
    g.addColorStop(0, `rgba(170, 240, 255, ${a})`);
    g.addColorStop(1, 'rgba(60, 160, 255, 0)');
    c.fillStyle = g;
    c.fillRect(x - 180, y - 180, 360, 360);
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

  private vignette(c: CanvasRenderingContext2D, color: string): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, color);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  /** Snapshot for tests / debugging. */
  snapshot() {
    return {
      state: this.state,
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
