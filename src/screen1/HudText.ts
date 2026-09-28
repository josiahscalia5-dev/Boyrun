import { LAYERS, Screen1Images } from './Assets';

/** The numbers painted in the supplied artwork. The run starts from them. */
export const ART_VALUES = { score: 24580, coins: 286, seconds: 82 };

export function formatScore(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const FONT = '"Roboto Condensed", "Arial Narrow", Arial, sans-serif';

/**
 * Draws live score / coins / time over the painted panels, in the painted
 * style (positions and sizes measured on the artwork). While the values
 * still equal the painted ones, nothing is drawn: the artwork shows through.
 */
export class HudText {
  constructor(private readonly img: Screen1Images) {}

  draw(ctx: CanvasRenderingContext2D, score: number, coins: number, seconds: number): void {
    const p = LAYERS.patches;
    const scoreText = formatScore(score);
    if (scoreText !== formatScore(ART_VALUES.score)) {
      ctx.drawImage(this.img.patchScore, p.score.x, p.score.y, p.score.w, p.score.h);
      ctx.save();
      ctx.font = `800 41px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const g = ctx.createLinearGradient(0, 127, 0, 158);
      g.addColorStop(0, '#fffbc2');
      g.addColorStop(0.42, '#ffd940');
      g.addColorStop(1, '#f29a00');
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(92, 44, 0, 0.9)';
      ctx.shadowColor = 'rgba(30, 10, 0, 0.7)';
      ctx.shadowOffsetY = 2;
      ctx.shadowBlur = 2;
      ctx.strokeText(scoreText, 90.5, 157.5, 128);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = g;
      ctx.fillText(scoreText, 90.5, 157.5, 128);
      ctx.restore();
    }
    if (coins !== ART_VALUES.coins) {
      ctx.drawImage(this.img.patchCoins, p.coins.x, p.coins.y, p.coins.w, p.coins.h);
      this.white(ctx, String(coins), 78, 197.5, 27, 82);
    }
    const timeText = formatTime(seconds);
    if (timeText !== formatTime(ART_VALUES.seconds)) {
      ctx.drawImage(this.img.patchTime, p.time.x, p.time.y, p.time.w, p.time.h);
      this.white(ctx, timeText, 411.5, 156.5, 31, 74);
    }
  }

  private white(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number): void {
    ctx.save();
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0, 8, 30, 0.75)';
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 1.5;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y, maxW);
    ctx.restore();
  }
}
