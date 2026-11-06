import type { EnemyKind } from './enemyTypes';

export interface WaveParams {
  count: number;
  /** Mean seconds between spawns. */
  interval: number;
  maxAlive: number;
  speedMul: number;
  weights: Record<EnemyKind, number>;
  /** Chance that a scout spawn brings one or two wingmates. */
  swarmChance: number;
}

/**
 * Difficulty curve. Wave 1 is deliberately gentle; pressure ramps through
 * spawn rate, concurrency, speed, word length (see enemyTypes) and the
 * proportion of heavies.
 */
export function waveParams(wave: number): WaveParams {
  const w = Math.max(1, wave);
  return {
    count: Math.min(8 + (w - 1) * 3, 38),
    interval: Math.max(0.8, 2.9 * Math.pow(0.9, w - 1)),
    maxAlive: Math.min(3 + Math.floor((w - 1) * 0.75), 9),
    speedMul: Math.min(1 + (w - 1) * 0.075, 2.1),
    weights: {
      scout: 0.42 + Math.min(w * 0.02, 0.16),
      fighter: 0.55,
      heavy: w < 2 ? 0 : Math.min(0.1 + (w - 2) * 0.05, 0.36),
    },
    swarmChance: w < 3 ? 0 : Math.min(0.15 + (w - 3) * 0.04, 0.4),
  };
}
