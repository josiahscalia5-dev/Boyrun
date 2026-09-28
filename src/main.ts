import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/montserrat/900.css';
import './styles/game.css';
import { Game } from './game/Game';
import { installDebug } from './game/Debug';
import { installNativeInsets } from './game/NativeInsets';

async function boot(): Promise<void> {
  installNativeInsets();
  // Canvas-painted textures use the game font; wait for it (briefly).
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* fonts API unavailable */
  }
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const game = new Game(
    canvas,
    document.getElementById('hud')!,
    document.getElementById('screens')!,
    document.getElementById('stage')!,
  );
  installDebug(game);
  game.run();
}

void boot();
