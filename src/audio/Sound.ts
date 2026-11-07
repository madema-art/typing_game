import { AudioEngine, mtof } from './AudioEngine';
import { Music, type MusicState } from './Music';

/**
 * Game-facing sound API. Everything is synthesized; nothing plays until
 * `unlock()` is called from a user gesture.
 *
 * Player lasers are tuned to the chord the soundtrack is currently playing,
 * so typing a word plays an arpeggio that always sits in harmony.
 */
export class Sound {
  private e: AudioEngine | null = null;
  private music: Music | null = null;
  private _muted = false;
  private musicOn = true;
  private demo = false;
  private muffled = false;
  private pendingState: Partial<MusicState> = {};

  get ready(): boolean {
    return this.e !== null && this.e.ctx.state === 'running';
  }

  get muted(): boolean {
    return this._muted;
  }

  unlock(): void {
    if (!this.e) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.e = new AudioEngine(new Ctor({ latencyHint: 'interactive' }));
      } catch {
        return;
      }
      this.music = new Music(this.e);
      this.music.setState(this.pendingState);
      this.applyGains(true);
      this.music.start();
    }
    if (this.e.ctx.state === 'suspended') void this.e.ctx.resume();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    this.applyGains();
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    this.applyGains();
  }

  /** Quieter effects while the attract-mode demo plays behind the title. */
  setDemo(on: boolean): void {
    this.demo = on;
    this.applyGains();
  }

  private applyGains(instant = false): void {
    if (!this.e) return;
    const t = this.e.now;
    const tc = instant ? 0.001 : 0.08;
    this.e.master.gain.setTargetAtTime(this._muted ? 0 : 1, t, tc);
    this.e.music.gain.setTargetAtTime(this.musicOn ? (this.muffled ? 0.4 : 0.85) : 0, t, instant ? 0.001 : 0.3);
    this.e.sfx.gain.setTargetAtTime(this.demo ? 0.28 : 0.9, t, tc);
  }

  setMusicState(s: Partial<MusicState>): void {
    this.pendingState = { ...this.pendingState, ...s };
    this.music?.setState(s);
  }

  /** Muffle the soundtrack (pause screen). */
  setMuffled(on: boolean): void {
    this.muffled = on;
    if (!this.e) return;
    this.applyGains();
    this.e.musicFilter.frequency.setTargetAtTime(on ? 420 : 20000, this.e.now, on ? 0.08 : 0.25);
  }

  /** Position within the current beat (0..1), for syncing visuals to the soundtrack. */
  beatPhase(): number {
    if (!this.e || !this.music) return (performance.now() / 1000) * (112 / 60) % 1;
    return this.music.beatPhase(this.e.now);
  }

  // ------------------------------------------------------------------ helpers

  private note(index: number, from = 64): number {
    const e = this.e!;
    return this.music ? this.music.chordTone(e.now, index, from) : from + index * 3;
  }

  // ------------------------------------------------------------------ gameplay

  /** One laser bolt. `index` walks up the current chord. */
  shot(index: number, multiplier: number, pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const t = e.now;
    const m = this.note(index + (multiplier - 1), 64);
    const f = mtof(m);
    const out = e.out(pan * 0.6, 0.12, 0.16);
    // bright pluck with a quick downward "zap" at the head
    e.tone(out, t, 'square', f * 4, f * 2, 0.025, 0.035, 0.002, 0.07);
    e.tone(out, t, 'triangle', f * 2, f, 0.03, 0.12, 0.002, 0.16);
    e.tone(out, t, 'sine', f, f, 0.01, 0.07, 0.002, 0.2);
    e.noiseHit(out, t, 'highpass', 7000, 4000, 0.5, 0.03, 0.001, 0.025);
  }

  /** Final letter: a lightning strike and a bright chord stab. */
  strike(length: number, pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const t = e.now;
    const out = e.out(pan * 0.7, 0.35, 0.2);
    e.noiseHit(out, t, 'highpass', 5000, 1200, 0.6, 0.16, 0.001, 0.12);
    e.noiseHit(out, t + 0.01, 'bandpass', 3000, 600, 1.5, 0.08, 0.001, 0.25);
    const base = 64 + Math.min(12, length);
    for (let i = 0; i < 3; i++) {
      const f = mtof(this.note(i, base));
      e.tone(out, t, 'triangle', f, f, 0.01, 0.07, 0.003, 0.5);
      e.tone(out, t, 'sine', f * 2, f * 2, 0.01, 0.03, 0.003, 0.7);
    }
  }

  lock(pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(pan * 0.6, 0.05);
    e.tone(out, e.now, 'sine', 1800, 2400, 0.04, 0.03, 0.002, 0.06);
  }

  miss(): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.05);
    const t = e.now;
    e.tone(out, t, 'triangle', 130, 70, 0.12, 0.11, 0.003, 0.14);
    e.noiseHit(out, t, 'lowpass', 700, 200, 2, 0.06, 0.002, 0.1);
  }

  hit(pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(pan * 0.7, 0.08);
    e.noiseHit(out, e.now, 'bandpass', 4200, 2500, 3, 0.05, 0.001, 0.05);
  }

  explode(size: 'scout' | 'fighter' | 'heavy', pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const t = e.now;
    const s = size === 'heavy' ? 1.6 : size === 'fighter' ? 1.15 : 0.85;
    const out = e.out(pan * 0.75, 0.3 + s * 0.1);
    e.noiseHit(out, t, 'lowpass', 5000, 150, 0.8, 0.3 * s, 0.002, 0.45 * s);
    e.tone(out, t, 'sine', 140, 32, 0.35 * s, 0.5 * Math.min(1.2, s), 0.003, 0.4 * s);
    // crackle: scattered grains of noise after the blast
    for (let i = 0; i < 4 + s * 4; i++) {
      e.noiseHit(out, t + 0.04 + Math.random() * 0.35 * s, 'bandpass', 2000 + Math.random() * 4000, 800, 4, 0.05, 0.001, 0.03);
    }
    if (size === 'heavy') {
      e.tone(out, t + 0.03, 'sawtooth', 90, 30, 0.8, 0.12, 0.01, 0.9);
      e.noiseHit(out, t + 0.05, 'lowpass', 900, 60, 0.5, 0.14, 0.05, 1.1);
    }
    e.duck(0.25 * s, 0.4);
  }

  baseHit(pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const t = e.now;
    const out = e.out(pan * 0.5, 0.45);
    e.tone(out, t, 'sine', 95, 26, 0.7, 0.7, 0.003, 0.8);
    e.noiseHit(out, t, 'lowpass', 2400, 70, 1, 0.4, 0.003, 0.7);
    e.tone(out, t, 'sawtooth', 300, 60, 0.4, 0.08, 0.005, 0.4);
    // descending alarm
    e.tone(out, t + 0.08, 'square', 880, 660, 0.18, 0.04, 0.005, 0.2);
    e.tone(out, t + 0.3, 'square', 880, 660, 0.18, 0.035, 0.005, 0.2);
    e.duck(0.55, 0.9);
  }

  comboBreak(): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.2);
    e.tone(out, e.now, 'sawtooth', 520, 130, 0.35, 0.04, 0.005, 0.35);
    e.tone(out, e.now, 'triangle', 260, 65, 0.35, 0.06, 0.005, 0.35);
  }

  multiplierUp(mult: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.35, 0.3);
    const t = e.now;
    for (let i = 0; i < 4; i++) {
      const f = mtof(this.note(i + mult, 69));
      e.tone(out, t + i * 0.055, 'triangle', f, f, 0.01, 0.07, 0.003, 0.35);
      e.tone(out, t + i * 0.055, 'sine', f * 2, f * 2, 0.01, 0.025, 0.003, 0.4);
    }
  }

  overdrive(): void {
    if (!this.ready) return;
    const e = this.e!;
    const t = e.now;
    const out = e.out(0, 0.5, 0.2);
    e.noiseHit(out, t, 'bandpass', 300, 6000, 3, 0.12, 0.5, 0.25);
    for (let i = 0; i < 6; i++) {
      const f = mtof(this.note(i, 69));
      e.tone(out, t + 0.45 + i * 0.04, 'sawtooth', f, f, 0.01, 0.035, 0.004, 0.6);
    }
    e.tone(out, t + 0.45, 'sine', 55, 55, 0.01, 0.3, 0.01, 0.8);
  }

  perfect(pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(pan * 0.5, 0.4, 0.3);
    const f = mtof(this.note(3, 76));
    e.tone(out, e.now + 0.06, 'sine', f, f, 0.01, 0.05, 0.003, 0.6);
    e.tone(out, e.now + 0.06, 'sine', f * 1.5, f * 1.5, 0.01, 0.025, 0.003, 0.6);
  }

  spawnHeavy(pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(pan * 0.8, 0.5);
    const t = e.now;
    e.tone(out, t, 'sawtooth', 55, 52, 1, 0.06, 0.3, 0.9);
    e.tone(out, t, 'sawtooth', 82.4, 78, 1, 0.04, 0.3, 0.9);
    e.noiseHit(out, t, 'lowpass', 200, 900, 2, 0.05, 0.4, 0.5);
  }

  waveStart(): void {
    if (!this.ready) return;
    const e = this.e!;
    const t = e.now;
    const out = e.out(0, 0.5);
    e.noiseHit(out, t, 'bandpass', 180, 5000, 2.5, 0.12, 1.3, 0.2);
    e.tone(out, t, 'sawtooth', 110, 440, 1.4, 0.035, 1.2, 0.3);
    e.tone(out, t + 1.45, 'sine', 70, 35, 0.4, 0.4, 0.004, 0.6);
    e.noiseHit(out, t + 1.45, 'lowpass', 3000, 200, 0.7, 0.12, 0.003, 0.6);
  }

  waveClear(): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.55, 0.35);
    const t = e.now;
    for (let i = 0; i < 6; i++) {
      const f = mtof(this.note(i, 64));
      e.tone(out, t + i * 0.07, 'triangle', f, f, 0.01, 0.07, 0.003, 0.7);
      e.tone(out, t + i * 0.07, 'sine', f * 2, f * 2, 0.01, 0.03, 0.003, 0.9);
    }
  }

  repair(): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.5);
    e.tone(out, e.now + 0.5, 'sine', 300, 1200, 0.6, 0.06, 0.05, 0.6);
  }

  gameOver(): void {
    if (!this.ready) return;
    const e = this.e!;
    const t = e.now;
    const out = e.out(0, 0.7);
    e.tone(out, t, 'sine', 80, 22, 2.4, 0.8, 0.005, 2.6);
    e.noiseHit(out, t, 'lowpass', 3500, 40, 0.6, 0.45, 0.005, 2.4);
    [69, 64, 60, 57, 52].forEach((m, i) => e.tone(out, t + 0.6 + i * 0.3, 'triangle', mtof(m), mtof(m) * 0.985, 0.6, 0.06, 0.01, 0.9));
    e.duck(0.9, 2.5);
  }

  thunder(intensity: number, pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(pan * 0.8, 0.6);
    const d = 0.25 + Math.random() * 0.5;
    e.noiseHit(out, e.now + d, 'lowpass', 600, 45, 0.5, 0.06 * intensity, 0.08, 1.8 + intensity);
    e.noiseHit(out, e.now + d, 'lowpass', 2500, 300, 0.5, 0.025 * intensity, 0.005, 0.25);
  }

  /** Menu typing: plays up the current chord. */
  ui(index = 0): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.2, 0.2);
    const f = mtof(this.note(index, 69));
    e.tone(out, e.now, 'triangle', f, f, 0.01, 0.08, 0.003, 0.25);
  }

  uiConfirm(): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.4, 0.3);
    for (let i = 0; i < 3; i++) {
      const f = mtof(this.note(i + 2, 69));
      e.tone(out, e.now + i * 0.06, 'triangle', f, f, 0.01, 0.07, 0.003, 0.4);
    }
  }

  // ------------------------------------------------------------------ sentences & vocabulary

  /** The space bar: a soft, airy click as the lock jumps to the next ship. */
  space(pan: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(pan * 0.5, 0.05);
    e.noiseHit(out, e.now, 'bandpass', 2400, 1800, 2, 0.035, 0.001, 0.035);
    e.tone(out, e.now, 'sine', 900, 1300, 0.04, 0.02, 0.002, 0.05);
  }

  /** A new transmission arrives: radio-ish chirp. */
  transmission(): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.3, 0.25);
    const t = e.now;
    e.noiseHit(out, t, 'bandpass', 1200, 3200, 6, 0.04, 0.02, 0.18);
    e.tone(out, t + 0.02, 'square', 1046.5, 1046.5, 0.01, 0.02, 0.003, 0.06);
    e.tone(out, t + 0.1, 'square', 1568, 1568, 0.01, 0.02, 0.003, 0.08);
  }

  /** A whole transmission typed: a short rising flourish (brighter when perfect). */
  passageComplete(perfect: boolean): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0, 0.45, 0.3);
    const t = e.now + 0.12;
    const n = perfect ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const f = mtof(this.note(i + 1, 72));
      e.tone(out, t + i * 0.06, 'triangle', f, f, 0.01, 0.06, 0.003, 0.45);
      if (perfect) e.tone(out, t + i * 0.06, 'sine', f * 2, f * 2, 0.01, 0.025, 0.003, 0.6);
    }
  }

  /** A lexicon word captured: a sparkly, music-box arpeggio. */
  lexicon(isNew: boolean): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0.3, 0.6, 0.4);
    const t = e.now + 0.08;
    const steps = isNew ? [0, 2, 4, 7, 9] : [0, 4, 7];
    steps.forEach((step, i) => {
      const f = mtof(this.note(step, 76));
      e.tone(out, t + i * 0.07, 'sine', f, f, 0.01, 0.06, 0.002, 0.7);
      e.tone(out, t + i * 0.07, 'triangle', f * 3, f * 3, 0.01, 0.012, 0.002, 0.3);
    });
  }

  /** The coach speaks: a tiny two-note blip, flavoured by tone. */
  coach(tone: 'tip' | 'praise' | 'warn' | 'info'): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(0.4, 0.25);
    const base = tone === 'praise' ? 76 : tone === 'tip' ? 69 : 72;
    const a = mtof(this.note(0, base));
    const b = mtof(this.note(tone === 'tip' ? 0 : 2, base));
    e.tone(out, e.now, 'sine', a, a, 0.01, 0.035, 0.003, 0.12);
    e.tone(out, e.now + 0.09, 'sine', b, b, 0.01, 0.035, 0.003, 0.18);
  }

  /** Perfect-sentence streak tick; climbs with the streak. */
  streak(n: number): void {
    if (!this.ready) return;
    const e = this.e!;
    const out = e.out(-0.3, 0.35, 0.2);
    const f = mtof(this.note(Math.min(n, 10), 64));
    e.tone(out, e.now + 0.05, 'triangle', f, f, 0.01, 0.05, 0.003, 0.3);
    e.tone(out, e.now + 0.05, 'sine', f * 1.5, f * 1.5, 0.01, 0.02, 0.003, 0.35);
  }
}
