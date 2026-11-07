import { Emitter } from '../core/events';
import type { Layout } from '../core/layout';
import { approach, clamp, rand } from '../core/math';
import { Coach, type CoachMessage } from './coach';
import { CONFIG } from './config';
import { waveParams, type WaveParams } from './director';
import { ENEMY_DEFS, type EnemyKind } from './enemyTypes';
import type { Bolt, Enemy, TurretState } from './entities';
import { Picker } from './picker';
import type { Profile, VocabState } from './profile';
import { Stats } from './stats';
import type { Passage } from './text/passage';
import type { VocabEntry } from './text/vocab';

export type GamePhase = 'idle' | 'playing' | 'dying' | 'over';
export type WavePhase = 'intro' | 'combat' | 'clear';

export interface GameEvents {
  /** A ship materialized out of the transmission bar. */
  spawn: { enemy: Enemy };
  lock: { enemy: Enemy };
  /** A correct letter (not a space). Non-final letters fire a travelling bolt. */
  shot: { enemy: Enemy; index: number; final: boolean; x: number; y: number; angle: number };
  /** The final letter of a word calls down an instant lightning strike. */
  strike: { enemy: Enemy; x0: number; y0: number; x1: number; y1: number };
  space: { next: Enemy | null };
  hit: { enemy: Enemy; x: number; y: number };
  kill: { enemy: Enemy; x: number; y: number; points: number; multiplier: number; silent: boolean; perfect: boolean };
  miss: { enemy: Enemy | null; expected: string; typed: string };
  comboBreak: { combo: number; multiplier: number };
  multiplierUp: { multiplier: number };
  baseHit: { enemy: Enemy; x: number; y: number; damage: number; integrity: number };
  passageStart: { passage: Passage; index: number; total: number };
  sentenceDone: { perfect: boolean; streak: number };
  passageComplete: { perfect: boolean; bonus: number; wpm: number; crashed: number };
  vocab: { entry: VocabEntry; isNew: boolean; clean: boolean; state: VocabState };
  coach: CoachMessage;
  waveStart: { wave: number };
  waveClear: { wave: number; bonus: number; flawless: boolean; perfect: boolean; repaired: boolean };
  gameOver: { stats: Stats; wave: number };
}

/** Points multiplier for finishing a word (length >= 4) without a single miss. */
export const PERFECT_BONUS = 1.25;
const BASE_POINTS: Record<EnemyKind, number> = { scout: 60, fighter: 100, heavy: 160 };

/**
 * Gameplay simulation. Each transmission (one to three sentences) arrives as a
 * convoy: one ship per word, staggered by the player's measured typing speed so
 * the next word needed is always the closest. Nothing here touches the DOM.
 */
