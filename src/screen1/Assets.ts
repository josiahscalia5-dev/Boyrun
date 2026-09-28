import layers from './layers.json';

export type Layers = typeof layers;
export const LAYERS: Layers = layers;

export interface Screen1Images {
  screen: HTMLImageElement;
  plate: HTMLImageElement;
  plateCoins: HTMLImageElement;
  hud: HTMLImageElement;
  boy: HTMLImageElement;
  coins: HTMLImageElement[];
  blockX: HTMLImageElement;
  blockChevron: HTMLImageElement;
  patchScore: HTMLImageElement;
  patchCoins: HTMLImageElement;
  patchTime: HTMLImageElement;
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

/** All Screen 1 layers - every one of them cut from the supplied artwork. */
export async function loadScreen1(base = 'screen1/'): Promise<Screen1Images> {
  const [screen, plate, plateCoins, hud, boy, c0, c1, c2, c3, blockX, blockChevron, patchScore, patchCoins, patchTime] = await Promise.all([
    load(`${base}screen.png`),
    load(`${base}plate.png`),
    load(`${base}plate_coins.png`),
    load(`${base}hud.png`),
    load(`${base}boy.png`),
    load(`${base}coin0.png`),
    load(`${base}coin1.png`),
    load(`${base}coin2.png`),
    load(`${base}coin3.png`),
    load(`${base}block_x.png`),
    load(`${base}block_chevron.png`),
    load(`${base}patch_score.png`),
    load(`${base}patch_coins.png`),
    load(`${base}patch_time.png`),
  ]);
  return { screen, plate, plateCoins, hud, boy, coins: [c0, c1, c2, c3], blockX, blockChevron, patchScore, patchCoins, patchTime };
}
