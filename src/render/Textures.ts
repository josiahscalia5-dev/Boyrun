import * as THREE from 'three';

/**
 * All textures are painted procedurally at startup: no external image
 * assets are needed, which keeps the APK small and loading instant.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; mips?: boolean } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.generateMipmaps = opts.mips !== false;
  t.minFilter = opts.mips === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

export interface TextureSet {
  glow: THREE.Texture;
  softGlow: THREE.Texture;
  sparkle: THREE.Texture;
  railTop: THREE.Texture;
  railHalo: THREE.Texture;
  /** Three painted cumulus puffs side by side (tile 0..2). */
  cloudAtlas: THREE.Texture;
  waterfall: THREE.Texture;
  chevron: THREE.Texture;
  emblem: THREE.Texture;
  trail: THREE.Texture;
  crossX: THREE.Texture;
}

let cached: TextureSet | null = null;

export function textures(): TextureSet {
  if (cached) return cached;
  cached = {
    glow: radial(128, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.55)'],
      [0.6, 'rgba(255,255,255,0.12)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    softGlow: radial(128, [
      [0, 'rgba(255,255,255,0.8)'],
      [0.5, 'rgba(255,255,255,0.25)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    sparkle: sparkle(),
    railTop: railTop(),
    railHalo: railHalo(),
    cloudAtlas: cloudAtlas(),
    waterfall: waterfall(),
    chevron: chevron(),
    emblem: emblem(),
    trail: trail(),
    crossX: crossX(),
  };
  return cached;
}

function radial(size: number, stops: [number, string][]): THREE.Texture {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return tex(c, { srgb: false });
}

function sparkle(): THREE.Texture {
  const s = 128;
  const [c, g] = canvas(s, s);
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [
    [s * 0.9, 6],
    [6, s * 0.9],
  ]) {
    const lg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, Math.max(w, h) / 2);
    lg.addColorStop(0, 'rgba(255,255,255,0.95)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(s / 2 - w / 2, s / 2 - h / 2, w, h);
  }
  return tex(c, { srgb: false });
}

/** Lengthwise rail surface: bright core line, soft falloff, energy dashes. */
function railTop(): THREE.Texture {
  const w = 64;
  const h = 256;
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    // Energy pulses travelling along the rail.
    const pulse = Math.pow(Math.max(0, Math.sin(v * Math.PI * 2)), 12) * 0.35;
    const dash = (Math.floor(v * 16) % 2 === 0 ? 0.06 : 0) * 1;
    for (let x = 0; x < w; x++) {
      const u = Math.abs(x / (w - 1) - 0.5) * 2; // 0 centre .. 1 edge
      const core = Math.exp(-u * u * 18);
      const body = 0.55 + 0.25 * (1 - u);
      const edge = Math.pow(u, 10) * 0.5;
      let val = Math.min(1, body * 0.75 + core * 0.55 + pulse * (1 - u) + dash * core + edge);
      val = Math.max(0, val);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(val * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: true, srgb: false });
}

/** Across-rail halo falloff (u across, v along). */
function railHalo(): THREE.Texture {
  const w = 128;
  const h = 4;
  const [c, g] = canvas(w, h);
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.18)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  return tex(c, { repeat: true, srgb: false });
}

/** Painterly cumulus puffs, three variants in one atlas. */
function cloudAtlas(): THREE.Texture {
  const s = 256;
  const [c, g] = canvas(s * 3, s);
  for (let k = 0; k < 3; k++) {
    g.save();
    g.beginPath();
    g.rect(k * s, 0, s, s);
    g.clip();
    g.translate(k * s, 0);
    paintCloud(g, s, k + 1);
    g.restore();
  }
  return tex(c);
}

