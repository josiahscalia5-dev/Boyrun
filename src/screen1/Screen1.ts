import { Audio } from '../core/Audio';
import { clamp, Spring1 } from '../core/MathUtil';
import { LAYERS, Screen1Images } from './Assets';
import { ART_VALUES, formatScore, formatTime, HudText } from './HudText';
import {
  BLOCK_W,
  BOY_LANE_PX,
  BOY_Z,
  centreX,
  COIN_R,
  coinY,
  fadeIn,
  FADE_FAR_Z,
  HIT_Z,
  IMAGE_H,
  IMAGE_W,
  laneX,
  RAIL_HALF_PX,
  surfaceY,
  zFromCoinY,
} from './Perspective';
import { Item, Lane, Track } from './Track';

export type Screen1State = 'ready' | 'riding' | 'paused' | 'crashed';

interface Rect {
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

interface FlyCoin {
  x0: number;
  y0: number;
  t: number;
}

interface Streak {
  u: number;
  w: number;
}

const COIN_ICON = { x: 54, y: 186 };
const FEET = LAYERS.boy.feet as [number, number];

/**
 * SCREEN 1 - GAMEPLAY. The supplied artwork is the screen: the app opens on
 * the exact image; riding swaps the static painting for its own layers
 * (plate + boy + coins + HUD, all cut from the same image) so that coins,
 * gates and boosts can move and the boy can respond to the controls.
 */
export class Screen1 {
  state: Screen1State = 'ready';
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
  private readonly hudText: HudText;
  private readonly hit: Record<'left' | 'right' | 'pause', HTMLButtonElement>;
  private readonly cards: HTMLElement;
  private rect: Rect = { x: 0, y: 0, s: 1 };
  private dpr = 1;
  private readonly laneSpring = new Spring1(0);
  private laneVel = 0;
  private time = 0;
  private crashTime = 0;
  private shake = 0;
  private redFlash = 0;
  private blueFlash = 0;
  private press: Record<'left' | 'right' | 'pause', number> = { left: 0, right: 0, pause: 0 };
  private sparks: Spark[] = [];
  private flying: FlyCoin[] = [];
  private streaks: Streak[] = [];
  private lastFrame = 0;
  /** artwork = the supplied image; coins = image without the coin trail; full = image without boy and coins. */
  private base: 'artwork' | 'coins' | 'full' = 'artwork';
  private rideTime = 0;

