import { ARROW_SVG, CLOCK_SVG, COIN_SVG, EMBLEM_SVG, PAUSE_SVG } from './Icons';

export function formatScore(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface FlyCoin {
  el: HTMLDivElement;
  active: boolean;
  t: number;
  x0: number;
  y0: number;
}

/**
 * The in-game HUD, laid out on the 512x1024 reference grid and scaled by
 * --u. Text is only written when values change to avoid layout churn.
 */
export class Hud {
  readonly root: HTMLElement;
  readonly leftBtn: HTMLButtonElement;
  readonly rightBtn: HTMLButtonElement;
  readonly pauseBtn: HTMLButtonElement;
  private readonly levelEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly coinsEl: HTMLElement;
  private readonly coinsRow: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly zoneEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly coinTarget: HTMLElement;
  private readonly flyPool: FlyCoin[] = [];
  private shownScore = 0;
  private lastScoreText = '';
  private lastCoins = -1;
  private lastTime = '';
  private hintTimer = 0;
  private flashTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="level-badge">${EMBLEM_SVG}<div class="panel level-pill">Lv<b id="hud-level">1</b></div></div>
      <div class="panel score-panel">
        <div class="label">SCORE</div>
        <div class="score" id="hud-score">0</div>
        <div class="coins" id="hud-coins-row">${COIN_SVG}<span id="hud-coins">0</span></div>
      </div>
      <button class="pause-btn" id="btn-pause" aria-label="Pause">${PAUSE_SVG}</button>
      <div class="panel time-panel">
        <div class="label">TIME</div>
        <div class="time">${CLOCK_SVG}<span id="hud-time">00:00</span></div>
      </div>
      <div class="hint" id="hud-hint"></div>
      <button class="arrow-btn left" id="btn-left" aria-label="Move left">${ARROW_SVG}</button>
      <button class="arrow-btn right" id="btn-right" aria-label="Move right">${ARROW_SVG}</button>
      <div class="zone-pill" id="hud-zone">SKY RAILS</div>
      <div class="flash" id="hud-flash"></div>
    `;
    const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    this.levelEl = q('hud-level');
    this.scoreEl = q('hud-score');
    this.coinsEl = q('hud-coins');
    this.coinsRow = q('hud-coins-row');
    this.timeEl = q('hud-time');
    this.zoneEl = q('hud-zone');
    this.hintEl = q('hud-hint');
    this.flash = q('hud-flash');
    this.leftBtn = q('btn-left');
    this.rightBtn = q('btn-right');
    this.pauseBtn = q('btn-pause');
    this.coinTarget = this.coinsRow.querySelector('.coin-icon') as unknown as HTMLElement;
    for (let i = 0; i < 14; i++) {
      const el = document.createElement('div');
      el.className = 'fly-coin';
      el.innerHTML = COIN_SVG;
      el.style.display = 'none';
      root.appendChild(el);
      this.flyPool.push({ el, active: false, t: 0, x0: 0, y0: 0 });
    }
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setLevel(n: number): void {
    this.levelEl.textContent = String(n);
  }

  setZone(label: string): void {
    if (this.zoneEl.textContent !== label) this.zoneEl.textContent = label;
  }

  hint(text: string, seconds = 2.6): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    this.hintTimer = seconds;
  }

  flashScreen(kind: 'hit' | 'boost'): void {
    this.flash.classList.toggle('boost', kind === 'boost');
    this.flash.classList.add('show');
    this.flashTimer = kind === 'boost' ? 0.25 : 0.35;
  }

  pressFeedback(dir: -1 | 1): void {
    const b = dir < 0 ? this.leftBtn : this.rightBtn;
    b.classList.add('pressed');
    window.setTimeout(() => b.classList.remove('pressed'), 110);
  }

  /** Launch a coin icon from a screen point to the HUD coin counter. */
  flyCoin(x: number, y: number): void {
    const f = this.flyPool.find((c) => !c.active);
    if (!f) return;
    const stage = this.root.getBoundingClientRect();
    f.active = true;
    f.t = 0;
    f.x0 = x - stage.left;
    f.y0 = y - stage.top;
    f.el.style.display = 'block';
  }

  reset(): void {
    this.shownScore = 0;
    this.lastScoreText = '';
    this.lastCoins = -1;
    this.lastTime = '';
    for (const f of this.flyPool) {
      f.active = false;
      f.el.style.display = 'none';
    }
    this.hintEl.classList.remove('show');
  }

  update(dt: number, score: number, coins: number, time: number): void {
    // Score counts up smoothly.
    this.shownScore += (score - this.shownScore) * Math.min(1, dt * 12);
    if (Math.abs(score - this.shownScore) < 1) this.shownScore = score;
    const st = formatScore(this.shownScore);
    if (st !== this.lastScoreText) {
      this.scoreEl.textContent = st;
      this.lastScoreText = st;
    }
    if (coins !== this.lastCoins) {
      if (this.lastCoins >= 0 && coins > this.lastCoins) {
        this.coinsRow.classList.remove('bump');
        void this.coinsRow.offsetWidth;
        this.coinsRow.classList.add('bump');
      }
      this.coinsEl.textContent = String(coins);
      this.lastCoins = coins;
    }
    const tt = formatTime(time);
    if (tt !== this.lastTime) {
      this.timeEl.textContent = tt;
      this.lastTime = tt;
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.classList.remove('show');
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flash.classList.remove('show');
    }
    this.updateFlyCoins(dt);
  }

  private updateFlyCoins(dt: number): void {
    const stage = this.root.getBoundingClientRect();
    const tr = this.coinTarget.getBoundingClientRect();
    const tx = tr.left + tr.width / 2 - stage.left;
    const ty = tr.top + tr.height / 2 - stage.top;
    for (const f of this.flyPool) {
      if (!f.active) continue;
      f.t += dt / 0.5;
      if (f.t >= 1) {
        f.active = false;
        f.el.style.display = 'none';
        continue;
      }
      const t = f.t;
      const e = t * t * (3 - 2 * t);
      // Arc upward on the way to the counter.
      const x = f.x0 + (tx - f.x0) * e;
      const y = f.y0 + (ty - f.y0) * e - Math.sin(Math.PI * t) * 60;
      const s = 1.3 - 0.5 * t;
      f.el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
      f.el.style.opacity = String(t < 0.85 ? 1 : (1 - t) / 0.15);
    }
  }
}
