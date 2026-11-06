import { AudioEngine, mtof } from './AudioEngine';

export const BPM = 112;
const STEP = 60 / BPM / 4; // sixteenth note
const LOOKAHEAD = 0.16;

interface Chord {
  name: string;
  /** Pad voicing (MIDI). */
  voicing: number[];
  bass: number;
  /** Pitch classes of the chord, used to tune the player's lasers. */
  pcs: number[];
}

/** A minor progression: i – VI – III – VII – i – VI – VII – v */
const PROGRESSION: Chord[] = [
  { name: 'Am', voicing: [57, 60, 64, 69], bass: 45, pcs: [9, 0, 4] },
  { name: 'F', voicing: [57, 60, 65, 69], bass: 41, pcs: [5, 9, 0] },
  { name: 'C', voicing: [55, 60, 64, 67], bass: 48, pcs: [0, 4, 7] },
  { name: 'G', voicing: [55, 59, 62, 67], bass: 43, pcs: [7, 11, 2] },
  { name: 'Am', voicing: [57, 60, 64, 69], bass: 45, pcs: [9, 0, 4] },
  { name: 'F', voicing: [57, 60, 65, 69], bass: 41, pcs: [5, 9, 0] },
  { name: 'G', voicing: [55, 59, 62, 67], bass: 43, pcs: [7, 11, 2] },
  { name: 'Em', voicing: [55, 59, 64, 67], bass: 40, pcs: [4, 7, 11] },
];

// Overdrive lead motif: indexes into the chord's upper tones, -1 = rest.
const LEAD = [0, -1, 2, 1, 3, -1, 2, 4, 3, -1, 2, 1, 0, -1, 1, 2];

export interface MusicState {
  /** 0 title/ambient, 1 calm, 2 combat, 3 intense, 4 frantic */
  level: number;
  overdrive: boolean;
  danger: boolean;
}

/**
 * Procedural, adaptive soundtrack. A lookahead scheduler places notes on the
 * audio clock; layers enter and leave with the game's intensity.
 */
export class Music {
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private timer: number | undefined;
  private readonly pad: GainNode;
  private readonly pump: GainNode;
  private readonly drums: GainNode;
  private readonly padFilter: BiquadFilterNode;
  state: MusicState = { level: 0, overdrive: false, danger: false };
  private startTime = 0;

