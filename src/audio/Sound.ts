/**
 * Procedural Web Audio sound design. No audio files.
 * The AudioContext is only created after a user gesture (see `unlock`).
 */

// Pentatonic minor ladder (semitone offsets) used to make each word a little melody.
const LADDER = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private noise!: AudioBuffer;
  private droneStarted = false;
  private _muted = false;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, now, 0.05);
    }
  }

  /** Call from a user-gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.9;
      this.master.connect(comp);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.8;
      this.sfx.connect(this.master);
      this.ambience = ctx.createGain();
      this.ambience.gain.value = 0;
      this.ambience.connect(this.master);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.droneStarted) this.startDrone();
  }

  suspendAmbience(on: boolean): void {
    if (!this.ctx) return;
    this.ambience.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.4);
  }

  // ------------------------------------------------------------------ primitives

  private get t(): number {
    return this.ctx!.currentTime;
  }

  private env(g: GainNode, start: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  }

  private osc(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, when = 0, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const t = this.t + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, peak, 0.004, dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, peak: number, fStart: number, fEnd: number, q = 0.7, when = 0, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const t = this.t + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(fStart, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, fEnd), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.005, dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private startDrone(): void {
    const ctx = this.ctx!;
    this.droneStarted = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = 3;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    const g = ctx.createGain();
    g.gain.value = 0.035;
    for (const [f, type] of [
      [55, 'sawtooth'],
      [55.4, 'sawtooth'],
      [82.4, 'triangle'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(filter);
      o.start();
    }
    filter.connect(g).connect(this.ambience);
    this.ambience.gain.setTargetAtTime(1, ctx.currentTime, 2);
  }

  // ------------------------------------------------------------------ game sounds

  /** Laser blip. `index` walks up a pentatonic ladder so each word sings. */
  shot(index: number, multiplier: number, final: boolean): void {
    if (!this.ready) return;
    const root = 440 * Math.pow(2, (multiplier - 1) * 2 / 12);
    const step = LADDER[Math.min(index, LADDER.length - 1)];
    const f = root * Math.pow(2, step / 12);
    this.osc('square', f * 2, f * 0.7, 0.075, 0.05);
    this.osc('triangle', f, f * 0.5, 0.09, 0.09);
    this.noiseBurst(0.03, 0.04, 6000, 2500, 0.5, 0, 'highpass');
    if (final) this.osc('sine', f * 2, f * 4, 0.12, 0.05, 0.02);
  }

  lock(): void {
    if (!this.ready) return;
    this.osc('sine', 1400, 1900, 0.05, 0.035);
  }

  miss(): void {
    if (!this.ready) return;
    this.osc('square', 140, 90, 0.12, 0.045);
    this.noiseBurst(0.07, 0.04, 900, 300, 2);
  }

  explode(size: 'scout' | 'fighter' | 'heavy'): void {
    if (!this.ready) return;
    const s = size === 'heavy' ? 1.6 : size === 'fighter' ? 1.15 : 0.85;
    this.noiseBurst(0.35 * s, 0.32 * s, 3200, 120, 0.8);
    this.osc('sine', 120 * (1.4 - s * 0.3), 34, 0.32 * s, 0.4 * Math.min(1, s));
    this.osc('sawtooth', 700, 80, 0.12, 0.05);
    if (size === 'heavy') this.noiseBurst(0.8, 0.12, 900, 60, 0.5, 0.06);
  }

  hit(): void {
    if (!this.ready) return;
    this.noiseBurst(0.04, 0.05, 4000, 1600, 1.5, 0, 'bandpass');
  }

  baseHit(): void {
    if (!this.ready) return;
    this.osc('sine', 90, 30, 0.6, 0.55);
    this.noiseBurst(0.6, 0.35, 1500, 60, 1);
    this.osc('square', 220, 200, 0.18, 0.05, 0.05);
    this.osc('square', 220, 200, 0.18, 0.05, 0.28);
  }

  comboBreak(): void {
    if (!this.ready) return;
    this.osc('triangle', 600, 180, 0.25, 0.06);
  }

  multiplierUp(mult: number): void {
    if (!this.ready) return;
    const base = 523.25 * Math.pow(2, (mult - 2) / 12 * 2);
    [0, 4, 7, 12].forEach((s, i) => this.osc('triangle', base * Math.pow(2, s / 12), base * Math.pow(2, s / 12), 0.16, 0.06, i * 0.05));
  }

  waveStart(): void {
    if (!this.ready) return;
    this.noiseBurst(1.2, 0.08, 200, 4000, 4, 0, 'bandpass');
    this.osc('sawtooth', 110, 220, 0.9, 0.04);
    this.osc('sine', 220, 440, 0.9, 0.05, 0.1);
  }

  waveClear(): void {
    if (!this.ready) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.osc('triangle', f, f, 0.35, 0.07, i * 0.07));
    notes.forEach((f, i) => this.osc('sine', f / 2, f / 2, 0.5, 0.04, i * 0.07));
  }

  repair(): void {
    if (!this.ready) return;
    this.osc('sine', 300, 900, 0.5, 0.06, 0.45);
  }

  gameOver(): void {
    if (!this.ready) return;
    this.osc('sine', 70, 25, 2.5, 0.6);
    this.noiseBurst(2.2, 0.35, 2400, 40, 0.6);
    [392, 311.1, 261.6, 196].forEach((f, i) => this.osc('triangle', f, f * 0.98, 0.7, 0.06, 0.5 + i * 0.32));
  }

  thunder(intensity: number): void {
    if (!this.ready) return;
    const d = 0.25 + Math.random() * 0.4;
    this.noiseBurst(1.6 + intensity, 0.07 * intensity, 500, 50, 0.4, d);
  }

  ui(): void {
    if (!this.ready) return;
    this.osc('triangle', 880, 1320, 0.06, 0.05);
  }

  uiConfirm(): void {
    if (!this.ready) return;
    this.osc('triangle', 660, 660, 0.12, 0.06);
    this.osc('triangle', 990, 990, 0.18, 0.06, 0.08);
  }
}
