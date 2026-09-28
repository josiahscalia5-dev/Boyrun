/** Tiny persistent save (best score, settings). Storage may be unavailable. */
export interface SaveData {
  bestScore: number;
  totalCoins: number;
  sound: boolean;
}

const KEY = 'skizgairos.save.v1';

export function loadSave(): SaveData {
  const defaults: SaveData = { bestScore: 0, totalCoins: 0, sound: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<SaveData>) };
  } catch {
    return defaults;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage blocked - progress is simply not persisted */
  }
}
