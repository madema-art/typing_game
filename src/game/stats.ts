/** Score, combo and typing-performance tracking. */
export const MULT_THRESHOLDS = [0, 10, 25, 50, 80] as const;

export class Stats {
  score = 0;
  combo = 0;
  maxCombo = 0;
  correct = 0;
  errors = 0;
  kills = 0;
  /** Seconds of active combat time since the first keystroke (excludes pauses, menus, wave breaks). */
  activeTime = 0;
  typingStarted = false;

  // sentences & streaks
  sentences = 0;
  perfectSentences = 0;
  perfectStreak = 0;
  bestPerfectStreak = 0;
  wordsMissed = 0;
  /** Lexicon words met this run. */
  vocab: string[] = [];

  // per-wave counters
  waveCorrect = 0;
  waveErrors = 0;
  waveDamage = 0;

  get multiplier(): number {
    let m = 1;
    for (let i = 0; i < MULT_THRESHOLDS.length; i++) if (this.combo >= MULT_THRESHOLDS[i]) m = i + 1;
    return m;
  }

  /** Combo needed for the next multiplier tier, or null at max. */
  get nextThreshold(): number | null {
    const m = this.multiplier;
    return m < MULT_THRESHOLDS.length ? MULT_THRESHOLDS[m] : null;
  }

  get accuracy(): number {
    const total = this.correct + this.errors;
    return total === 0 ? 1 : this.correct / total;
  }

  /** Words per minute: (correct chars / 5) / active minutes. */
  get wpm(): number {
    if (this.activeTime < 1.5 || this.correct === 0) return 0;
    return this.correct / 5 / (this.activeTime / 60);
  }

  resetWave(): void {
    this.waveCorrect = 0;
    this.waveErrors = 0;
    this.waveDamage = 0;
  }
}
