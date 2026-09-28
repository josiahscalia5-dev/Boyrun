import '@fontsource/montserrat/800.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/roboto-condensed/700.css';
import '@fontsource/roboto-condensed/800.css';
import './styles/game.css';
import { installNativeInsets } from './game/NativeInsets';
import { loadGameplay } from './gameplay/Assets';
import { GameplayScreen } from './gameplay/GameplayScreen';

async function boot(): Promise<void> {
  installNativeInsets();
  const root = document.getElementById('app')!;
  const [images] = await Promise.all([
    loadGameplay(),
    // The HUD numbers use the condensed font; wait briefly for it.
    Promise.race([
      document.fonts?.load('800 64px "Roboto Condensed"'),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => undefined),
  ]);
  const screen = new GameplayScreen(root, images);
  screen.run();

  // Test / debug hooks used by the automated playtest.
  (window as unknown as { __skz: unknown }).__skz = {
    screen,
    state: () => screen.snapshot(),
    start: () => screen.start(),
    press: (a: 'left' | 'right' | 'pause') => screen.action(a),
    manual: (on: boolean) => {
      screen.manualTime = on;
    },
    // Depth-plane flow on/off, for the side-by-side comparison.
    parallax: (on: boolean) => {
      screen.parallax = on ? 1 : 0;
    },
    advance: (seconds: number, step = 1 / 60) => {
      screen.manualTime = true;
      for (let t = 0; t < seconds - 1e-9; t += step) screen.update(step);
      screen.render();
      return screen.snapshot();
    },
  };
  document.body.dataset.ready = '1';
}

void boot();