export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly coach: Coach;
  readonly picker: Picker;
  phase: GamePhase = 'idle';
  wavePhase: WavePhase = 'intro';
  wave = 0;
  waveTimer = 0;
  integrity: number = CONFIG.maxIntegrity;
  stats = new Stats();
  enemies: Enemy[] = [];
  bolts: Bolt[] = [];
  target: Enemy | null = null;
  turret: TurretState = { angle: 0, recoil: 0, flash: 0, heat: 0, jam: 0, power: 0 };
  time = 0;
  showHint = true;
  timeScale = 1;

  // ---- transmission state (read by the UI) ----
  passage: Passage | null = null;
  cursor = 0;
  /** Index of the word being typed (or next to type). */
  tokenIdx = 0;
  /** True when the next expected character is the space before the next word. */
  awaitingSpace = false;
  readonly crashed = new Set<number>();
  /** Bumps whenever the transmission changes in a way the teleprompter must redraw. */
  revision = 0;
  /** Adaptive pace multiplier (higher = more room between words). */
  pace = 1;

  private ships: Array<Enemy | null> = [];
  private partErrors: number[] = [];
  private partCrashed: boolean[] = [];
  private partsDone = 0;
  private passageCorrect = 0;
  private passageErrors = 0;
  private firstKeyAt = -1;
  private lastKeyAt = -1;
  private prevChar = '';
  private passagesDone = 0;
  private gap = 0;
  private params: WaveParams = waveParams(1);
  private nextId = 1;
  private dyingTimer = 0;
  private dyingPopTimer = 0;
  private idleTime = 0;
  private demoType = 0;
  private demoLane = 0;
  private harderRun = 0;

  constructor(
    private layout: Layout,
    readonly profile: Profile,
  ) {
    this.coach = new Coach(profile);
    this.picker = new Picker(profile, this.coach);
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    this.phase = 'playing';
    this.wave = 0;
    this.integrity = CONFIG.maxIntegrity;
    this.stats = new Stats();
    this.clearConvoy();
    this.time = 0;
    this.timeScale = 1;
    this.showHint = true;
    this.pace = 1;
    this.harderRun = 0;
    this.turret.power = 0;
    this.coach.reset();
    this.picker.reset();
    this.profile.touchDay();
    this.events.emit('coach', this.coach.welcome(this.time));
    this.beginWave(1);
  }

  /** Back to the attract-mode demo that plays behind the title screen. */
  toIdle(): void {
    this.phase = 'idle';
    this.clearConvoy();
    this.timeScale = 1;
    this.gap = 1.2;
  }

  private clearConvoy(): void {
    this.enemies = [];
    this.bolts = [];
    this.ships = [];
    this.target = null;
    this.passage = null;
    this.crashed.clear();
    this.revision++;
  }

  private beginWave(n: number): void {
    this.wave = n;
    this.params = waveParams(n);
    this.passagesDone = 0;
    this.gap = CONFIG.waveIntroTime;
    this.wavePhase = 'intro';
    this.waveTimer = CONFIG.waveIntroTime;
    this.stats.resetWave();
    this.events.emit('waveStart', { wave: n });
  }

  get overdrive(): boolean {
    return this.phase === 'playing' && this.stats.multiplier >= 5;
  }

  /** Words per minute the convoy spacing assumes. */
  get assumedCps(): number {
    return clamp(this.profile.data.cps, 1.2, 14);
  }

  // ------------------------------------------------------------------ convoy

  private startPassage(passage: Passage, demo = false): void {
    const L = this.layout;
    this.clearConvoy();
    this.passage = passage;
    this.cursor = 0;
    this.tokenIdx = 0;
    this.awaitingSpace = false;
    this.partErrors = passage.parts.map(() => 0);
    this.partCrashed = passage.parts.map(() => false);
    this.partsDone = 0;
    this.passageCorrect = 0;
    this.passageErrors = 0;
    this.firstKeyAt = -1;
    this.lastKeyAt = -1;
    this.prevChar = '';

    const descent = demo ? 9 : this.params.descent;
    const cps = demo ? 4.5 : this.assumedCps;
    // The attract-mode column stacks words vertically, so it needs extra room between them.
    const slack = demo ? 2.4 : this.params.slack * this.pace;
    const margin = 26;
    const gapX = 30 * L.k;
    let laneLo = L.fieldX + margin;
    let laneHi = L.fieldX + L.fieldW - margin;
    if (demo) {
      // Attract mode: a single column down one side of the title screen.
      this.demoLane = 1 - this.demoLane;
      const w = Math.max(150, L.fieldW * 0.12);
      laneLo = this.demoLane ? L.fieldX + L.fieldW - margin - w : L.fieldX + margin;
      laneHi = laneLo + w;
    }
    let x = demo ? laneLo : laneLo + rand(0, (laneHi - laneLo) * 0.22);

    passage.tokens.forEach((tok, i) => {
      const letters = tok.text.replace(/[^A-Za-z0-9]/g, '').length;
      const kind: EnemyKind = letters <= 3 ? 'scout' : letters <= 7 ? 'fighter' : 'heavy';
      const def = ENEMY_DEFS[kind];
      const r = def.radius * L.k;
      const labelW = L.labelWidth(tok.text.length);
      const w = Math.max(labelW, r * 2.4);
      if (demo || x + w > laneHi) x = demo ? laneLo + (laneHi - laneLo - w) / 2 : laneLo + rand(0, 50 * L.k);
      const cx = x + w / 2;
      x += w + gapX;
      const delay = (tok.start / cps) * slack;
      const e: Enemy = {
        id: this.nextId++,
        def,
        word: tok.text,
        typed: 0,
        token: i,
        vocab: tok.vocab,
        nx: (cx - L.fieldX) / L.fieldW,
        progress: -delay / descent,
        speed: 1 / descent,
        age: 0,
        phase: Math.random() * Math.PI * 2,
        state: 'alive',
        doomTime: 0,
        clean: true,
        px: 0,
        py: -999,
        lx: 0,
        ly: -999,
        labelW,
        r,
        hitFlash: 0,
        errorShake: 0,
        lockT: 0,
        spawnT: 0,
        pop: 0,
      };
      this.place(e);
      this.enemies.push(e);
      this.ships.push(e);
    });
    this.retarget();
    this.revision++;
    if (!demo) {
      this.passagesDone++;
      this.events.emit('passageStart', { passage, index: this.passagesDone, total: this.params.passages });
    }
  }

  /** Bring a ship in immediately (the player is ahead of the convoy). */
  private summon(e: Enemy | null): void {
    if (!e || e.state !== 'alive' || e.progress >= 0) return;
    e.progress = 0;
    this.place(e);
    this.events.emit('spawn', { enemy: e });
  }

  private retarget(): void {
    const next = this.ships[this.tokenIdx] ?? null;
    if (next !== this.target) {
      this.target = next && next.state === 'alive' ? next : null;
      if (this.target) {
        this.target.lockT = 0;
        if (this.target.progress >= 0) this.events.emit('lock', { enemy: this.target });
      }
    }
  }

  /** Skip words whose ships already crashed into the shield. */
  private skipCrashed(): void {
    const p = this.passage;
    if (!p) return;
    let moved = false;
    while (this.tokenIdx < p.tokens.length && this.crashed.has(this.tokenIdx)) {
      this.tokenIdx++;
      moved = true;
    }
    if (!moved) return;
    this.awaitingSpace = false;
    this.cursor = this.tokenIdx < p.tokens.length ? p.tokens[this.tokenIdx].start : p.text.length;
    this.revision++;
    this.checkParts();
    if (this.tokenIdx >= p.tokens.length) this.completePassage();
    else {
      this.summon(this.ships[this.tokenIdx]);
      this.retarget();
    }
  }

  /** Close out any sentence whose words are all done (typed or crashed). */
  private checkParts(): void {
    const p = this.passage;
    if (!p) return;
    while (this.partsDone < p.parts.length) {
      const part = p.parts[this.partsDone];
      const lastTok = p.tokens.reduce((m, t, i) => (t.part === this.partsDone ? i : m), -1);
      if (lastTok >= this.tokenIdx || lastTok < 0) break;
      const perfect = this.partErrors[this.partsDone] === 0 && !this.partCrashed[this.partsDone];
      const s = this.stats;
      s.sentences++;
      if (perfect) {
        s.perfectSentences++;
        s.perfectStreak++;
        s.bestPerfectStreak = Math.max(s.bestPerfectStreak, s.perfectStreak);
        if (s.perfectStreak > this.profile.data.records.bestPerfectStreak) this.profile.data.records.bestPerfectStreak = s.perfectStreak;
      } else {
        s.perfectStreak = 0;
      }
      this.events.emit('sentenceDone', { perfect, streak: s.perfectStreak });
      const msg = perfect ? this.coach.onPerfectStreak(s.perfectStreak, this.time) : null;
      if (msg) this.events.emit('coach', msg);
      void part;
      this.partsDone++;
    }
  }

  private completePassage(): void {
    const p = this.passage;
    if (!p || this.phase !== 'playing') {
      this.passage = null;
      this.gap = rand(1.2, 2.2);
      return;
    }
    const s = this.stats;
    const crashed = this.crashed.size;
    const typedChars = this.passageCorrect;
    const span = this.lastKeyAt - this.firstKeyAt;
    const cps = span > 1 ? (typedChars - 1) / span : 0;
    const acc = typedChars + this.passageErrors > 0 ? typedChars / (typedChars + this.passageErrors) : 1;
    const perfect = crashed === 0 && this.passageErrors === 0;
    const mult = s.multiplier;
    let bonus = 0;
    if (crashed === 0) {
      bonus = 12 * p.text.length * mult;
      if (perfect) bonus = Math.round(bonus * 1.5) + 50 * s.perfectStreak;
      s.score += bonus;
    }

    // Learn from the transmission and adapt the pace.
    const wasNew = this.profile.isNew;
    const prevBest = this.profile.data.records.bestPassageWpm;
    if (cps > 0) this.profile.recordPassage(cps, acc, typedChars);
    const wpm = Math.round(cps * 12);
    if (wasNew && cps > 0 && this.profile.data.passages === 1) this.events.emit('coach', this.coach.firstReading(wpm, this.time));
    else if (wpm > prevBest && prevBest > 0 && typedChars >= 25) this.events.emit('coach', this.coach.onRecord(wpm, this.time));

    if (crashed > 0) {
      this.pace = clamp(this.pace * (1 + 0.12 * Math.min(3, crashed)), 0.65, 1.8);
      this.harderRun = 0;
      const msg = this.coach.onPace('easier', this.time);
      if (msg) this.events.emit('coach', msg);
    } else if (acc >= 0.96) {
      this.pace = clamp(this.pace * 0.93, 0.65, 1.8);
      this.harderRun++;
      if (this.harderRun === 2 || this.harderRun === 5) {
        const msg = this.coach.onPace('harder', this.time);
        if (msg) this.events.emit('coach', msg);
      }
    }
    this.profile.save();
    this.events.emit('passageComplete', { perfect, bonus, wpm, crashed });
    this.passage = null;
    this.target = null;
    this.gap = 1.1;
    this.revision++;
  }

  // ------------------------------------------------------------------ input

  /** Handle one typed character (case-sensitive; ' ' for space). Returns true if consumed. */
  type(ch: string): boolean {
    if (this.phase !== 'playing' || !this.passage || this.wavePhase !== 'combat') return false;
    return this.press(ch, false);
  }

  private press(ch: string, demo: boolean): boolean {
    const p = this.passage;
    if (!p || this.tokenIdx >= p.tokens.length) return false;
    const expected = p.text[this.cursor];
    if (expected === undefined) return false;
    const ship = this.ships[this.tokenIdx];
    const latency = this.lastKeyAt >= 0 ? (this.time - this.lastKeyAt) * 1000 : null;

    if (!demo) {
      this.profile.record(expected, ch, this.prevChar, latency);
      const msg = this.coach.onKey(expected, ch, this.time);
      if (msg) this.events.emit('coach', msg);
      if (this.firstKeyAt < 0) this.firstKeyAt = this.time;
      this.lastKeyAt = this.time;
    }

    if (ch !== expected) {
      if (!demo) this.registerMiss(ship, expected, ch);
      return true;
    }

    this.prevChar = expected;
    if (!demo) {
      this.stats.typingStarted = true;
      this.showHint = false;
      const prevMult = this.stats.multiplier;
      this.stats.correct++;
      this.stats.waveCorrect++;
      this.stats.combo++;
      this.passageCorrect++;
      if (this.stats.combo > this.stats.maxCombo) this.stats.maxCombo = this.stats.combo;
      if (this.stats.combo > this.profile.data.records.bestCombo) this.profile.data.records.bestCombo = this.stats.combo;
      if (this.stats.multiplier > prevMult) this.events.emit('multiplierUp', { multiplier: this.stats.multiplier });
    }

    if (this.awaitingSpace) {
      // The space hands the lock to the next ship.
      this.cursor++;
      this.awaitingSpace = false;
      this.revision++;
      this.summon(this.ships[this.tokenIdx]);
      this.retarget();
      this.skipCrashed();
      this.events.emit('space', { next: this.target });
      return true;
    }

    if (!ship) return true;
    this.summon(ship);
    ship.typed++;
    ship.pop = 1;
    this.cursor++;
    this.revision++;
    const final = ship.typed >= ship.word.length;
    this.aimAndRecoil(ship);
    const m = this.muzzle();
    this.events.emit('shot', { enemy: ship, index: ship.typed - 1, final, x: m.x, y: m.y, angle: this.turret.angle });
    if (!final) {
      this.bolts.push({
        x: m.x,
        y: m.y,
        trail: [m.x, m.y],
        enemy: ship,
        final: false,
        speed: CONFIG.boltSpeed * this.layout.k,
        age: 0,
        heat: ship.typed / ship.word.length,
        tx: ship.px,
        ty: ship.py,
      });
      return true;
    }

    // Word complete: lightning.
    this.events.emit('strike', { enemy: ship, x0: m.x, y0: m.y, x1: ship.px, y1: ship.py });
    this.killEnemy(ship, ship.px, ship.py, demo);
    if (!demo && ship.vocab) this.vocabMet(ship.token, ship.clean);
    this.tokenIdx++;
    this.checkParts();
    if (this.tokenIdx >= p.tokens.length) {
      this.completePassage();
      return true;
    }
    this.awaitingSpace = p.text[this.cursor] === ' ';
    if (this.crashed.has(this.tokenIdx)) this.skipCrashed();
    else {
      // Show the next ship right away so there is always something to aim at.
      this.summon(this.ships[this.tokenIdx]);
      this.retarget();
    }
    return true;
  }

  private registerMiss(ship: Enemy | null, expected: string, typed: string): void {
    this.stats.errors++;
    this.stats.waveErrors++;
    this.passageErrors++;
    const part = this.passage?.tokens[this.tokenIdx]?.part ?? 0;
    this.partErrors[part] = (this.partErrors[part] ?? 0) + 1;
    if (ship) {
      ship.errorShake = 1;
      if (!this.awaitingSpace) ship.clean = false;
    }
    this.turret.jam = 1;
    const combo = this.stats.combo;
    const multiplier = this.stats.multiplier;
    this.stats.combo = 0;
    this.events.emit('miss', { enemy: ship, expected, typed });
    if (combo >= 3) this.events.emit('comboBreak', { combo, multiplier });
  }

  private vocabMet(tokenIndex: number, clean: boolean): void {
    const p = this.passage;
    if (!p) return;
    const part = p.parts[p.tokens[tokenIndex].part];
    if (!part?.vocab) return;
    const { entry, context, isNew } = part.vocab;
    if (!this.stats.vocab.includes(entry.word)) this.stats.vocab.push(entry.word);
    const state = this.profile.vocabMet(entry.word, context, clean);
    this.events.emit('vocab', { entry, isNew, clean, state });
  }

  // ------------------------------------------------------------------ combat

  muzzle(): { x: number; y: number } {
    const L = this.layout;
    const len = 46 * L.k;
    return {
      x: L.turretX + Math.sin(this.turret.angle) * len,
      y: L.turretY - Math.cos(this.turret.angle) * len,
    };
  }

  private aimAndRecoil(enemy: Enemy): void {
    this.turret.angle = approach(this.turret.angle, this.aimAngle(enemy), 60, 0.05);
    this.turret.recoil = 1;
    this.turret.flash = 1;
    this.turret.heat = Math.min(1, this.turret.heat + 0.07);
  }

  private aimAngle(e: Enemy): number {
    const L = this.layout;
    const a = Math.atan2(e.px - L.turretX, L.turretY - e.py);
    return clamp(a, -1.35, 1.35);
  }

  /** Recompute pixel positions from normalised state. Depth 0 = transmission bar, 1 = shield. */
  private place(e: Enemy): void {
    const L = this.layout;
    const gap = e.r * 0.9;
    const baseX = L.fx(e.nx);
    const weave = e.def.weaveAmp * 0.5 * L.k * Math.sin(e.age * e.def.weaveFreq + e.phase) * Math.min(1, e.age);
    const top = L.bandY + e.r + 6;
    const endY = L.endY(baseX, gap);
    e.px = baseX + weave;
    e.py = top + (endY - top) * e.progress;
    e.lx = baseX + weave * 0.25;
    e.ly = e.py + gap + L.labelOffset * 0.35;
    e.labelW = L.labelWidth(e.word.length);
  }

  // ------------------------------------------------------------------ update

  update(rawDt: number): void {
    const dt = rawDt * this.timeScale;
    this.updateTurret(dt);

    if (this.phase === 'idle') {
      this.idleTime += dt;
      this.time += dt;
      this.updateDemo(dt);
      this.updateEnemies(dt);
      this.updateBolts(dt);
      return;
    }
    if (this.phase === 'over') {
      this.updateBolts(dt);
      return;
    }

    this.time += dt;
    if (this.phase === 'dying') {
      this.updateDying(rawDt);
    } else {
      this.updateWave(dt);
      if (this.wavePhase === 'combat' && this.stats.typingStarted && this.target && this.target.progress >= 0) this.stats.activeTime += dt;
    }
    this.updateEnemies(dt);
    this.updateBolts(dt);
  }

  /** Attract mode: short sentences drift down one side and the turret types them itself. */
  private updateDemo(dt: number): void {
    if (!this.passage) {
      this.gap -= dt;
      if (this.gap <= 0 && this.enemies.length === 0) this.startPassage(this.picker.next(1, { demo: true }), true);
      return;
    }
    this.demoType -= dt;
    if (this.demoType > 0) return;
    this.demoType = rand(0.08, 0.16);
    const ship = this.ships[this.tokenIdx];
    // Wait until the word is well into view before typing it.
    if (ship && ship.progress < 0.3 && !this.awaitingSpace && ship.typed === 0) return;
    const ch = this.passage.text[this.cursor];
    if (ch !== undefined) this.press(ch, true);
  }

  private updateWave(dt: number): void {
    if (this.wavePhase === 'intro') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.wavePhase = 'combat';
        this.gap = 0.3;
      }
      return;
    }
    if (this.wavePhase === 'clear') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.beginWave(this.wave + 1);
      return;
    }
    if (this.passage) return;
    if (this.enemies.length || this.bolts.length) return;
    this.gap -= dt;
    if (this.gap > 0) return;
    if (this.passagesDone >= this.params.passages) this.clearWave();
    else this.startPassage(this.picker.next(this.wave));
  }

  private clearWave(): void {
    const s = this.stats;
    const flawless = s.waveDamage === 0;
    const perfect = s.waveErrors === 0 && s.waveCorrect > 0;
    let bonus = 250 * this.wave;
    if (flawless) bonus += 300 * this.wave;
    if (perfect) bonus += 300 * this.wave;
    let repaired = false;
    if (flawless && this.integrity < CONFIG.maxIntegrity) {
      this.integrity++;
      repaired = true;
    }
    s.score += bonus;
    this.wavePhase = 'clear';
    this.waveTimer = CONFIG.waveClearTime;
    this.events.emit('waveClear', { wave: this.wave, bonus, flawless, perfect, repaired });
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      const wasHidden = e.progress < 0;
      e.age += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      e.errorShake = Math.max(0, e.errorShake - dt * 4);
      e.lockT = Math.min(1, e.lockT + dt * 5);
      e.pop = Math.max(0, e.pop - dt * 7);
      if (e.state === 'alive') e.progress += e.speed * dt;
      if (e.progress >= 0) e.spawnT = Math.min(1, e.spawnT + dt * 3);
      this.place(e);
      if (wasHidden && e.progress >= 0) {
        this.events.emit('spawn', { enemy: e });
        if (e === this.target) this.events.emit('lock', { enemy: e });
      }
    }
    for (const e of this.enemies) {
      if (e.state === 'alive' && e.progress >= 1) this.hitBase(e);
    }
    this.enemies = this.enemies.filter((e) => e.state !== 'dead');
  }

  private hitBase(e: Enemy): void {
    e.state = 'dead';
    this.crashed.add(e.token);
    this.revision++;
    const part = this.passage?.tokens[e.token]?.part ?? 0;
    this.partCrashed[part] = true;
    if (this.phase === 'playing') {
      const damage = e.def.kind === 'heavy' ? 2 : 1;
      this.integrity = Math.max(0, this.integrity - damage);
      this.stats.waveDamage += damage;
      this.stats.wordsMissed++;
      const combo = this.stats.combo;
      const multiplier = this.stats.multiplier;
      this.stats.combo = 0;
      if (combo >= 3) this.events.emit('comboBreak', { combo, multiplier });
      this.events.emit('baseHit', { enemy: e, x: e.px, y: this.layout.shieldY(e.px), damage, integrity: this.integrity });
      if (e.vocab) this.vocabMet(e.token, false);
      if (this.integrity <= 0) {
        this.beginDying();
        return;
      }
    } else {
      this.events.emit('kill', { enemy: e, x: e.px, y: e.py, points: 0, multiplier: 1, silent: true, perfect: false });
    }
    if (e.token === this.tokenIdx) this.skipCrashed();
  }

  private killEnemy(e: Enemy, x: number, y: number, silent = false): void {
    if (e.state === 'dead') return;
    e.state = 'dead';
    let points = 0;
    const mult = this.stats.multiplier;
    const perfect = !silent && e.clean && e.word.length >= 4;
    if (!silent && this.phase === 'playing') {
      points = Math.round((BASE_POINTS[e.def.kind] + e.word.length * 10) * mult * (perfect ? PERFECT_BONUS : 1) * (e.vocab ? 2 : 1));
      this.stats.score += points;
      this.stats.kills++;
    }
    if (this.target === e) this.target = null;
    this.events.emit('kill', { enemy: e, x, y, points, multiplier: mult, silent, perfect });
  }

  private updateBolts(dt: number): void {
    const keep: Bolt[] = [];
    for (const b of this.bolts) {
      b.age += dt;
      const e = b.enemy;
      if (e.state !== 'dead') {
        b.tx = e.px;
        b.ty = e.py;
      }
      const dx = b.tx - b.x;
      const dy = b.ty - b.y;
      const dist = Math.hypot(dx, dy);
      const step = b.speed * dt;
      if (dist <= step + e.r * 0.4) {
        if (e.state === 'alive') e.hitFlash = 1;
        this.events.emit('hit', { enemy: e, x: b.tx - (dx / (dist || 1)) * e.r * 0.5, y: b.ty - (dy / (dist || 1)) * e.r * 0.5 });
        continue;
      }
      b.x += (dx / dist) * step;
      b.y += (dy / dist) * step;
      b.trail.push(b.x, b.y);
      if (b.trail.length > 8) b.trail.splice(0, 2);
      keep.push(b);
    }
    this.bolts = keep;
  }

  private updateTurret(dt: number): void {
    const t = this.turret;
    const tgt = this.target;
    if (tgt && tgt.state === 'alive' && tgt.progress >= 0) {
      t.angle = approach(t.angle, this.aimAngle(tgt), 28, dt);
    } else {
      let threat: Enemy | null = null;
      for (const e of this.enemies) if (e.state === 'alive' && e.progress >= 0 && (!threat || e.progress > threat.progress)) threat = e;
      const sweep = Math.sin((this.phase === 'idle' ? this.idleTime : this.time) * 0.55) * 0.55;
      const desired = threat ? this.aimAngle(threat) * 0.6 + sweep * 0.25 : sweep;
      t.angle = approach(t.angle, desired, 3, dt);
    }
    t.recoil = approach(t.recoil, 0, 16, dt);
    t.flash = Math.max(0, t.flash - dt * 9);
    t.heat = Math.max(0, t.heat - dt * 0.45);
    t.jam = Math.max(0, t.jam - dt * 5);
    const targetPower = this.phase === 'dying' || this.phase === 'over' ? 0 : 1;
    t.power = approach(t.power, targetPower, this.phase === 'idle' ? 1.2 : 2.5, dt);
  }

  // ------------------------------------------------------------------ game over

  private beginDying(): void {
    this.phase = 'dying';
    this.dyingTimer = 0;
    this.dyingPopTimer = 0.35;
    this.target = null;
    this.profile.data.records.bestWpm = Math.max(this.profile.data.records.bestWpm, Math.round(this.stats.wpm));
    this.profile.save();
    this.events.emit('gameOver', { stats: this.stats, wave: this.wave });
  }

  private updateDying(rawDt: number): void {
    this.dyingTimer += rawDt;
    this.timeScale = clamp(1 - this.dyingTimer * 1.6, 0.3, 1);
    this.dyingPopTimer -= rawDt;
    if (this.dyingPopTimer <= 0) {
      this.dyingPopTimer = 0.16;
      const victim = this.enemies.find((e) => e.state !== 'dead' && e.progress >= 0);
      if (victim) this.killEnemy(victim, victim.px, victim.py, true);
    }
    if (this.dyingTimer >= CONFIG.dyingTime) {
      for (const e of this.enemies) if (e.state !== 'dead' && e.progress >= 0) this.killEnemy(e, e.px, e.py, true);
      this.enemies = [];
      this.passage = null;
      this.phase = 'over';
      this.timeScale = 1;
      this.revision++;
    }
  }

  /** 0..1 progress through the current wave, for the HUD bar. */
  get waveProgress(): number {
    const total = this.params.passages;
    const inPassage = this.passage ? this.cursor / Math.max(1, this.passage.text.length) : 0;
    const done = this.passage ? this.passagesDone - 1 : this.passagesDone;
    return clamp((done + inPassage) / total, 0, 1);
  }

  get passagesTotal(): number {
    return this.params.passages;
  }
}
