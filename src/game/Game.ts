import { Emitter } from '../core/events';
import type { Layout } from '../core/layout';
import { approach, clamp, rand, weighted } from '../core/math';
import { CONFIG } from './config';
import { waveParams, type WaveParams } from './director';
import { ENEMY_DEFS, type EnemyKind } from './enemyTypes';
import type { Bolt, Enemy, TurretState } from './entities';
import { Stats } from './stats';
import { WordPicker } from './words';

export type GamePhase = 'idle' | 'playing' | 'dying' | 'over';
export type WavePhase = 'intro' | 'combat' | 'clear';

export interface GameEvents {
  spawn: { enemy: Enemy };
  lock: { enemy: Enemy };
  release: { enemy: Enemy };
  /** A correct letter. Non-final letters fire a travelling bolt. */
  shot: { enemy: Enemy; index: number; final: boolean; x: number; y: number; angle: number };
  /** The final letter calls down an instant lightning strike. */
  strike: { enemy: Enemy; x0: number; y0: number; x1: number; y1: number };
  hit: { enemy: Enemy; x: number; y: number };
  kill: { enemy: Enemy; x: number; y: number; points: number; multiplier: number; silent: boolean; perfect: boolean };
  miss: { enemy: Enemy | null };
  comboBreak: { combo: number; multiplier: number };
  multiplierUp: { multiplier: number };
  baseHit: { enemy: Enemy; x: number; y: number; damage: number; integrity: number };
  waveStart: { wave: number };
  waveClear: { wave: number; bonus: number; flawless: boolean; perfect: boolean; repaired: boolean };
  gameOver: { stats: Stats; wave: number };
}

/** Points multiplier for finishing a word (length ≥ 4) without a single miss. */
export const PERFECT_BONUS = 1.25;

/**
 * Pure gameplay simulation: enemies, targeting, typing, scoring, waves.
 * Rendering and audio listen to `events`; nothing here touches the DOM.
 */
export class Game {
  readonly events = new Emitter<GameEvents>();
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
  /** Seconds of simulated time since the run started. */
  time = 0;
  /** Tutorial hint shown until the first lock in a run. */
  showHint = true;
  /** Time scale (slow motion during the game-over sequence). */
  timeScale = 1;

  private params: WaveParams = waveParams(1);
  private spawned = 0;
  private spawnTimer = 0;
  private swarmQueue: number[] = [];
  private nextId = 1;
  private words = new WordPicker();
  private dyingTimer = 0;
  private dyingPopTimer = 0;
  private idleTime = 0;
  private demoSpawn = 1.5;
  private demoType = 0;