  constructor(private readonly root: HTMLElement, private readonly img: Screen1Images) {
    this.hudText = new HudText(img);
    this.bg = document.createElement('canvas');
    this.bg.className = 'layer';
    this.fx = document.createElement('canvas');
    this.fx.className = 'layer';
    root.append(this.bg, this.fx);
    this.bgCtx = this.bg.getContext('2d')!;
    this.ctx = this.fx.getContext('2d')!;
    const mk = (name: 'left' | 'right' | 'pause', label: string) => {
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
    for (let i = 0; i < 28; i++) this.streaks.push({ u: Math.random() * 1.7 - 0.85, w: Math.random() * FADE_FAR_Z });
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

  /**
   * Fit the whole artwork (never cropped, never stretched) inside the safe
   * area; the rest of the screen shows a soft extension of the same art.
   */
  layout(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const probe = document.createElement('div');
    probe.className = 'safe-probe';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const inset = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
    probe.remove();
    const aw = W - inset.left - inset.right;
    const ah = H - inset.top - inset.bottom;
    const s = Math.min(aw / IMAGE_W, ah / IMAGE_H);
    const w = IMAGE_W * s;
    const h = IMAGE_H * s;
    this.rect = { x: inset.left + (aw - w) / 2, y: inset.top + (ah - h) / 2, s };
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.bg, this.fx]) {
      c.width = Math.round(W * this.dpr);
      c.height = Math.round(H * this.dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    // Invisible hitboxes exactly over the painted controls.
    const place = (b: HTMLElement, x: number, y: number, bw: number, bh: number) => {
      b.style.left = `${this.rect.x + x * s}px`;
      b.style.top = `${this.rect.y + y * s}px`;
      b.style.width = `${bw * s}px`;
      b.style.height = `${bh * s}px`;
    };
    const [lx, ly, lr] = LAYERS.arrows.left;
    const [rx, ry, rr] = LAYERS.arrows.right;
    place(this.hit.left, lx - lr, ly - lr, lr * 2, lr * 2);
    place(this.hit.right, rx - rr, ry - rr, rr * 2, rr * 2);
    const pz = LAYERS.hud.pause;
    place(this.hit.pause, pz[0], pz[1], pz[2] - pz[0], pz[3] - pz[1]);
    this.root.style.setProperty('--u', `${s}px`);
    this.drawBackground();
    this.render();
  }

  private drawBackground(): void {
    const c = this.bgCtx;
    const W = this.bg.width;
    const H = this.bg.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    // Soft extension of the artwork behind system bars / beyond its edges.
    const cover = Math.max(W / IMAGE_W, H / IMAGE_H);
    c.save();
    c.filter = 'blur(24px) saturate(1.05)';
    c.drawImage(this.img.screen, (W - IMAGE_W * cover) / 2, (H - IMAGE_H * cover) / 2, IMAGE_W * cover, IMAGE_H * cover);
    c.restore();
    const r = this.rect;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.baseImage(), r.x * this.dpr, r.y * this.dpr, IMAGE_W * r.s * this.dpr, IMAGE_H * r.s * this.dpr);
  }

  private baseImage(): HTMLImageElement {
    return this.base === 'artwork' ? this.img.screen : this.base === 'coins' ? this.img.plateCoins : this.img.plate;
  }

  private setBase(base: 'artwork' | 'coins' | 'full'): void {
    if (this.base === base) return;
    this.base = base;
    this.drawBackground();
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
      dy += Math.sin(Math.min(this.crashTime, 0.4) * 8) * -10 + t * 18;
      dx += side * t * 10;
    }
    return { dx, dy, angle };
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const down = (name: 'left' | 'right' | 'pause') => (e: PointerEvent) => {
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
      const map: Record<string, 'left' | 'right' | 'pause' | 'start'> = {
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

  action(name: 'left' | 'right' | 'pause'): void {
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
    this.setBase('coins');
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

  /** Back to the opening frame: the exact supplied artwork. */
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
    this.sparks = [];
    this.flying = [];
    this.shake = 0;
    this.redFlash = 0;
    this.blueFlash = 0;
    this.setBase('artwork');
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
    const events = this.track.update(dt, this.laneSpring.value, riding);
    for (const ev of events) {
      if (ev.type === 'coin') this.collect(ev.item);
      else if (ev.type === 'crash') this.crash();
      else {
        this.blueFlash = 1;
        this.score += 100;
        this.audio.boost();
      }
    }
    // While the boy is in his painted pose, keep his painted pixels exactly.
    const pose = this.boyPose();
    const atRest = Math.abs(pose.dx) < 0.05 && Math.abs(pose.angle) < 0.0005 && Math.abs(pose.dy) < 0.05;
    this.setBase(atRest ? 'coins' : 'full');
    if (riding) {
      this.rideTime += dt;
      this.seconds += dt;
      this.score += this.track.speed * dt * 38 * (this.track.boosting ? 1.5 : 1);
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
    // Rail flow streaks travel with the ride.
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
      s.vy = s.vy * Math.exp(-3 * dt) + 60 * dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const f of this.flying) f.t += dt / 0.5;
    const landed = this.flying.filter((f) => f.t >= 1).length;
    this.flying = this.flying.filter((f) => f.t < 1);
    if (landed) this.coins += landed;
    this.audio.ride(this.track.speed * 14, riding);
  }

  private collect(item: Item): void {
    const z = HIT_Z;
    const x = laneX(item.lane, z);
    const y = coinY(z);
    this.score += 25;
    this.audio.coin();
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 120;
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.45, max: 0.45, size: 4 + Math.random() * 6 });
    }
    this.flying.push({ x0: x, y0: y, t: 0 });
  }

  // --------------------------------------------------------------- render

  render(): void {
    const c = this.ctx;
    const r = this.rect;
    const d = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.fx.width, this.fx.height);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 8 * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 8 * this.shake : 0;
    c.setTransform(d * r.s, 0, 0, d * r.s, d * (r.x + sx * r.s), d * (r.y + sy * r.s));
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.save();
    c.beginPath();
    c.rect(0, 0, IMAGE_W, IMAGE_H);
    c.clip();

    if (this.base !== 'artwork') {
      if (this.shake > 0) {
        // The plate moves with the shake too.
        c.drawImage(this.baseImage(), 0, 0);
      }
      this.drawStreaks(c);
      // Anything the boy did not catch slips away behind him at his depth;
      // the gate he crashed into stays just in front of him.
      const items = this.track.visible().filter((it) => it.state === 'hit' || this.track.z(it) > HIT_Z);
      let boyDrawn = false;
      for (const it of items) {
        const z = this.track.z(it);
        if (!boyDrawn && z < BOY_Z && it.state !== 'hit') {
          this.drawBoy(c);
          boyDrawn = true;
        }
        this.drawItem(c, it, z);
      }
      if (!boyDrawn) this.drawBoy(c);
      this.drawBoostGlow(c);
      this.drawSparks(c);
    }

