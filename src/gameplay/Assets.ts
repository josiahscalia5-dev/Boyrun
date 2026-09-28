import layout from './layout.json';

export type Layout = typeof layout;
export const L: Layout = layout;

export interface GameplayImages {
  /** The world with the boy, his trail, the coins and the HUD lifted out. */
  plate: HTMLImageElement;
  /** Motion masks cut from the artwork: R = waterfalls, G = the gold rail. */
  flow: HTMLImageElement;
  boy: HTMLImageElement;
  trail: HTMLImageElement;
  /** The painted coins, at their painted size. */
  coins: HTMLImageElement[];
  /** The nearest painted coin, completed - used for every coin that follows. */
  coin: HTMLImageElement;
  blockX: HTMLImageElement;
  blockChevron: HTMLImageElement;
  ui: Record<'badge' | 'score' | 'time' | 'pause' | 'arrow_left' | 'arrow_right', HTMLImageElement>;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/** Every layer of the Gameplay Screen - all of them cut from the supplied artwork. */
export async function loadGameplay(base = 'gameplay/'): Promise<GameplayImages> {
  const one = (name: string) => load(`${base}${name}.png`);
  const [plate, flow, boy, trail, coin, blockX, blockChevron, badge, score, time, pause, arrowL, arrowR, ...coins] = await Promise.all([
    one('plate'),
    one('flow'),
    one('boy'),
    one('trail'),
    one('coin'),
    one('block_x'),
    one('block_chevron'),
    one('ui_badge'),
    one('ui_score'),
    one('ui_time'),
    one('ui_pause'),
    one('ui_arrow_left'),
    one('ui_arrow_right'),
    ...L.coins.map((_, i) => one(`coin_${i}`)),
  ]);
  return {
    plate,
    flow,
    boy,
    trail,
    coin,
    coins,
    blockX,
    blockChevron,
    ui: { badge, score, time, pause, arrow_left: arrowL, arrow_right: arrowR },
  };
}

/**
 * The waterfalls, as an alpha mask on its own canvas (the red channel of the
 * flow layer). A scrolling gradient drawn through it makes the painted falls
 * run without touching any other pixel of the artwork.
 */
export function waterMask(flow: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = flow.naturalWidth;
  c.height = flow.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(flow, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i]; // red channel = the painted waterfalls
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
  }
  ctx.putImageData(px, 0, 0);
  return c;
}
