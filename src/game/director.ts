import { clamp } from '../core/math';

export interface WaveParams {
  /** Transmissions (one to three sentences each) in this wave. */
  passages: number;
  /** Seconds for a word to fall from the transmission bar to the shield. */
  descent: number;
  /**
   * Spacing between words relative to the player's measured typing speed.
   * 1.0 = words arrive exactly as fast as you type; 0.6 = they arrive faster
   * than you can type, so a backlog builds and the fall time is your buffer.
   * The game multiplies this by an adaptive pace factor.
   */
  slack: number;
}

/** Difficulty curve per wave. Wave 1 is gentle; the adaptive pace does the fine-tuning. */
export function waveParams(wave: number): WaveParams {
  const w = Math.max(1, wave);
  return {
    passages: Math.min(3 + Math.floor((w - 1) / 2), 7),
    descent: clamp(16 - (w - 1) * 0.7, 8, 16),
    slack: 1.0 - Math.min(w - 1, 9) * (0.42 / 9),
  };
}
