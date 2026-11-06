/** Central gameplay tuning knobs. */
export const CONFIG = {
  maxIntegrity: 10,
  /** Seconds the "WAVE N" banner shows before enemies arrive. */
  waveIntroTime: 2.6,
  /** Seconds of breathing room after a wave is cleared. */
  waveClearTime: 3.4,
  firstSpawnDelay: 0.5,
  /** Laser bolt speed in px/s at k=1. */
  boltSpeed: 3300,
  /** Length of the slow-motion game-over sequence (real seconds). */
  dyingTime: 2.4,
} as const;
