/** Inline SVG icons for the HUD (crisp at any device pixel ratio). */

export const EMBLEM_SVG = `
<svg viewBox="0 0 120 100" class="emblem" aria-hidden="true">
  <defs>
    <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3a0"/>
      <stop offset="0.45" stop-color="#ffc628"/>
      <stop offset="1" stop-color="#d27a00"/>
    </linearGradient>
    <linearGradient id="gGem" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fe9ff"/>
      <stop offset="1" stop-color="#1c7dff"/>
    </linearGradient>
  </defs>
  <g stroke="#6b3a00" stroke-width="3" stroke-linejoin="round" fill="url(#gGold)">
    <path d="M52 40 C38 22 20 18 4 24 C14 28 20 33 24 38 C14 38 8 42 4 48 C16 46 24 48 30 52 C22 54 18 58 16 64 C28 60 38 60 46 62 Z"/>
    <path d="M68 40 C82 22 100 18 116 24 C106 28 100 33 96 38 C106 38 112 42 116 48 C104 46 96 48 90 52 C98 54 102 58 104 64 C92 60 82 60 74 62 Z"/>
    <path d="M60 14 L80 26 L78 58 L60 86 L42 58 L40 26 Z"/>
  </g>
  <path d="M60 30 L66 44 L60 66 L54 44 Z" fill="url(#gGem)" stroke="#0b3f8a" stroke-width="2"/>
  <path d="M60 18 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 z" fill="#fff8d0" opacity="0.9"/>
</svg>`;

export const COIN_SVG = `
<svg viewBox="0 0 40 40" class="coin-icon" aria-hidden="true">
  <defs>
    <radialGradient id="gCoin" cx="0.4" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#fff2a0"/>
      <stop offset="0.55" stop-color="#ffc21f"/>
      <stop offset="1" stop-color="#e98a00"/>
    </radialGradient>
  </defs>
  <circle cx="20" cy="20" r="18" fill="#c96a00"/>
  <circle cx="20" cy="20" r="16" fill="url(#gCoin)" stroke="#ffdc6a" stroke-width="1.5"/>
  <path d="M20 8.5 l3.4 7.2 7.9 0.9 -5.9 5.4 1.6 7.8 -7 -4 -7 4 1.6 -7.8 -5.9 -5.4 7.9 -0.9 z" fill="#fff0a0" stroke="#d98800" stroke-width="1"/>
</svg>`;

export const CLOCK_SVG = `
<svg viewBox="0 0 32 32" class="clock-icon" aria-hidden="true">
  <circle cx="16" cy="16" r="12.5" fill="none" stroke="#fff" stroke-width="3"/>
  <path d="M16 9 V16 L21 19" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>`;

export const PAUSE_SVG = `
<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="8" y="6" width="5.5" height="20" rx="2" fill="#fff"/><rect x="18.5" y="6" width="5.5" height="20" rx="2" fill="#fff"/></svg>`;

export const ARROW_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="gArrow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#cfe6ff"/>
    </linearGradient>
  </defs>
  <path d="M8 32 L30 12 L30 24 L56 24 L56 40 L30 40 L30 52 Z" fill="url(#gArrow)" stroke="#0a3aa0" stroke-width="2.5" stroke-linejoin="round"/>
</svg>`;
