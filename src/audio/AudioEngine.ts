/**
 * Shared Web Audio graph: master chain with limiter, a generated convolution
 * reverb, a tempo-synced feedback delay, and separate SFX / music buses.
 *
 *   sfx ─┬──────────────┐
 *        ├─ reverbSend ─┤
 *        └─ delaySend ──┤
 *   music (duck · muffle · volume) ─┤
 *                                   └─ master (mute) ─ limiter ─ destination
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly music: GainNode;
  /** Music ducking (explosions briefly push the music down). */
  readonly musicDuck: GainNode;
  /** Lowpass on the music bus, used to muffle it while paused. */
  readonly musicFilter: BiquadFilterNode;
  readonly reverbSend: GainNode;
  readonly delaySend: GainNode;
  readonly noise: AudioBuffer;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(limiter);

    // Reverb: a synthetic stereo impulse response (decaying filtered noise).
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(2.8, 2.6);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    convolver.connect(reverbReturn).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(convolver);

    // Feedback delay (dotted eighth at the music tempo) with darkening repeats.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / 112) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    delay.connect(tone).connect(fb).connect(delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.5;
    tone.connect(delayOut);
    delayOut.connect(this.master);
    delayOut.connect(this.reverbSend);
    this.delaySend = ctx.createGain();
    this.delaySend.connect(delay);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = 0.85;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.Q.value = 0.7;
    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.musicFilter).connect(this.music).connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // one-pole lowpass makes the tail darker and smoother
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - t * 0.35);
        data[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.01 ? i / (rate * 0.01) : 1);
      }
    }
    return buf;
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Duck the music under a big sound. */
  duck(amount: number, release = 0.5): void {
    const g = this.musicDuck.gain;
    const t = this.now;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - amount, t + 0.02);
    g.setTargetAtTime(1, t + 0.06, release / 3);
  }

  /** A per-sound output: panner + optional reverb/delay sends. */
  out(pan = 0, reverb = 0, delay = 0, dest: AudioNode = this.sfx): AudioNode {
    const ctx = this.ctx;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      p.connect(s).connect(this.reverbSend);
    }
    if (delay > 0) {
      const s = ctx.createGain();
      s.gain.value = delay;
      p.connect(s).connect(this.delaySend);
    }
    return p;
  }

  env(g: AudioParam, t: number, peak: number, attack: number, decay: number): void {
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone(
    dest: AudioNode,
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    glide: number,
    peak: number,
    attack: number,
    decay: number,
    detune = 0,
  ): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + Math.max(0.005, glide));
    this.env(g.gain, t, peak, attack, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  noiseHit(
    dest: AudioNode,
    t: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    peak: number,
    attack: number,
    decay: number,
  ): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + attack + decay);
    const g = ctx.createGain();
    this.env(g.gain, t, peak, attack, decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
