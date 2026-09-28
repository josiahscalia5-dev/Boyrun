import { GameplayImages, L } from './Assets';
import { ART_H, ART_W } from './Rail';

/** The values painted in the supplied artwork. Every run starts from them. */
export const ART_VALUES = { score: 24580, coins: 286, seconds: 82, level: 12 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PanelName = 'badge' | 'score' | 'time' | 'pause' | 'arrow_left' | 'arrow_right';

export interface HudPlacement {
  scale: number;
  panels: Record<PanelName, Rect>;
  /** Centre of the painted coin icon - where collected coins fly to. */
  coinIcon: { x: number; y: number };
}

export function formatScore(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const NUM = '"Roboto Condensed", "Arial Narrow", Arial, sans-serif';
/** Chevrons needed for the super boost - kept in step with Track. */
const CHAIN = 3;
const LABEL = 'Montserrat, Roboto, Arial, sans-serif';

/**
 * The HUD keeps the padding it is painted with, but measured from the safe
 * area rather than from the artwork's edge - so on a screen taller than the
 * painting the panels stay in the corners instead of drifting off. At the
 * artwork's own shape they land exactly where they are painted.
 */
export function placeHud(safe: Rect): HudPlacement {
  // Painted proportions relative to the screen width, never taller than the
  // screen can carry.
  const scale = Math.min(safe.w / ART_W, (safe.h / ART_H) * 1.35);
  const u = L.ui;
  const right = safe.x + safe.w;
  const bottom = safe.y + safe.h;
  // Paddings as painted: top-left cluster, top-right cluster, bottom arrows.
  const at = (b: { x: number; y: number; w: number; h: number }, ax: number, ay: number): Rect => ({
    x: ax + b.x * scale,
    y: ay + b.y * scale,
    w: b.w * scale,
    h: b.h * scale,
  });
  const topLeft = { ax: safe.x, ay: safe.y };
  const topRight = { ax: right - ART_W * scale, ay: safe.y };
  const bottomLeft = { ax: safe.x, ay: bottom - ART_H * scale };
  const panels: Record<PanelName, Rect> = {
    badge: at(u.badge, topLeft.ax, topLeft.ay),
    score: at(u.score, topLeft.ax, topLeft.ay),
    pause: at(u.pause, topRight.ax, topRight.ay),
    time: at(u.time, topRight.ax, topRight.ay),
    arrow_left: at(u.arrow_left, bottomLeft.ax, bottomLeft.ay),
    arrow_right: at(u.arrow_right, right - ART_W * scale, bottomLeft.ay),
  };
  return {
    scale,
    panels,
    coinIcon: {
      x: panels.score.x + (u.coin.x + u.coin.w / 2 - u.score.x) * scale,
      y: panels.score.y + (u.coin.y + u.coin.h / 2 - u.score.y) * scale,
    },
  };
}

/**
 * Draws the painted HUD panels and the live numbers over them, in the painted
 * positions, sizes and style (all measured on the artwork).
 */
export class Hud {
  constructor(private readonly img: GameplayImages) {}

  draw(
    ctx: CanvasRenderingContext2D,
    hud: HudPlacement,
    score: number,
    coins: number,
    seconds: number,
    boostChain: number,
    superCharged: boolean,
    press: Record<string, number>,
  ): void {
    // The painted arrow buttons stay exactly as the artwork has them. They
    // still answer a tap, but steering is the finger: see bindTouchSteering.
    for (const name of ['badge', 'score', 'time', 'pause', 'arrow_left', 'arrow_right'] as const) {
      const box = hud.panels[name];
      const sprite = this.img.ui[name];
      ctx.drawImage(sprite, box.x, box.y, box.w, box.h);
      // A press lights the painted button up with its own pixels.
      const k = (press[name] ?? 0) / 0.16;
      if (k > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45 * k;
        ctx.drawImage(sprite, box.x, box.y, box.w, box.h);
        ctx.restore();
      }
    }
    this.panelText(ctx, hud, 'badge', (c) => {
      const t = L.text.level;
      c.font = `800 ${t.size}px ${LABEL}`;
      c.fillStyle = '#ffffff';
      c.shadowColor = 'rgba(8, 20, 60, 0.8)';
      c.shadowOffsetY = 2;
      c.shadowBlur = 3;
      c.fillText(`Lv ${ART_VALUES.level}`, t.x - L.ui.badge.x, t.y - L.ui.badge.y);
    });
    this.panelText(ctx, hud, 'score', (c) => {
      const t = L.text.score;
      c.font = `800 ${t.size}px ${NUM}`;
      c.textAlign = 'center';
      const y = t.y - L.ui.score.y;
      const g = c.createLinearGradient(0, y - t.size * 0.8, 0, y + t.size * 0.08);
      g.addColorStop(0, '#fffbc2');
      g.addColorStop(0.42, '#ffd940');
      g.addColorStop(1, '#f29a00');
      c.lineJoin = 'round';
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(92, 44, 0, 0.9)';
      c.shadowColor = 'rgba(30, 10, 0, 0.7)';
      c.shadowOffsetY = 3;
      c.shadowBlur = 3;
      c.strokeText(formatScore(score), t.x - L.ui.score.x, y, 190);
      c.shadowColor = 'transparent';
      c.fillStyle = g;
      c.fillText(formatScore(score), t.x - L.ui.score.x, y, 190);
      // Coin count, under the painted coin icon.
      const ct = L.text.coins;
      c.font = `700 ${ct.size}px ${NUM}`;
      c.textAlign = 'left';
      c.fillStyle = '#ffffff';
      c.shadowColor = 'rgba(0, 8, 30, 0.75)';
      c.fillText(String(coins), ct.x - L.ui.score.x, ct.y - L.ui.score.y, 120);
    });
    this.drawBoostChain(ctx, hud, boostChain, superCharged);
    this.panelText(ctx, hud, 'time', (c) => {
      const t = L.text.time;
      c.font = `700 ${t.size}px ${NUM}`;
      c.fillStyle = '#ffffff';
      c.shadowColor = 'rgba(0, 8, 30, 0.75)';
      c.shadowOffsetY = 2;
      c.shadowBlur = 2;
      c.fillText(formatTime(seconds), t.x - L.ui.time.x, t.y - L.ui.time.y, 110);
    });
  }

  /**
   * BOOST n/3, tucked under the painted score panel in the same style. Three
   * pips fill as the chevrons are taken; all three light while the super boost
   * is running. It is only there once he has taken one, so the opening frame
   * is the artwork.
   */
  private drawBoostChain(ctx: CanvasRenderingContext2D, hud: HudPlacement, chain: number, superCharged: boolean): void {
    if (chain <= 0 && !superCharged) return;
    const u = hud.scale;
    const panel = hud.panels.score;
    // A pill in the painted panels' own style, under the score, same width.
    const w = panel.w;
    const h = 78 * u;
    const x = panel.x;
    const y = panel.y + panel.h + 14 * u;
    const r = 18 * u;
    const lit = superCharged ? CHAIN : chain;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, 'rgba(18, 38, 92, 0.92)');
    bg.addColorStop(1, 'rgba(8, 18, 52, 0.92)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = superCharged ? 'rgba(150, 230, 255, 0.95)' : 'rgba(95, 134, 216, 0.9)';
    ctx.stroke();
    ctx.font = `800 ${30 * u}px ${LABEL}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = superCharged ? '#bdf0ff' : '#cfe0ff';
    ctx.fillText(superCharged ? 'SUPER SPEED' : `BOOST ${chain}/${CHAIN}`, x + 18 * u, y + 25 * u);
    for (let i = 0; i < CHAIN; i++) {
      const px = x + (30 + i * 40) * u;
      const py = y + 56 * u;
      ctx.beginPath();
      ctx.arc(px, py, 12 * u, 0, Math.PI * 2);
      if (i < lit) {
        const g = ctx.createLinearGradient(0, py - 12 * u, 0, py + 12 * u);
        g.addColorStop(0, superCharged ? '#eafcff' : '#fffbc2');
        g.addColorStop(1, superCharged ? '#5fd0ff' : '#f29a00');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = 'rgba(160, 185, 235, 0.22)';
      }
      ctx.fill();
      ctx.lineWidth = 2.5 * u;
      ctx.strokeStyle = 'rgba(8, 20, 60, 0.75)';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Runs `body` in the panel's own painted pixel space. */
  private panelText(ctx: CanvasRenderingContext2D, hud: HudPlacement, name: PanelName, body: (c: CanvasRenderingContext2D) => void): void {
    const box = hud.panels[name];
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.scale(hud.scale, hud.scale);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    body(ctx);
    ctx.restore();
  }
}