function paintCloud(g: CanvasRenderingContext2D, s: number, seed: number): void {
  let r = seed * 9301 + 49297;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const puffs: [number, number, number][] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = s * (0.18 + 0.64 * t) + (rnd() - 0.5) * 20;
    const bulge = Math.sin(t * Math.PI);
    const y = s * (0.62 - 0.22 * bulge) + (rnd() - 0.5) * 18;
    const rad = s * (0.08 + 0.12 * bulge + rnd() * 0.05);
    puffs.push([x, y, rad]);
  }
  // Shadowed base, then sunlit tops.
  for (const [x, y, rad] of puffs) {
    const grd = g.createRadialGradient(x, y + rad * 0.25, rad * 0.2, x, y, rad);
    grd.addColorStop(0, 'rgba(206,220,244,0.95)');
    grd.addColorStop(0.7, 'rgba(196,212,240,0.7)');
    grd.addColorStop(1, 'rgba(196,212,240,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  for (const [x, y, rad] of puffs) {
    const grd = g.createRadialGradient(x - rad * 0.2, y - rad * 0.35, rad * 0.05, x, y - rad * 0.1, rad * 0.9);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.6, 'rgba(250,252,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y - rad * 0.1, rad * 0.9, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, s);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.72, 'rgba(0,0,0,1)');
  fade.addColorStop(0.95, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'source-over';
}

function waterfall(): THREE.Texture {
  const w = 64;
  const h = 256;
  const [c, g] = canvas(w, h);
  g.fillStyle = 'rgba(190,230,255,0.55)';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 30 + Math.random() * 90;
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, `rgba(255,255,255,${0.5 + Math.random() * 0.5})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, 1 + Math.random() * 3, len);
    // wrap vertically for seamless scrolling
    g.fillRect(x, y - h, 1 + Math.random() * 3, len);
  }
  // Soft side edges.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.2, 'rgba(0,0,0,1)');
  fade.addColorStop(0.8, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  return tex(c, { repeat: true });
}

function chevron(): THREE.Texture {
  const s = 256;
  const [c, g] = canvas(s, s);
  const bg = g.createLinearGradient(0, 0, 0, s);
  bg.addColorStop(0, 'rgba(20,60,140,0.85)');
  bg.addColorStop(1, 'rgba(8,24,70,0.9)');
  g.fillStyle = bg;
  roundRect(g, 10, 10, s - 20, s - 20, 26);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = '#6fe0ff';
  g.shadowColor = '#3fd0ff';
  g.shadowBlur = 20;
  roundRect(g, 14, 14, s - 28, s - 28, 24);
  g.stroke();
  g.lineWidth = 26;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#bff6ff';
  for (const y of [110, 175]) {
    g.beginPath();
    g.moveTo(62, y);
    g.lineTo(128, y - 56);
    g.lineTo(194, y);
    g.stroke();
  }
  return tex(c);
}

function crossX(): THREE.Texture {
  const s = 256;
  const [c, g] = canvas(s, s);
  const bg = g.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s * 0.7);
  bg.addColorStop(0, '#5a0a12');
  bg.addColorStop(1, '#22040a');
  g.fillStyle = bg;
  roundRect(g, 6, 6, s - 12, s - 12, 22);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = '#ff5a5a';
  g.shadowColor = '#ff2020';
  g.shadowBlur = 18;
  roundRect(g, 12, 12, s - 24, s - 24, 20);
  g.stroke();
  g.lineCap = 'round';
  g.lineWidth = 34;
  g.shadowBlur = 36;
  g.strokeStyle = '#ff3b3b';
  g.beginPath();
  g.moveTo(58, 58);
  g.lineTo(198, 198);
  g.moveTo(198, 58);
  g.lineTo(58, 198);
  g.stroke();
  g.lineWidth = 12;
  g.shadowBlur = 0;
  g.strokeStyle = '#ffd0c8';
  g.stroke();
  return tex(c);
}

/** Backpack emblem: glowing cyan shield/diamond on a dark plate. */
function emblem(): THREE.Texture {
  const s = 128;
  const [c, g] = canvas(s, s);
  g.clearRect(0, 0, s, s);
  g.shadowColor = '#44e6ff';
  g.shadowBlur = 16;
  g.strokeStyle = '#9ff4ff';
  g.lineWidth = 9;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(64, 16);
  g.lineTo(108, 40);
  g.lineTo(96, 88);
  g.lineTo(64, 114);
  g.lineTo(32, 88);
  g.lineTo(20, 40);
  g.closePath();
  g.stroke();
  g.fillStyle = 'rgba(80,220,255,0.35)';
  g.fill();
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(42, 50);
  g.lineTo(64, 84);
  g.lineTo(86, 50);
  g.stroke();
  return tex(c);
}

/** Light-trail ribbon: bright core fading to the sides and to the tail. */
function trail(): THREE.Texture {
  const w = 64;
  const h = 128;
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const along = 1 - y / (h - 1); // 1 at head (v=0) .. 0 at tail
    for (let x = 0; x < w; x++) {
      const u = Math.abs(x / (w - 1) - 0.5) * 2;
      const core = Math.exp(-u * u * 10);
      const a = core * Math.pow(along, 1.4);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
