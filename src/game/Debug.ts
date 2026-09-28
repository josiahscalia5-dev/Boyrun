import type { Game } from './Game';

/**
 * Test/debug hooks (window.__skz). Used by the automated playtest to drive
 * the real game deterministically: advance time, press buttons, and run a
 * simple autopilot that plays like a careful human.
 */
export function installDebug(game: Game): void {
  let autopilot = false;
  let cooldown = 0;

  const gateAhead = (railLat: number, s0: number, s1: number) =>
    game.level.obstacles.find((o) => o.s >= s0 && o.s <= s1 && Math.abs(o.lat - railLat) < 1);

  const drive = (dt: number) => {
    cooldown -= dt;
    const p = game.player;
    if (!autopilot || game.state !== 'playing' || p.state !== 'riding' || p.move || cooldown > 0) return;
    const net = game.level.network;
    const look = p.speed * 1.1 + 10;
    const danger = gateAhead(p.rail.lat.at(p.s + 5), p.s + 1, p.s + look);
    const options = [-1, 1]
      .map((dir) => ({ dir: dir as -1 | 1, rail: net.neighbour({ rail: p.rail, s: p.s, dir: dir as -1 | 1, lead: p.speed * 0.26 }) }))
      .filter((o) => o.rail);
    if (danger) {
      const safe = options.find((o) => !gateAhead(o.rail!.lat.at(danger.s), p.s, danger.s + 6));
      // Two lanes away? step toward the centre first.
      const pick = safe ?? options.find((o) => o.rail!.lat.at(p.s) * o.dir < 0) ?? options[0];
      if (pick) {
        game.input.push(pick.dir < 0 ? 'left' : 'right');
        cooldown = 0.3;
      }
      return;
    }
    // No danger: steer toward the next coin trail if its rail is clear.
    const coin = game.coins.ahead(p.s + 4, 45)[0];
    if (coin && Math.abs(coin.lat - p.lat) > 1.5) {
      const dir = (coin.lat > p.lat ? 1 : -1) as -1 | 1;
      const opt = options.find((o) => o.dir === dir);
      if (opt && !gateAhead(opt.rail!.lat.at(p.s + 10), p.s, p.s + look + 10)) {
        game.input.push(dir < 0 ? 'left' : 'right');
        cooldown = 0.35;
      }
    }
  };

  const api = {
    game,
    state: () => ({
      state: game.state,
      player: game.player.state,
      s: game.player.s,
      speed: game.player.speed,
      lat: game.player.lat,
      rail: game.player.rail.type,
      score: Math.floor(game.score),
      coins: game.coinCount,
      totalCoins: game.coins.total,
      elapsed: game.elapsed,
      finishS: game.level.finishS,
      quality: game.stage.quality,
      scenery: game.scenery.stats,
      railChunks: game.rails.liveChunks,
    }),
    start: () => game.beginCountdown(),
    press: (dir: 'left' | 'right') => game.input.push(dir),
    manual: (on: boolean) => {
      game.manualTime = on;
    },
    autopilot: (on: boolean) => {
      autopilot = on;
    },
    /** Advance simulated time in fixed steps (optionally render at the end). */
    advance: (seconds: number, step = 1 / 60) => {
      game.manualTime = true;
      const n = Math.round(seconds / step);
      for (let i = 0; i < n; i++) {
        drive(step);
        game.tick(step);
      }
      game.renderFrame();
      return api.state();
    },
    render: () => game.renderFrame(),
    setQuality: (q: 'high' | 'medium' | 'low') => game.setQuality(q),
  };
  (window as unknown as { __skz: typeof api }).__skz = api;
}
