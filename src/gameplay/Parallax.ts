import { ART_H, ART_W, centreX, railY } from './Rail';

/**
 * Depth planes cut from the supplied artwork itself - no new art, not one
 * repainted pixel.
 *
 * The painting is drawn in one-point perspective: the rails, the bridges and
 * the island terraces all converge on the point where the gold rail vanishes.
 * So a pixel's distance from that point IS its depth - the sky and the castle
 * sit close to it, the pipes and terraces that flank the boy sit far from it.
 *
 * Each plane therefore holds the same picture, masked to one ring around the
 * vanishing point, and swells out of it at a rate set by its depth. The
 * untouched plate stays underneath and covers everything, so a plane moving
 * away can never open a hole. Two copies of each plane run half a cycle
 * apart and cross-fade - their alphas sum to exactly one - so the world flows
 * outwards continuously with no seam where a cycle restarts.
 */

/** Where the gold rail vanishes: the painting's own perspective centre. */
export const VANISHING = { x: centreX(railY(1e6)), y: railY(1e6) };

interface Plane {
  canvas: HTMLCanvasElement;
  /** How far out of the vanishing point it swells over one cycle. */
  growth: number;
}

/** Inner edge of each ring (as a fraction of the distance to the far corner)
 *  and how fast that depth rushes past. Nearer = further out = faster. */
const RINGS: ReadonlyArray<{ from: number; feather: number; growth: number }> = [
  // Only the nearest band - the terraces and pipe work that flank the boy.
  // The sky and the castle stay exactly as painted, crisp and still.
  { from: 0.74, feather: 0.16, growth: 0.30 },
];
/** Fraction of a cycle spent handing over to the next copy. */
const HANDOVER = 0.18;

export class Parallax {
  private readonly planes: Plane[] = [];

  constructor(plate: HTMLImageElement) {
    const vx = VANISHING.x;
    const vy = VANISHING.y;
    // Distance from the vanishing point to the furthest corner.
    const far = Math.max(
      Math.hypot(vx, vy),
      Math.hypot(ART_W - vx, vy),
      Math.hypot(vx, ART_H - vy),
      Math.hypot(ART_W - vx, ART_H - vy),
    );
    for (const ring of RINGS) {
      const c = document.createElement('canvas');
      c.width = ART_W;
      c.height = ART_H;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(plate, 0, 0);
      // Keep only this ring of the picture, feathered so the planes blend.
      const g = ctx.createRadialGradient(vx, vy, ring.from * far, vx, vy, (ring.from + ring.feather) * far);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ART_W, ART_H);
      this.planes.push({ canvas: c, growth: ring.growth });
    }
  }

  /**
   * Draw the moving depth planes over the static plate. `travel` is the
   * distance ridden, so the world flows at exactly the rail's own pace.
   */
  draw(ctx: CanvasRenderingContext2D, travel: number, strength: number): void {
    if (strength <= 0) return;
    const period = 2.6; // rail lengths per cycle
    const p = ((travel / period) % 1 + 1) % 1;
    ctx.save();
    for (const plane of this.planes) {
      // One copy carries most of the cycle; the next emerges out of the
      // vanishing point only for the short handover, so the picture is
      // never a lasting double exposure. The two alphas still sum to one.
      const aA = p < 1 - HANDOVER ? 1 : (1 - p) / HANDOVER;
      for (const [phase, alpha] of [[p, aA], [(p + HANDOVER - 1 + 1) % 1, 1 - aA]] as const) {
        if (alpha <= 0.002) continue;
        const s = 1 + plane.growth * phase;
        // Relative to the world transform the caller has already set.
        ctx.save();
        ctx.globalAlpha = alpha * strength;
        ctx.translate(VANISHING.x, VANISHING.y);
        ctx.scale(s, s);
        ctx.translate(-VANISHING.x, -VANISHING.y);
        ctx.drawImage(plane.canvas, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