    // Painted HUD always on top of the moving world.
    c.drawImage(this.img.hud, 0, 0);
    this.hudText.draw(c, this.score, this.coins, this.seconds);
    this.drawPressFeedback(c);
    this.drawFlyingCoins(c);
    if (this.redFlash > 0) this.vignette(c, `rgba(255, 30, 40, ${0.55 * this.redFlash})`);
    if (this.blueFlash > 0) this.vignette(c, `rgba(90, 200, 255, ${0.45 * this.blueFlash})`);
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
      const x0 = centreX(y0) + (st.u * RAIL_HALF_PX) / z0;
      const x1 = centreX(y1) + (st.u * RAIL_HALF_PX) / z1;
      const a = 0.38 * fadeIn(z0) * Math.min(1, (z0 - 0.3) * 3) * boost * Math.min(1, this.rideTime / 0.8);
      c.strokeStyle = `rgba(255, 246, 214, ${a})`;
      c.lineWidth = 1.3 / z0;
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
      const art = it.artIndex ?? 0;
      const L = LAYERS.coins[art];
      const sprite = this.img.coins[art];
      // Painted coins start exactly where they are painted, then approach.
      const z0 = it.artIndex !== undefined ? zFromCoinY(L.cy) : 1;
      const scale = it.artIndex !== undefined ? z0 / z : COIN_R / L.r / z;
      const baseX = laneX(it.lane, z);
      const baseY = coinY(z);
      const offX = it.artIndex !== undefined ? (L.cx - laneX(0, z0)) * (z0 / z) : 0;
      const offY = it.artIndex !== undefined ? (L.cy - coinY(z0)) * (z0 / z) : 0;
      const cx = baseX + offX;
      const cy = baseY + offY;
      // Gentle spin; painted coins start exactly as painted and ease into it.
      const travelled = it.artIndex !== undefined ? clamp((z0 - z) * 2, 0, 1) : 1;
      const spin = 1 - travelled * 0.14 * (1 - Math.cos(this.time * 3 + it.id));
      c.translate(cx, cy);
      c.scale(scale * spin, scale);
      c.drawImage(sprite, L.x - L.cx, L.y - L.cy);
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

  private drawBoy(c: CanvasRenderingContext2D): void {
    const B = LAYERS.boy;
    const { dx, dy, angle } = this.boyPose();
    c.save();
    c.translate(FEET[0] + dx, FEET[1] + dy);
    c.rotate(angle);
    c.translate(-FEET[0], -FEET[1]);
    c.drawImage(this.img.boy, B.x, B.y);
    c.restore();
  }

  private drawBoostGlow(c: CanvasRenderingContext2D): void {
    if (!this.track.boosting && this.blueFlash <= 0) return;
    const x = FEET[0] + this.laneSpring.value * BOY_LANE_PX;
    const y = FEET[1] - 20;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(x, y, 4, x, y, 90);
    const a = this.track.boosting ? 0.45 + 0.15 * Math.sin(this.time * 30) : 0.3 * this.blueFlash;
    g.addColorStop(0, `rgba(170, 240, 255, ${a})`);
    g.addColorStop(1, 'rgba(60, 160, 255, 0)');
    c.fillStyle = g;
    c.fillRect(x - 90, y - 90, 180, 180);
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

  private drawFlyingCoins(c: CanvasRenderingContext2D): void {
    const L = LAYERS.coins[0];
    for (const f of this.flying) {
      const t = f.t;
      const e = t * t * (3 - 2 * t);
      const x = f.x0 + (COIN_ICON.x - f.x0) * e;
      const y = f.y0 + (COIN_ICON.y - f.y0) * e - Math.sin(Math.PI * t) * 70;
      const s = (1.4 - t) * 0.55;
      c.save();
      c.globalAlpha = t < 0.85 ? 1 : (1 - t) / 0.15;
      c.translate(x, y);
      c.scale(s, s);
      c.drawImage(this.img.coins[0], L.x - L.cx, L.y - L.cy);
      c.restore();
    }
  }

  private drawPressFeedback(c: CanvasRenderingContext2D): void {
    const glow = (x: number, y: number, w: number, h: number, k: number) => {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.45 * k;
      c.drawImage(this.img.hud, x, y, w, h, x, y, w, h);
      c.restore();
    };
    for (const name of ['left', 'right'] as const) {
      const k = this.press[name] / 0.16;
      if (k <= 0) continue;
      const [x, y, rr] = LAYERS.arrows[name];
      glow(x - rr, y - rr, rr * 2, rr * 2, k);
    }
    if (this.press.pause > 0) {
      const p = LAYERS.hud.pause;
      glow(p[0], p[1], p[2] - p[0], p[3] - p[1], this.press.pause / 0.16);
    }
  }

  private vignette(c: CanvasRenderingContext2D, color: string): void {
    const g = c.createRadialGradient(IMAGE_W / 2, IMAGE_H / 2, IMAGE_H * 0.25, IMAGE_W / 2, IMAGE_H / 2, IMAGE_H * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, color);
    c.fillStyle = g;
    c.fillRect(0, 0, IMAGE_W, IMAGE_H);
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
      base: this.base,
      rect: this.rect,
    };
  }
}
