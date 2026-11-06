import type { EnemyDef } from './enemyTypes';

export type EnemyState = 'alive' | 'doomed' | 'dead';

export interface Enemy {
  id: number;
  def: EnemyDef;
  word: string;
  /** Number of letters correctly typed so far. */
  typed: number;
  /** Normalised lane position across the play field (0..1). */
  nx: number;
  /** Descent progress: 0 = spawn point above screen, 1 = touching the shield. */
  progress: number;
  /** Progress per second. */
  speed: number;
  age: number;
  phase: number;
  state: EnemyState;
  /** Seconds since the final letter was typed (safety net for the kill bolt). */
  doomTime: number;
  /** True until the player mistypes while locked onto this ship (perfect-word bonus). */
  clean: boolean;

  // --- derived each frame (pixels) ---
  px: number;
  py: number;
  /** Label centre x / top y. */
  lx: number;
  ly: number;
  labelW: number;
  r: number;

  // --- presentation timers (0..1) ---
  hitFlash: number;
  errorShake: number;
  lockT: number;
  spawnT: number;
  /** Pop animation for the most recently typed letter. */
  pop: number;
}

export interface Bolt {
  x: number;
  y: number;
  /** Previous positions for the trail. */
  trail: number[];
  enemy: Enemy;
  final: boolean;
  speed: number;
  age: number;
  /** 0..1, used to vary colour along a word. */
  heat: number;
  /** Last known target position (bolts finish their flight even if the target dies). */
  tx: number;
  ty: number;
}

export interface TurretState {
  angle: number;
  recoil: number;
  flash: number;
  heat: number;
  jam: number;
  power: number;
}
