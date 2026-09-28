import { formatScore, formatTime } from './Hud';

export interface ResultStats {
  score: number;
  coins: number;
  totalCoins: number;
  time: number;
  best: number;
  newBest: boolean;
}

type Handler = () => void;

/** Title, countdown, pause, crash and level-complete overlays. */
export class Screens {
  private current: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  private mount(html: string, cls = ''): HTMLElement {
    this.clear();
    const el = document.createElement('div');
    el.className = `screen ${cls}`;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.current = el;
    return el;
  }

  clear(): void {
    this.current?.remove();
    this.current = null;
  }

  private bind(el: HTMLElement, id: string, fn: Handler): void {
    const b = el.querySelector<HTMLElement>(`[data-action="${id}"]`);
    b?.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      fn();
    });
  }

  title(level: number, levelName: string, onStart: Handler): void {
    const el = this.mount(
      `<div class="logo"><h1>SKIZGAIROS</h1><p>SKY RAIL ADVENTURE</p></div>
       <div class="title-bottom">
         <div class="level-tag">LEVEL ${level} · ${levelName.toUpperCase()}</div>
         <button class="btn pulse" data-action="start">TAP TO RIDE</button>
       </div>`,
      'title-screen',
    );
    el.addEventListener('pointerup', () => onStart());
  }

  countdown(text: string): void {
    this.mount(`<div class="countdown">${text}</div>`);
    this.current!.style.pointerEvents = 'none';
  }

  pause(soundOn: boolean, onResume: Handler, onRestart: Handler, onSound: Handler): void {
    const el = this.mount(
      `<div class="card">
         <h2>PAUSED</h2>
         <button class="btn" data-action="resume">RESUME</button>
         <div class="toggle-row">
           <button class="btn blue small" data-action="restart">RESTART</button>
           <button class="btn blue small" data-action="sound">SOUND ${soundOn ? 'ON' : 'OFF'}</button>
         </div>
       </div>`,
      'dim',
    );
    this.bind(el, 'resume', onResume);
    this.bind(el, 'restart', onRestart);
    this.bind(el, 'sound', onSound);
  }

  crashed(stats: ResultStats, onRetry: Handler): void {
    const el = this.mount(
      `<div class="card">
         <h2 class="red">WIPEOUT!</h2>
         <div class="stats">
           <span>SCORE</span><span>${formatScore(stats.score)}</span>
           <span>COINS</span><span>${stats.coins}</span>
           <span>TIME</span><span>${formatTime(stats.time)}</span>
         </div>
         <button class="btn" data-action="retry">TRY AGAIN</button>
       </div>`,
      'dim',
    );
    this.bind(el, 'retry', onRetry);
  }

  complete(stats: ResultStats, onReplay: Handler): void {
    const el = this.mount(
      `<div class="card">
         <h2>LEVEL COMPLETE!</h2>
         <div class="stats">
           <span>SCORE</span><span>${formatScore(stats.score)}</span>
           <span>COINS</span><span>${stats.coins} / ${stats.totalCoins}</span>
           <span>TIME</span><span>${formatTime(stats.time)}</span>
           <span>BEST</span><span>${formatScore(stats.best)}${stats.newBest ? ' ★' : ''}</span>
         </div>
         <button class="btn" data-action="replay">RIDE AGAIN</button>
       </div>`,
      'dim',
    );
    this.bind(el, 'replay', onReplay);
  }
}
