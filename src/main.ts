import '@fontsource/montserrat/800.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/roboto-condensed/700.css';
import '@fontsource/roboto-condensed/800.css';
import './styles/game.css';
import { installNativeInsets } from './game/NativeInsets';
import { loadScreen1 } from './screen1/Assets';
import { Screen1 } from './screen1/Screen1';

async function boot(): Promise<void> {
  installNativeInsets();
  const root = document.getElementById('app')!;
  const [images] = await Promise.all([
    loadScreen1(),
    // HUD digits use the condensed font; wait briefly for it.
    Promise.race([document.fonts?.load('800 41px "Roboto Condensed"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined),
  ]);
  const screen = new Screen1(root, images);
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
