import type { HillSpec, TurnSpec } from './Course';
import type { LevelData } from './LevelData';
import { LANE, LaneKey, LevelBuilder, SIDE_H } from './LevelBuilder';

export const BASE_SPEED = 27;

/**
 * Level 1 - the Gameplay Screen (Phase 1).
 * Gold centre rail with blue side rails, exactly like the reference, running
 * through curves and elevation changes with coin trails, red X gates and blue
 * chevron boost blocks.
 */
export function buildLevel(index = 1): LevelData {
  const turns: TurnSpec[] = [
    { s: 90, len: 180, angle: 0.22 },
    { s: 330, len: 170, angle: -0.3 },
    { s: 560, len: 160, angle: 0.28 },
    { s: 800, len: 200, angle: -0.26 },
    { s: 1080, len: 200, angle: 0.24 },
    { s: 1380, len: 220, angle: -0.28 },
    { s: 1680, len: 180, angle: 0.2 },
  ];
  const hills: HillSpec[] = [
    { s: 140, len: 140, dy: 5 },
    { s: 520, len: 150, dy: -12 },
    { s: 880, len: 160, dy: 7 },
    { s: 1250, len: 200, dy: -8 },
    { s: 1600, len: 180, dy: 6 },
  ];
  const b = new LevelBuilder(2080, turns, hills);

  b.open('L', 'blue', -60, -LANE, SIDE_H);
  const start = b.open('C', 'gold', -60, 0, 0);
  b.open('R', 'blue', -60, LANE, SIDE_H);
  b.zone(-60, 2080, 'SKY RAILS');
  b.tutorial(15, 'TAP ← → TO CHANGE RAILS');

  const gates = (s: number, ...keys: LaneKey[]) => keys.forEach((k) => b.gate(k, s));

  b.coinLine('C', 30, 150, 4.5);
  b.tutorial(140, 'DODGE THE RED GATES');
  gates(200, 'C');
  b.coinLine('L', 165, 250, 4.5);
  b.coinLine('R', 175, 230, 5.5);
  b.tutorial(235, 'BLUE CHEVRONS = SPEED BOOST');
  b.boost('R', 265);
  b.coinLine('R', 272, 325, 4);
  gates(335, 'L', 'C');
  b.coinLine('C', 360, 430, 4.5);
  gates(470, 'R');
  gates(505, 'C');
  b.coinLine('L', 470, 540, 5);
  gates(560, 'L');
  b.coinLine('C', 530, 600, 4.5);
  gates(610, 'R');
  b.boost('C', 650);
  b.coinLine('C', 656, 715, 4);
  gates(750, 'L', 'R');
  b.coinLine('C', 730, 770, 4);
  // Zig-zag trail across the rails.
  b.coinLine('L', 790, 825, 4.5);
  b.coinLine('C', 838, 872, 4.5);
  b.coinLine('R', 885, 920, 4.5);
  gates(955, 'C');
  b.boost('L', 965);
  b.coinLine('L', 972, 1020, 4);
  gates(1055, 'C', 'R');
  b.coinLine('L', 1030, 1080, 4.5);
  b.coinLine('R', 1085, 1150, 4.5);
  gates(1185, 'L', 'R');
  b.coinLine('C', 1160, 1210, 4.5);
  // Staggered gates: weave through.
  gates(1255, 'L');
  gates(1295, 'C');
  gates(1335, 'R');
  b.coinLine('R', 1250, 1290, 5);
  b.coinLine('L', 1300, 1340, 5);
  b.boost('C', 1385);
  b.coinLine('C', 1392, 1455, 4);
  gates(1505, 'L', 'C');
  b.coinLine('R', 1470, 1530, 4.5);
  b.coinLine('C', 1565, 1640, 4.5);
  gates(1685, 'C');
  b.coinLine('L', 1660, 1720, 5);
  b.coinLine('R', 1660, 1720, 5);
  gates(1765, 'L', 'R');
  b.coinLine('C', 1740, 1800, 4);
  b.boost('C', 1835);
  b.coinLine('C', 1842, 1910, 4);
  b.closeAll(2080);

  return b.build(index, 'Skyreach Rails', 1, BASE_SPEED, 1940, start.id);
}