  constructor(private layout: Layout) {}

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    this.phase = 'playing';
    this.wave = 0;
    this.integrity = CONFIG.maxIntegrity;
    this.stats = new Stats();
    this.enemies = [];
    this.bolts = [];
    this.target = null;
    this.time = 0;
    this.timeScale = 1;
    this.showHint = true;
    this.words.reset();
    this.turret.power = 0;
    this.beginWave(1);
  }

  /** Back to the attract-mode demo that plays behind the title screen. */
  toIdle(): void {
    this.phase = 'idle';
    this.enemies = [];
    this.bolts = [];
    this.target = null;
    this.timeScale = 1;
    this.demoSpawn = 1.2;
  }

  private beginWave(n: number): void {
    this.wave = n;
    this.params = waveParams(n);
    this.spawned = 0;
    this.spawnTimer = CONFIG.firstSpawnDelay;
    this.swarmQueue = [];
    this.wavePhase = 'intro';
    this.waveTimer = CONFIG.waveIntroTime;
    this.stats.resetWave();
    this.events.emit('waveStart', { wave: n });
  }

  get overdrive(): boolean {
    return this.phase === 'playing' && this.stats.multiplier >= 5;
  }

  // ------------------------------------------------------------------ input

  /** Handle one typed lowercase letter. Returns true if it was consumed. */
  type(ch: string): boolean {
    if (this.phase !== 'playing') return false;

    let t = this.target;
    if (t && t.state !== 'alive') t = this.target = null;

    if (!t) {
      const visible = this.enemies.filter((e) => e.state === 'alive' && this.isTargetable(e));
      if (visible.length === 0) return false; // nothing to shoot at: ignore, don't penalise
      t = this.acquire(ch, visible);
      if (!t) {
        this.registerMiss(null);
        return true;
      }
      this.lockOn(t);
    }

    if (ch !== t.word[t.typed]) {
      this.registerMiss(t);
      return true;
    }

    this.stats.typingStarted = true;
    const prevMult = this.stats.multiplier;
    this.stats.correct++;
    this.stats.waveCorrect++;
    this.stats.combo++;
    if (this.stats.combo > this.stats.maxCombo) this.stats.maxCombo = this.stats.combo;
    if (this.stats.multiplier > prevMult) this.events.emit('multiplierUp', { multiplier: this.stats.multiplier });
    this.advance(t);
    return true;
  }

  /** Backspace: drop the current lock (progress on that ship is kept). */
  release(): void {
    if (this.phase !== 'playing' || !this.target) return;
    const e = this.target;
    this.target = null;
    this.events.emit('release', { enemy: e });
  }

  private lockOn(t: Enemy): void {
    this.target = t;
    t.lockT = 0;
    this.showHint = false;
    this.events.emit('lock', { enemy: t });
  }

  /** A correct letter on `t`: fire a bolt, or strike if the word is complete. */
  private advance(t: Enemy): void {
    t.typed++;
    t.pop = 1;
    const final = t.typed >= t.word.length;
    this.aimAndRecoil(t);
    const m = this.muzzle();
    this.events.emit('shot', { enemy: t, index: t.typed - 1, final, x: m.x, y: m.y, angle: this.turret.angle });
    if (final) {
      this.target = null;
      this.events.emit('strike', { enemy: t, x0: m.x, y0: m.y, x1: t.px, y1: t.py });
      this.killEnemy(t, t.px, t.py, this.phase !== 'playing');
    } else {
      this.bolts.push({
        x: m.x,
        y: m.y,
        trail: [m.x, m.y],
        enemy: t,
        final: false,
        speed: CONFIG.boltSpeed * this.layout.k,
        age: 0,
        heat: t.typed / t.word.length,
        tx: t.px,
        ty: t.py,
      });
    }
  }

  private registerMiss(enemy: Enemy | null): void {
    this.stats.errors++;
    this.stats.waveErrors++;
    if (enemy) {
      enemy.errorShake = 1;
      enemy.clean = false;
    }
    this.turret.jam = 1;
    const combo = this.stats.combo;
    const multiplier = this.stats.multiplier;
    this.stats.combo = 0;
    this.events.emit('miss', { enemy });
    if (combo >= 3) this.events.emit('comboBreak', { combo, multiplier });
  }

  private hasTargetable(): boolean {
    for (const e of this.enemies) if (e.state === 'alive' && this.isTargetable(e)) return true;
    return this.target !== null;
  }

  private isTargetable(e: Enemy): boolean {
    return e.ly > 2 && e.spawnT > 0.25;
  }

  /** Pick the enemy whose next letter matches, preferring the one closest to the shield. */
  private acquire(ch: string, candidates: Enemy[]): Enemy | null {
    let best: Enemy | null = null;
    for (const e of candidates) {
      if (e.word[e.typed] !== ch) continue;
      if (!best || e.progress > best.progress) best = e;
    }
    return best;
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
    // Snap the barrel toward the target so shots visibly leave the muzzle in the right direction.
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

  private spawnEnemy(kind: EnemyKind, lanes?: Array<[number, number]>): boolean {
    const L = this.layout;
    const def = ENEMY_DEFS[kind];
    const [minLen, maxLen] = def.wordLen(Math.max(1, this.wave));

    // Avoid starting letters that are currently "next" on any living enemy.
    const avoid = new Set<string>();
    for (const e of this.enemies) if (e.state === 'alive') avoid.add(e.word[e.typed]);

    const word = this.words.pick(minLen, maxLen, avoid);
    const r = def.radius * L.k;
    const labelW = L.labelWidth(word.length);
    const nx = this.findSpawnX(labelW, r, lanes);
    if (nx === null) {
      this.words.unpickLast();
      return false;
    }
    const speedMul = this.phase === 'idle' ? 1.1 : this.params.speedMul;
    const speed = (speedMul / def.travelTime) * rand(0.94, 1.06);
    const e: Enemy = {
      id: this.nextId++,
      def,
      word,
      typed: 0,
      nx,
      progress: 0,
      speed,
      age: 0,
      phase: Math.random() * Math.PI * 2,
      state: 'alive',
      doomTime: 0,
      clean: true,
      px: 0,
      py: 0,
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
    this.events.emit('spawn', { enemy: e });
    return true;
  }

  /** Choose a lane whose label won't collide with ships still near the top. */
  private findSpawnX(labelW: number, r: number, lanes?: Array<[number, number]>): number | null {
    const L = this.layout;
    const half = Math.max(labelW / 2, r) + 10;
    const minX = (half + 8) / L.fieldW;
    const maxX = 1 - minX;
    if (minX >= maxX) return 0.5;
    const ok: number[] = [];
    let bestNx = 0.5;
    let bestGap = -Infinity;
    for (let i = 0; i < 18; i++) {
      let nx: number;
      if (lanes) {
        const [a, b] = lanes[i % lanes.length];
        nx = clamp(rand(a, b), minX, maxX);
      } else {
        nx = rand(minX, maxX);
      }
      const x = L.fx(nx);
      let minGap = Infinity;
      for (const e of this.enemies) {
        if (e.state === 'dead') continue;
        // Only ships still in the upper part of the screen can collide with a new spawn.
        if (e.py > L.h * 0.42) continue;
        const otherHalf = Math.max(e.labelW / 2, e.r) + 10;
        const gap = Math.abs(x - e.px) - (half + otherHalf);
        if (gap < minGap) minGap = gap;
      }
      if (minGap >= 18) ok.push(nx);
      if (minGap > bestGap) {
        bestGap = minGap;
        bestNx = nx;
      }
    }
    if (ok.length) return ok[Math.floor(Math.random() * ok.length)];
    return bestGap > -4 ? bestNx : null;
  }

  /** Recompute pixel positions from normalised state. */
  private place(e: Enemy): void {
    const L = this.layout;
    const gap = e.r * 0.9;
    const baseX = L.fx(e.nx);
    const weave = e.def.weaveAmp * L.k * Math.sin(e.age * e.def.weaveFreq + e.phase) * Math.min(1, e.age);
    const endY = L.endY(baseX, gap);
    e.px = baseX + weave;
    e.py = L.spawnY + (endY - L.spawnY) * e.progress;
    // The label tracks the lane (not the weave) so words stay steady and readable.
    e.lx = baseX + weave * 0.25;
    e.ly = e.py + gap + L.labelOffset * 0.35;
    e.labelW = L.labelWidth(e.word.length);
  }

  /** Push overlapping ships apart horizontally so labels never pile up. */
  private separate(dt: number): void {
    const L = this.layout;
    const list = this.enemies.filter((e) => e.state !== 'dead');
    const pad = 10;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const aTop = a.py - a.r - pad;
        const aBot = a.ly + L.labelH + pad;
        const bTop = b.py - b.r - pad;
        const bBot = b.ly + L.labelH + pad;
        if (aBot < bTop || bBot < aTop) continue;
        const aHalf = Math.max(a.labelW / 2, a.r) + pad;
        const bHalf = Math.max(b.labelW / 2, b.r) + pad;
        const dx = b.lx - a.lx;
        const overlap = aHalf + bHalf - Math.abs(dx);
        if (overlap <= 0) continue;
        const dir = dx === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dx);
        const push = Math.min(overlap / 2, 420 * L.k * dt) / L.fieldW;
        // The locked target barely moves so the player's eyes don't have to chase it.
        const wa = a === this.target ? 0.25 : 1;
        const wb = b === this.target ? 0.25 : 1;
        a.nx -= dir * push * wa * (2 / (wa + wb));
        b.nx += dir * push * wb * (2 / (wa + wb));
      }
    }
    for (const e of list) {
      const half = Math.max(e.labelW / 2, e.r) + 8;
      const lo = half / L.fieldW;
      e.nx = clamp(e.nx, Math.min(lo, 0.5), Math.max(1 - lo, 0.5));
    }
  }

  // ------------------------------------------------------------------ update

  update(rawDt: number): void {
    const dt = rawDt * this.timeScale;
    this.updateTurret(dt);

    if (this.phase === 'idle') {
      this.idleTime += dt;
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
      // WPM clock: only while there is something on screen to type at (excludes pauses, banners, empty lulls).
      if (this.wavePhase === 'combat' && this.stats.typingStarted && this.hasTargetable()) this.stats.activeTime += dt;
    }

    this.updateEnemies(dt);
    this.updateBolts(dt);
  }

  /** Attract mode: a few ships drift down the sides and the turret types them out on its own. */
  private updateDemo(dt: number): void {
    this.demoSpawn -= dt;
    if (this.demoSpawn <= 0) {
      this.demoSpawn = rand(1.8, 3.2);
      if (this.enemies.length < 3) {
        const kind: EnemyKind = weighted({ scout: 0.55, fighter: 0.45 });
        this.spawnEnemy(kind, [
          [0.01, 0.09],
          [0.91, 0.99],
        ]);
      }
    }
    this.demoType -= dt;
    if (this.demoType > 0) return;
    this.demoType = rand(0.09, 0.17);
    let t = this.target;
    if (!t || t.state !== 'alive') {
      t = null;
      for (const e of this.enemies) if (e.state === 'alive' && e.progress > 0.38 && (!t || e.progress > t.progress)) t = e;
      if (!t) return;
      this.lockOn(t);
    }
    this.advance(t);
  }

  private updateWave(dt: number): void {
    if (this.wavePhase === 'intro') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.wavePhase = 'combat';
      return;
    }
    if (this.wavePhase === 'clear') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.beginWave(this.wave + 1);
      return;
    }

    // combat: spawning
    const p = this.params;
    const alive = this.enemies.filter((e) => e.state === 'alive').length;
    if (this.spawned < p.count) {
      this.spawnTimer -= dt;
      // Avoid dead air: if the field is empty, hurry the next spawn along.
      if (alive === 0 && this.spawnTimer > 0.6) this.spawnTimer = 0.6;
      if (this.spawnTimer <= 0 && alive < p.maxAlive) {
        let kind: EnemyKind = weighted(p.weights);
        if (this.swarmQueue.length) kind = 'scout';
        if (this.spawnEnemy(kind)) {
          this.spawned++;
          if (this.swarmQueue.length) {
            this.swarmQueue.shift();
            this.spawnTimer = this.swarmQueue.length ? 0.45 : p.interval * rand(0.85, 1.15);
          } else if (kind === 'scout' && Math.random() < p.swarmChance && this.spawned < p.count - 1) {
            const extra = Math.random() < 0.4 ? 2 : 1;
            for (let i = 0; i < extra; i++) this.swarmQueue.push(1);
            this.spawnTimer = 0.45;
          } else {
            const heavyPause = kind === 'heavy' ? 1.25 : 1;
            this.spawnTimer = p.interval * rand(0.8, 1.2) * heavyPause;
          }
        } else {
          this.spawnTimer = 0.25; // no fair lane right now; try again shortly
        }
      }
    } else if (this.enemies.length === 0 && this.bolts.length === 0) {
      this.clearWave();
    }
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
      e.age += dt;
      e.spawnT = Math.min(1, e.spawnT + dt * 2.5);
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      e.errorShake = Math.max(0, e.errorShake - dt * 4);
      e.lockT = Math.min(1, e.lockT + dt * 5);
      e.pop = Math.max(0, e.pop - dt * 7);
      if (e.state === 'alive') e.progress += e.speed * dt;
      this.place(e);
    }

    this.separate(dt);

    for (const e of this.enemies) {
      if (e.state === 'alive' && e.progress >= 1) this.hitBase(e);
    }
    this.enemies = this.enemies.filter((e) => e.state !== 'dead');
  }

  private hitBase(e: Enemy): void {
    e.state = 'dead';
    if (this.target === e) {
      this.target = null;
      this.events.emit('release', { enemy: e });
    }
    if (this.phase !== 'playing') {
      this.events.emit('kill', { enemy: e, x: e.px, y: e.py, points: 0, multiplier: 1, silent: true, perfect: false });
      return;
    }
    const damage = e.def.damage;
    this.integrity = Math.max(0, this.integrity - damage);
    this.stats.waveDamage += damage;
    const combo = this.stats.combo;
    const multiplier = this.stats.multiplier;
    this.stats.combo = 0;
    if (combo >= 3) this.events.emit('comboBreak', { combo, multiplier });
    this.events.emit('baseHit', {
      enemy: e,
      x: e.px,
      y: this.layout.shieldY(e.px),
      damage,
      integrity: this.integrity,
    });
    if (this.integrity <= 0) this.beginDying();
  }

  private killEnemy(e: Enemy, x: number, y: number, silent = false): void {
    if (e.state === 'dead') return;
    e.state = 'dead';
    let points = 0;
    const mult = this.stats.multiplier;
    const perfect = !silent && e.clean && e.word.length >= 4;
    if (!silent && this.phase === 'playing') {
      points = Math.round((e.def.basePoints + e.word.length * 10) * mult * (perfect ? PERFECT_BONUS : 1));
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
      // Track the target while it lives; otherwise fly to where it died.
      if (e.state !== 'dead') {
        b.tx = e.px;
        b.ty = e.py;
      }
      const dx = b.tx - b.x;
      const dy = b.ty - b.y;
      const dist = Math.hypot(dx, dy);
      const step = b.speed * dt;
      if (dist <= step + e.r * 0.4) {
        if (e.state === 'alive') {
          e.hitFlash = 1;
          e.progress = Math.max(0, e.progress - e.def.knockback);
        }
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
    let desired: number;
    if (this.target && this.target.state === 'alive') {
      desired = this.aimAngle(this.target);
      t.angle = approach(t.angle, desired, 28, dt);
    } else {
      // Idle scan: slowly sweep, drifting toward the most dangerous ship.
      let threat: Enemy | null = null;
      for (const e of this.enemies) if (e.state === 'alive' && (!threat || e.progress > threat.progress)) threat = e;
      const sweep = Math.sin((this.phase === 'idle' ? this.idleTime : this.time) * 0.55) * 0.55;
      desired = threat ? this.aimAngle(threat) * 0.6 + sweep * 0.25 : sweep;
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
    this.events.emit('gameOver', { stats: this.stats, wave: this.wave });
  }

  private updateDying(rawDt: number): void {
    this.dyingTimer += rawDt;
    // Ease into slow motion, then hold.
    this.timeScale = clamp(1 - this.dyingTimer * 1.6, 0.3, 1);
    this.dyingPopTimer -= rawDt;
    if (this.dyingPopTimer <= 0) {
      this.dyingPopTimer = 0.16;
      const victim = this.enemies.find((e) => e.state !== 'dead');
      if (victim) this.killEnemy(victim, victim.px, victim.py, true);
    }
    if (this.dyingTimer >= CONFIG.dyingTime) {
      for (const e of this.enemies) if (e.state !== 'dead') this.killEnemy(e, e.px, e.py, true);
      this.enemies = [];
      this.phase = 'over';
      this.timeScale = 1;
    }
  }

  /** Remaining enemies in the current wave (for the HUD progress bar). */
  get waveRemaining(): number {
    return this.params.count - this.spawned + this.enemies.filter((e) => e.state === 'alive').length;
  }

  get waveTotal(): number {
    return this.params.count;
  }
}