  constructor(private e: AudioEngine) {
    const ctx = e.ctx;
    // Pad / arp / bass go through a "sidechain" pump gain that dips on every kick.
    this.pump = ctx.createGain();
    this.pump.connect(e.musicDuck);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.8;
    this.pad = ctx.createGain();
    this.pad.gain.value = 0.5;
    this.pad.connect(this.padFilter).connect(this.pump);
    // Pad also feeds the reverb for a huge, soft space.
    const padVerb = ctx.createGain();
    padVerb.gain.value = 0.35;
    this.padFilter.connect(padVerb).connect(e.reverbSend);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.9;
    this.drums.connect(e.musicDuck);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.nextTime = this.e.now + 0.1;
    this.startTime = this.nextTime;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setState(s: Partial<MusicState>): void {
    const prev = this.state;
    this.state = { ...prev, ...s };
    const t = this.e.now;
    // Open the pad filter as intensity rises.
    const cutoff = [700, 1100, 1700, 2400, 3200][Math.max(0, Math.min(4, this.state.level))];
    this.padFilter.frequency.setTargetAtTime(cutoff, t, 0.8);
  }

  beatPhase(t: number): number {
    const beats = (t - this.startTime) / (STEP * 4);
    return ((beats % 1) + 1) % 1;
  }

  /** Chord sounding at audio time t (used to tune sound effects). */
  chordAt(t: number): Chord {
    const bars = Math.floor((t - this.startTime) / (STEP * 16));
    return PROGRESSION[((bars % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length];
  }

  /** The n-th chord tone at or above `fromMidi`. */
  chordTone(t: number, n: number, fromMidi = 64): number {
    const pcs = this.chordAt(t).pcs;
    let m = fromMidi;
    let found = -1;
    while (found < n) {
      if (pcs.includes(((m % 12) + 12) % 12)) found++;
      if (found === n) return m;
      m++;
    }
    return m;
  }

  private schedule(): void {
    const now = this.e.now;
    // If the tab was throttled, resync rather than burst-schedule stale notes.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      this.playStep(this.step, this.bar, this.nextTime);
      this.nextTime += STEP;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  private playStep(step: number, bar: number, t: number): void {
    const { level, overdrive, danger } = this.state;
    const chord = PROGRESSION[bar % PROGRESSION.length];
    const e = this.e;

    if (step === 0) this.padChord(chord, t);

    // Arpeggio: eighths when calm, sixteenths when intense.
    const arpEvery = level >= 3 ? 1 : 2;
    if (step % arpEvery === 0 && (level >= 1 || step % 4 === 0 || bar % 2 === 1)) {
      const up = chord.voicing.map((m) => m + 12);
      const pattern = [up[0], up[1], up[2], up[3], up[2] + 12, up[3], up[1], up[2]];
      const m = pattern[(step / arpEvery) % pattern.length | 0];
      const vel = (level === 0 ? 0.035 : 0.045) * (step % 4 === 0 ? 1.2 : 0.85);
      this.pluck(mtof(m), t, vel, level >= 2 ? 2800 : 1600);
    }

    if (level >= 1) {
      // Bass
      const bassEvery = level >= 2 ? 2 : 4;
      if (step % bassEvery === 0) {
        const oct = level >= 3 && step % 4 === 2 ? 12 : 0;
        this.bass(mtof(chord.bass - 12 + oct), t, level >= 2 ? 0.16 : 0.12);
      }
      // Hats
      if (step % 4 === 2) this.hat(t, 0.05, 0.05);
      else if (level >= 3 && step % 2 === 1) this.hat(t, 0.022, 0.03);
    }

    if (level >= 2) {
      if (step % 4 === 0) {
        this.kick(t);
        this.pumpAt(t);
      }
      if (step === 4 || step === 12) this.snare(t, 0.16);
      if (level >= 4 && step === 14) this.snare(t, 0.07);
    }

    if (overdrive && LEAD[step] >= 0 && step % 2 === 0) {
      const up = [...chord.voicing.map((m) => m + 12), chord.voicing[1] + 24];
      this.lead(mtof(up[LEAD[step] % up.length]), t);
    }

    if (danger && (step === 0 || step === 8)) {
      // Klaxon-like warning ping
      const out = e.out(0, 0.3, 0, e.musicDuck);
      e.tone(out, t, 'square', 1318.5, 1318.5, 0.01, 0.025, 0.005, 0.12);
      e.tone(out, t + 0.14, 'square', 987.8, 987.8, 0.01, 0.02, 0.005, 0.12);
    }
  }

  private padChord(chord: Chord, t: number): void {
    const e = this.e;
    const dur = STEP * 16;
    for (const m of chord.voicing) {
      for (const det of [-9, 9]) {
        const o = e.ctx.createOscillator();
        const g = e.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.03, t + 0.6);
        g.gain.setValueAtTime(0.03, t + dur - 0.1);
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
        o.connect(g).connect(this.pad);
        o.start(t);
        o.stop(t + dur + 1.3);
      }
    }
    // A low sub drone under the pad.
    const o = e.ctx.createOscillator();
    const g = e.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = mtof(chord.bass - 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    o.connect(g).connect(this.pump);
    o.start(t);
    o.stop(t + dur + 0.7);
  }

  private pluck(f: number, t: number, vel: number, bright: number): void {
    const e = this.e;
    const ctx = e.ctx;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const fl = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'square';
    o2.type = 'triangle';
    o.frequency.value = f;
    o2.frequency.value = f * 2;
    fl.type = 'lowpass';
    fl.Q.value = 4;
    fl.frequency.setValueAtTime(bright, t);
    fl.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    e.env(g.gain, t, vel, 0.004, 0.32);
    o.connect(fl);
    o2.connect(fl);
    fl.connect(g);
    g.connect(this.pump);
    const send = ctx.createGain();
    send.gain.value = 0.45;
    g.connect(send).connect(e.delaySend);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.4);
    o2.stop(t + 0.4);
  }

  private bass(f: number, t: number, vel: number): void {
    const e = this.e;
    const ctx = e.ctx;
    const o = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const fl = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    sub.type = 'sine';
    o.frequency.value = f;
    sub.frequency.value = f / 2;
    fl.type = 'lowpass';
    fl.Q.value = 6;
    fl.frequency.setValueAtTime(900, t);
    fl.frequency.exponentialRampToValueAtTime(140, t + 0.22);
    e.env(g.gain, t, vel, 0.006, 0.26);
    o.connect(fl).connect(g);
    sub.connect(g);
    g.connect(this.pump);
    o.start(t);
    sub.start(t);
    o.stop(t + 0.32);
    sub.stop(t + 0.32);
  }

  private kick(t: number): void {
    const e = this.e;
    e.tone(this.drums, t, 'sine', 160, 42, 0.11, 0.55, 0.002, 0.3);
    e.noiseHit(this.drums, t, 'lowpass', 2000, 400, 0.7, 0.06, 0.001, 0.02);
  }

  private snare(t: number, vel: number): void {
    const e = this.e;
    const out = e.out(0, 0.35, 0, this.drums);
    e.noiseHit(out, t, 'bandpass', 2200, 1400, 0.9, vel, 0.002, 0.17);
    e.tone(out, t, 'triangle', 220, 160, 0.06, vel * 0.6, 0.002, 0.09);
  }

  private hat(t: number, vel: number, decay: number): void {
    const out = this.e.out((Math.random() - 0.5) * 0.4, 0, 0, this.drums);
    this.e.noiseHit(out, t, 'highpass', 8000, 7000, 0.7, vel, 0.001, decay);
  }

  private lead(f: number, t: number): void {
    const e = this.e;
    const ctx = e.ctx;
    const out = e.out(0, 0.4, 0.35, e.musicDuck);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      const fl = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      fl.type = 'lowpass';
      fl.frequency.setValueAtTime(3500, t);
      fl.frequency.exponentialRampToValueAtTime(900, t + 0.3);
      e.env(g.gain, t, 0.03, 0.01, 0.3);
      o.connect(fl).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.36);
    }
  }

  private pumpAt(t: number): void {
    const g = this.pump.gain;
    g.setValueAtTime(0.45, t);
    g.linearRampToValueAtTime(1, t + STEP * 3);
  }
}
