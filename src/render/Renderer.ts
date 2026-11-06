import type { Layout } from '../core/layout';
import { TAU, clamp, mixHex, rand, rgba } from '../core/math';
import { CONFIG } from '../game/config';
import type { Enemy } from '../game/entities';
import type { Game } from '../game/Game';
import { MULT_THRESHOLDS } from '../game/stats';
import { Background, jagged, strokePts } from './Background';
import { Particles } from './Particles';
import { clearSpriteCache, glowSprite, shipSprite } from './sprites';

export const FONT_MONO = '"JetBrains Mono", ui-monospace, Consolas, "Courier New", monospace';
export const FONT_DISPLAY = 'Orbitron, "Segoe UI", system-ui, sans-serif';

const CYAN = '#5ff6ff';
const ERROR = '#ff4d6d';
const TEXT = '#f5f7ff';
const GOLD = '#ffd36b';
/** Laser colour per multiplier tier: cyan → aqua → mint → gold → overdrive magenta. */
const LASER_COLORS = ['#62e8ff', '#62e8ff', '#7dffc8', GOLD, '#ff6ef2'];
export const laserColor = (mult: number): string => LASER_COLORS[clamp(mult, 1, 5) - 1];

interface Ripple {
  x: number;
  t: number;
  color: string;
}

interface Strike {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  max: number;
  color: string;
  pts: number[];
  branches: number[][];
  reseed: number;
}

/** Draws the whole world to a single canvas and turns game events into juice. */
export class Renderer {
  readonly g: CanvasRenderingContext2D;
  readonly bg: Background;
  readonly particles = new Particles();
  /** Returns the position within the current musical beat (0..1). Wired to the soundtrack. */
  beatPhase: () => number = () => (this.time * (112 / 60)) % 1;
  /** Called on big impacts so the app can apply a short hit-stop. */
  onHitStop: ((seconds: number) => void) | null = null;

  private bloom: HTMLCanvasElement;
  private bg1: CanvasRenderingContext2D;
  private bloom2: HTMLCanvasElement;
  private bg2: CanvasRenderingContext2D;
  private trauma = 0;
  private punch = 0;
  private glitch = 0;
  private flashA = 0;
  private flashColor = '#ffffff';
  private ripples: Ripple[] = [];
  private strikes: Strike[] = [];
  private shieldHit = 0;
  private comboPulse = 0;
  private overdriveT = 0;
  private time = 0;
  private reducedMotion = false;
  /** 'low' skips the bloom pass and thins particle trails (set automatically on slow machines). */
  quality: 'high' | 'low' = 'high';
  private trailAcc = new Map<number, number>();
  private hexTiles = new Map<string, CanvasPattern>();
  private vignette: HTMLCanvasElement | null = null;
  private dangerVignette: HTMLCanvasElement | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private layout: Layout,
    private game: Game,
  ) {
    this.g = canvas.getContext('2d', { alpha: false })!;
    this.bg = new Background(layout);
    this.bloom = document.createElement('canvas');
    this.bg1 = this.bloom.getContext('2d')!;
    this.bloom2 = document.createElement('canvas');
    this.bg2 = this.bloom2.getContext('2d')!;
    this.bindEvents();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.bg.reducedMotion = on;
    this.particles.density = on ? 0.45 : 1;
  }

  resize(): void {
    const L = this.layout;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    L.resize(w, h, dpr);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.bloom.width = Math.ceil(w / 4);
    this.bloom.height = Math.ceil(h / 4);
    this.bloom2.width = Math.ceil(w / 12);
    this.bloom2.height = Math.ceil(h / 12);
    this.measureFont();
    clearSpriteCache();
    this.vignette = null;
    this.dangerVignette = null;
    this.hexTiles.clear();
    this.bg.resize();
    this.particles.clear();
    this.strikes = [];
  }

  measureFont(): void {
    const L = this.layout;
    this.g.font = `700 ${L.labelFont}px ${FONT_MONO}`;
    L.charW = this.g.measureText('mmmmmmmmmm').width / 10;
    this.particles.glyphFont = `800 ${L.labelFont}px ${FONT_MONO}`;
  }

  // ------------------------------------------------------------------ effects

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  flash(color: string, a: number): void {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, this.reducedMotion ? a * 0.4 : a);
  }

  warp(): void {
    this.bg.warpBoost = this.reducedMotion ? 0 : 1;
  }

  /** x position (px) of letter i in an enemy's label. */
  private letterX(e: Enemy, i: number): number {
    const L = this.layout;
    return e.lx - (e.word.length * L.charW) / 2 + (i + 0.5) * L.charW;
  }

  private bindEvents(): void {
    const ev = this.game.events;
    const P = this.particles;

    ev.on('spawn', ({ enemy: e }) => {
      const L = this.layout;
      const heavy = e.def.kind === 'heavy';
      const x = e.px;
      const y = 4;
      P.spawn({ kind: 'glow', x, y, color: e.def.color, size: heavy ? 90 : 46, max: heavy ? 0.7 : 0.4 });
      P.spawn({ kind: 'ring', x, y, color: e.def.color, size: (heavy ? 120 : 60) * L.k, max: 0.5 });
      P.spray(x, y, Math.PI / 2, 1.2, e.def.color, heavy ? 16 : 7, 380, { size: 1.4 });
      if (heavy) this.shake(0.12);
    });

    ev.on('shot', ({ enemy: e, index, x, y, angle, final }) => {
      const col = laserColor(this.game.stats.multiplier);
      const dir = angle - Math.PI / 2;
      P.spawn({ kind: 'glow', x, y, color: col, size: final ? 30 : 18, max: 0.12 });
      P.spray(x, y, dir, 0.7, '#ffffff', final ? 6 : 3, 520, { size: 1.2 });
      // The letter itself throws off a few sparks as it lights up.
      const lx = this.letterX(e, index);
      const ly = e.ly + this.layout.labelH / 2;
      P.spray(lx, ly - 6, -Math.PI / 2, 1.6, CYAN, 3, 160, { size: 1, max: 0.3 });
      // Heavy armour plating cracks off one segment per letter.
      if (e.def.kind === 'heavy' && !final) {
        const n = e.word.length;
        const a = this.armorAngle(e) + ((index + 0.5) / n) * TAU;
        const rr = e.r * 1.55;
        const ax = e.px + Math.cos(a) * rr;
        const ay = e.py + Math.sin(a) * rr * 0.9;
        P.burst(ax, ay, e.def.color, 6, 200, { kind: 'spark', max: 0.35, size: 1.4 });
        P.spawn({ kind: 'debris', x: ax, y: ay, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, color: e.def.color, size: 3, vr: 10, max: 0.6, drag: 2 });
      }
      this.comboPulse = 1;
    });

    ev.on('strike', ({ x0, y0, x1, y1 }) => {
      const color = laserColor(this.game.stats.multiplier);
      const s: Strike = { x0, y0, x1, y1, life: 0.26, max: 0.26, color, pts: [], branches: [], reseed: 0 };
      this.reseed(s);
      this.strikes.push(s);
      P.spawn({ kind: 'glow', x: x0, y: y0, color: '#ffffff', size: 44, max: 0.18 });
      this.flash(color, 0.05);
    });

    ev.on('hit', ({ enemy, x, y }) => {
      const L = this.layout;
      const back = Math.atan2(L.turretY - y, L.turretX - x);
      const col = laserColor(this.game.stats.multiplier);
      P.spray(x, y, back, 1.6, '#ffffff', 5, 380, { size: 1.3 });
      P.spray(x, y, back, 2.2, enemy.def.color, 4, 260, { size: 1.6 });
      P.spawn({ kind: 'glow', x, y, color: col, size: enemy.r * 1.2, max: 0.16 });
    });

    ev.on('kill', (k) => this.explode(k.enemy, k.x, k.y, k.points, k.multiplier, k.perfect, k.silent));

    ev.on('miss', () => {
      const L = this.layout;
      const t = this.game.turret;
      const mx = L.turretX + Math.sin(t.angle) * 40 * L.k;
      const my = L.turretY - Math.cos(t.angle) * 40 * L.k;
      P.burst(mx, my, ERROR, 6, 160, { max: 0.25, size: 1.2 });
    });

    ev.on('baseHit', ({ enemy, x, y, damage }) => {
      const color = enemy.def.color;
      this.ripples.push({ x, t: 0, color: ERROR });
      this.shieldHit = 1;
      P.spawn({ kind: 'glow', x, y, color: '#ffffff', size: 70, max: 0.25 });
      P.spawn({ kind: 'ring', x, y, color: ERROR, size: 120 * this.layout.k, max: 0.6 });
      P.burst(x, y, color, 30, 420, { kind: 'spark', max: 0.6, gravity: 300 });
      P.burst(x, y, '#ffd0d8', 10, 200, { kind: 'debris', size: 4, vr: 8, drag: 1.5, gravity: 200, max: 1 });
      P.text({ text: `-${damage}`, sub: 'SHIELD', x, y: y - 30, color: ERROR, size: 26, max: 1.1 });
      this.shake(0.55 + damage * 0.08);
      this.flash('#ff2244', 0.22);
      if (!this.reducedMotion) this.glitch = 0.35;
    });

    ev.on('multiplierUp', ({ multiplier }) => {
      const L = this.layout;
      const col = laserColor(multiplier);
      if (multiplier >= 5) {
        this.flash('#ff6ef2', 0.18);
        P.spawn({ kind: 'ring', x: L.turretX, y: L.turretY, color: '#ff6ef2', size: 600 * L.k, max: 1 });
        P.spawn({ kind: 'ring', x: L.turretX, y: L.turretY, color: '#ffffff', size: 380 * L.k, max: 0.7 });
        P.text({ text: 'OVERDRIVE', sub: '×5 MULTIPLIER', x: L.turretX, y: L.shieldApexY - 70 * L.k, color: '#ff8af4', size: 40, max: 1.6 });
      } else {
        P.spawn({ kind: 'ring', x: L.turretX, y: L.turretY, color: col, size: 200 * L.k, max: 0.6 });
        P.text({ text: `×${multiplier}`, sub: 'MULTIPLIER', x: L.turretX, y: L.shieldApexY - 50 * L.k, color: col, size: 34, max: 1.2 });
      }
    });

    ev.on('comboBreak', ({ multiplier }) => {
      this.comboPulse = -1;
      if (multiplier >= 5) {
        const L = this.layout;
        P.text({ text: 'OVERDRIVE LOST', x: L.turretX, y: L.shieldApexY - 40 * L.k, color: '#c9a6d6', size: 20, max: 1 });
      }
    });

    ev.on('waveStart', () => this.warp());

    ev.on('waveClear', ({ repaired }) => {
      const L = this.layout;
      if (repaired) {
        this.ripples.push({ x: L.cx, t: 0, color: '#7dffb2' });
        P.text({ text: '+1', sub: 'SHIELD REPAIRED', x: L.turretX, y: L.shieldApexY - 30 * L.k, color: '#7dffb2', size: 30, max: 1.8 });
      }
      // A celebratory volley of light from the Spire.
      for (let i = 0; i < 3; i++) {
        P.spawn({ kind: 'ring', x: L.turretX, y: L.turretY, color: i === 1 ? GOLD : CYAN, size: (300 + i * 260) * L.k, max: 0.9 + i * 0.25 });
      }
      P.burst(L.turretX, L.turretY - 30, GOLD, 40, 500, { kind: 'ember', max: 1.4, drag: 1.2, gravity: 60 });
    });

    ev.on('gameOver', () => {
      const L = this.layout;
      const x = L.turretX;
      const y = L.turretY;
      this.flash('#ffffff', 0.6);
      this.shake(1);
      this.glitch = this.reducedMotion ? 0 : 0.6;
      P.spawn({ kind: 'glow', x, y, color: '#ffffff', size: 260, max: 0.9 });
      P.spawn({ kind: 'ring', x, y, color: CYAN, size: 520 * L.k, max: 1.4 });
      P.spawn({ kind: 'ring', x, y, color: ERROR, size: 340 * L.k, max: 1.1 });
      P.burst(x, y, '#ffb547', 120, 900, { kind: 'spark', max: 1.4, gravity: 260, size: 2 });
      P.burst(x, y, CYAN, 60, 600, { kind: 'ember', max: 1.8, drag: 1.2 });
      P.burst(x, y, '#2a2f4a', 20, 300, { kind: 'debris', size: 7, vr: 6, drag: 1, gravity: 300, max: 2 });
      P.burst(x, y, '#2b2440', 24, 120, { kind: 'smoke', size: 30, max: 2.4, drag: 0.6, gravity: -30 });
      for (let i = 0; i < 6; i++) this.ripples.push({ x: L.fx(Math.random()), t: -i * 0.08, color: ERROR });
    });
  }

  private reseed(s: Strike): void {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    const segs = Math.max(6, Math.round(len / 26));
    s.pts = jagged(s.x0, s.y0, s.x1, s.y1, segs, Math.min(38, len * 0.06));
    s.branches = [];
    for (let i = 0; i < 3; i++) {
      const k = 2 + 2 * Math.floor(Math.random() * (segs - 2));
      const bx = s.pts[k];
      const by = s.pts[k + 1];
      const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0) + rand(-1, 1);
      const bl = rand(30, 80);
      s.branches.push(jagged(bx, by, bx + Math.cos(a) * bl, by + Math.sin(a) * bl, 4, 10));
    }
  }

  private explode(enemy: Enemy, x: number, y: number, points: number, multiplier: number, perfect: boolean, silent: boolean): void {
    const P = this.particles;
    const L = this.layout;
    const kind = enemy.def.kind;
    const s = kind === 'heavy' ? 1.7 : kind === 'fighter' ? 1.15 : 0.8;
    const c = enemy.def.color;
    const lc = laserColor(multiplier);
    P.spawn({ kind: 'glow', x, y, color: '#ffffff', size: 70 * s, max: 0.2 });
    P.spawn({ kind: 'glow', x, y, color: c, size: 130 * s, max: 0.5 });
    P.spawn({ kind: 'ring', x, y, color: c, size: 100 * s * L.k, max: 0.55 });
    P.spawn({ kind: 'ring', x, y, color: lc, size: 55 * s * L.k, max: 0.32 });
    P.burst(x, y, '#fff6d8', 26 * s, 640 * s, { kind: 'spark', max: 0.55, size: 1.6 });
    P.burst(x, y, c, 22 * s, 420 * s, { kind: 'spark', max: 0.8, size: 2, gravity: 120 });
    P.burst(x, y, '#2a2346', 6 * s, 90, { kind: 'smoke', size: 16 * s, max: 1.2, drag: 1, gravity: -20 });
    P.burst(x, y, c, 12 * s, 160, { kind: 'ember', max: 1.3, drag: 1.4, size: 1.2 });

    // The hull breaks apart into its own pieces.
    const sprite = shipSprite(kind, enemy.def.radius * L.k, L.dpr);
    for (const sh of sprite.shards) {
      const a = Math.atan2(sh.oy, sh.ox) + rand(-0.3, 0.3);
      const sp = rand(90, 260) * (kind === 'heavy' ? 0.7 : 1);
      P.spawn({
        kind: 'shard',
        x: x + sh.ox,
        y: y + sh.oy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        color: c,
        img: sh.canvas,
        ox: sh.ox,
        oy: sh.oy,
        w: sprite.w,
        h: sprite.h,
        rot: 0,
        vr: rand(-5, 5),
        drag: 1.3,
        gravity: 140,
        max: rand(0.8, 1.2),
      });
    }

    // Letters of the destroyed word scatter like embers.
    if (!silent || this.game.phase === 'idle') {
      const ly = enemy.ly + L.labelH / 2;
      for (let i = 0; i < enemy.word.length; i++) {
        const lx = this.letterX(enemy, i);
        const out = (i - (enemy.word.length - 1) / 2) * 40;
        P.spawn({
          kind: 'glyph',
          ch: enemy.word[i],
          x: lx,
          y: ly,
          vx: out + rand(-50, 50),
          vy: rand(-220, -90),
          color: lc,
          rot: 0,
          vr: rand(-4, 4),
          drag: 2.2,
          gravity: 260,
          max: rand(0.55, 0.8),
        });
      }
    }

    if (points > 0) {
      const subs: string[] = [];
      if (multiplier > 1) subs.push(`×${multiplier}`);
      if (perfect) subs.push('PERFECT');
      P.text({
        text: `+${points}`,
        sub: subs.length ? subs.join(' · ') : undefined,
        subColor: perfect ? GOLD : '#ffffff',
        x,
        y: y - 10,
        color: multiplier >= 2 ? lc : TEXT,
        size: Math.round(20 + Math.min(16, points / 110)),
        max: 1,
      });
    }
    this.shake(kind === 'heavy' ? 0.45 : kind === 'fighter' ? 0.22 : 0.14);
    this.punch = Math.min(1, this.punch + (kind === 'heavy' ? 1 : 0.45));
    if (kind === 'heavy') {
      this.flash(c, 0.14);
      if (!silent) this.onHitStop?.(0.06);
    }
  }

  // ------------------------------------------------------------------ frame

  render(dt: number, paused: boolean): void {
    const L = this.layout;
    const g = this.g;
    const game = this.game;
    const simDt = paused ? 0 : dt * game.timeScale;
    this.time += paused ? dt * 0.2 : dt;

    const targetWarp = game.phase === 'playing' ? 1 + Math.min(game.wave, 12) * 0.08 : 1;
    this.bg.warp += (targetWarp - this.bg.warp) * Math.min(1, dt * 0.5);
    this.bg.update(paused ? dt * 0.15 : dt);
    if (!paused) {
      this.emitTrails(simDt);
      this.particles.update(simDt);
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.punch = Math.max(0, this.punch - dt * 4);
    this.glitch = Math.max(0, this.glitch - dt);
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
    this.shieldHit = Math.max(0, this.shieldHit - dt * 2);
    this.comboPulse *= Math.exp(-dt * 8);
    this.overdriveT = clamp(this.overdriveT + (game.overdrive ? dt * 2 : -dt * 1.5), 0, 1);
    for (const r of this.ripples) r.t += simDt;
    this.ripples = this.ripples.filter((r) => r.t < 1.2);
    for (const s of this.strikes) {
      s.life -= dt;
      s.reseed -= dt;
      if (s.reseed <= 0) {
        s.reseed = 0.04;
        this.reseed(s);
      }
    }
    this.strikes = this.strikes.filter((s) => s.life > 0);

    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    const danger = game.phase === 'playing' || game.phase === 'dying' ? clamp(1 - game.integrity / CONFIG.maxIntegrity, 0, 1) : 0;
    this.bg.draw(g, danger * danger);

    // Camera: trauma shake + a tiny zoom punch on kills.
    let sx = 0;
    let sy = 0;
    let zoom = 1;
    if (!this.reducedMotion) {
      const s = this.trauma * this.trauma * 12;
      sx = rand(-s, s);
      sy = rand(-s, s);
      zoom = 1 + this.punch * this.punch * 0.012;
    }
    const applyCam = (c: CanvasRenderingContext2D, scale: number) => {
      c.setTransform(scale, 0, 0, scale, 0, 0);
      c.translate(L.cx + sx, L.h * 0.55 + sy);
      c.scale(zoom, zoom);
      c.translate(-L.cx, -L.h * 0.55);
    };

    applyCam(g, L.dpr);
    this.drawShield(g);
    this.bg.drawPlanet(g);
    this.drawTurret(g);
    this.drawTether(g);
    this.drawBolts(g, false);
    for (const e of game.enemies) this.drawShip(g, e);
    this.drawStrikes(g, false);
    this.particles.drawSolid(g);
    this.particles.drawLight(g);

    // Bloom goes on before the words so the text itself always stays razor sharp.
    if (this.quality === 'high') this.drawBloom(applyCam);

    applyCam(g, L.dpr);
    this.drawLabels(g);
    this.particles.drawTexts(g, FONT_DISPLAY);
    this.drawCombo(g);
    this.drawHint(g);
    this.drawPost(g, danger);
  }

  /** Bloom: re-draw emissive elements into a quarter-res buffer, blur by downsampling, add back. */
  private drawBloom(applyCam: (c: CanvasRenderingContext2D, scale: number) => void): void {
    const L = this.layout;
    const g = this.g;
    const b = this.bg1;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, this.bloom.width, this.bloom.height);
    applyCam(b, 0.25);
    this.drawEmissive(b);
    const b2 = this.bg2;
    b2.setTransform(1, 0, 0, 1, 0, 0);
    b2.clearRect(0, 0, this.bloom2.width, this.bloom2.height);
    b2.drawImage(this.bloom, 0, 0, this.bloom2.width, this.bloom2.height);
    // Fold the wide halo back into the quarter-res buffer, then add it to the frame in a single pass.
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'lighter';
    b.drawImage(this.bloom2, 0, 0, this.bloom.width, this.bloom.height);
    b.globalCompositeOperation = 'source-over';
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.85;
    g.drawImage(this.bloom, 0, 0, L.w, L.h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawPost(g: CanvasRenderingContext2D, danger: number): void {
    const L = this.layout;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    this.drawVignette(g, danger);
    this.drawOverdriveFrame(g);
    if (this.bg.flash > 0.01) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = this.bg.flash * 0.08;
      g.fillStyle = this.bg.flashColor;
      g.fillRect(0, 0, L.w, L.h);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    if (this.flashA > 0.005) {
      g.globalAlpha = this.flashA;
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, L.w, L.h);
      g.globalAlpha = 1;
    }
    if (this.glitch > 0) this.drawGlitch(g);
  }

  /** Everything that emits light, drawn into the bloom buffer. */
  private drawEmissive(b: CanvasRenderingContext2D): void {
    const L = this.layout;
    const game = this.game;
    b.globalCompositeOperation = 'lighter';

    // Shield edge
    if (game.phase !== 'over') {
      const color = this.shieldColor();
      const power = game.phase === 'idle' ? 0.8 : game.turret.power;
      b.strokeStyle = rgba(color, 0.55 * power + this.shieldHit * 0.4);
      b.lineWidth = 3;
      const x0 = L.fieldX - 80;
      const x1 = L.fieldX + L.fieldW + 80;
      b.beginPath();
      b.moveTo(x0, L.shieldY(x0));
      for (let x = x0; x <= x1; x += 40) b.lineTo(x, L.shieldY(x));
      b.stroke();
    }

    // Turret core & muzzle
    const t = game.turret;
    const col = laserColor(game.stats.multiplier);
    const beat = this.beatPulse();
    const cs = (34 + beat * 12 + t.flash * 30) * L.k * (0.4 + 0.6 * t.power);
    b.globalAlpha = 0.9;
    b.drawImage(glowSprite(t.jam > 0.1 ? ERROR : col), L.turretX - cs, L.turretY - cs, cs * 2, cs * 2);
    b.globalAlpha = 1;

    // Ship engines
    for (const e of game.enemies) {
      b.globalAlpha = e.spawnT * 0.8;
      const s = e.r * 1.4;
      b.drawImage(glowSprite(e.def.color), e.px - s, e.py - e.r * 1.4 - s * 0.5, s * 2, s * 1.6);
      if (e.hitFlash > 0) {
        b.globalAlpha = e.hitFlash * 0.5;
        b.drawImage(glowSprite('#ffffff'), e.px - e.r * 1.5, e.py - e.r * 1.5, e.r * 3, e.r * 3);
      }
    }
    b.globalAlpha = 1;

    this.drawBolts(b, true);
    this.drawStrikes(b, true);
    this.particles.drawLight(b, true);
    this.particles.drawTextGlow(b);

    // Typed letters glow
    b.font = `800 ${L.labelFont}px ${FONT_MONO}`;
    b.textBaseline = 'middle';
    b.textAlign = 'left';
    for (const e of game.enemies) {
      if (e.typed === 0) continue;
      const locked = e === game.target;
      b.globalAlpha = locked ? 1 : 0.5;
      b.fillStyle = CYAN;
      const tx = e.lx - (e.word.length * L.charW) / 2;
      b.fillText(e.word.slice(0, e.typed), tx, e.ly + L.labelH / 2);
      if (locked) {
        b.globalAlpha = 0.5;
        b.strokeStyle = CYAN;
        b.lineWidth = 3;
        b.strokeRect(e.lx - e.labelW / 2, e.ly, e.labelW, L.labelH);
      }
    }
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
  }

  /** 0..1 envelope that spikes on every beat of the soundtrack. */
  private beatPulse(): number {
    if (this.reducedMotion) return 0.3;
    return Math.exp(-this.beatPhase() * 5);
  }

  // ------------------------------------------------------------------ shield

  private shieldColor(): string {
    const ratio = this.game.integrity / CONFIG.maxIntegrity;
    if (this.game.phase === 'idle') return CYAN;
    if (ratio > 0.6) return CYAN;
    if (ratio > 0.3) return mixHex('#ffb547', CYAN, (ratio - 0.3) / 0.3);
    return mixHex(ERROR, '#ffb547', ratio / 0.3);
  }

  private hexPattern(g: CanvasRenderingContext2D, color: string): CanvasPattern {
    let p = this.hexTiles.get(color);
    if (p) return p;
    const r = 11;
    const w = r * Math.sqrt(3);
    const h = r * 3;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    const x = c.getContext('2d')!;
    x.strokeStyle = color;
    x.lineWidth = 1.2;
    const hex = (cx: number, cy: number) => {
      x.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.closePath();
      x.stroke();
    };
    hex(w / 2, r);
    hex(0, r * 2.5);
    hex(w, r * 2.5);
    hex(0, -r * 0.5);
    hex(w, -r * 0.5);
    p = g.createPattern(c, 'repeat')!;
    this.hexTiles.set(color, p);
    return p;
  }

  private drawShield(g: CanvasRenderingContext2D): void {
    const L = this.layout;
    const game = this.game;
    const alive = game.phase !== 'over' && !(game.phase === 'dying' && game.timeScale < 0.5);
    const power = game.phase === 'idle' ? 0.55 + 0.45 * game.turret.power : game.turret.power;
    if (!alive && power < 0.05) return;

    const color = this.shieldColor();
    const ratio = game.integrity / CONFIG.maxIntegrity;
    const flicker = game.phase === 'playing' && ratio <= 0.3 && !this.reducedMotion ? 0.75 + 0.25 * Math.sin(this.time * 23) * Math.sin(this.time * 7) : 1;
    const beat = this.beatPulse();
    const x0 = L.fieldX - 80;
    const x1 = L.fieldX + L.fieldW + 80;
    const step = 14;

    const domePath = () => {
      g.beginPath();
      g.moveTo(x0, L.shieldY(x0));
      for (let x = x0; x <= x1; x += step) g.lineTo(x, L.shieldY(x));
      g.lineTo(x1, L.horizonY);
      g.lineTo(x0, L.horizonY);
      g.closePath();
    };

    // Translucent dome body.
    domePath();
    const body = g.createLinearGradient(0, L.shieldApexY, 0, L.horizonY);
    body.addColorStop(0, rgba(color, (0.12 + beat * 0.03) * power * flicker + this.shieldHit * 0.12));
    body.addColorStop(1, rgba(color, 0));
    g.fillStyle = body;
    g.fill();

    // Hex lattice lights up around impacts.
    if (this.ripples.length) {
      g.save();
      domePath();
      g.clip();
      g.globalCompositeOperation = 'lighter';
      for (const r of this.ripples) {
        if (r.t < 0) continue;
        const p = r.t / 1.2;
        const y = L.shieldY(r.x);
        const rad = (60 + p * 420) * L.k;
        g.globalAlpha = (1 - p) * 0.9;
        g.save();
        g.beginPath();
        g.arc(r.x, y, rad, 0, TAU);
        g.arc(r.x, y, Math.max(0, rad - 90 * L.k), 0, TAU, true);
        g.fillStyle = this.hexPattern(g, r.color);
        g.fill();
        g.restore();
      }
      g.restore();
      g.globalAlpha = 1;
    }

    // Edge: wide soft glow + bright core.
    g.globalCompositeOperation = 'lighter';
    g.beginPath();
    g.moveTo(x0, L.shieldY(x0));
    for (let x = x0; x <= x1; x += step) g.lineTo(x, L.shieldY(x));
    g.strokeStyle = rgba(color, (0.14 + beat * 0.06) * power * flicker);
    g.lineWidth = 10;
    g.stroke();
    g.strokeStyle = rgba(color, 0.75 * power * flicker);
    g.lineWidth = 1.6;
    g.stroke();

    if (!this.reducedMotion) {
      const span = x1 - x0;
      for (let k = 0; k < 2; k++) {
        const sx = x0 + ((this.time * 0.12 + k * 0.5) % 1) * span;
        const sy = L.shieldY(sx);
        g.globalAlpha = 0.5 * power * flicker;
        g.drawImage(glowSprite(color), sx - 60, sy - 14, 120, 28);
      }
      g.globalAlpha = 1;
    }

    g.strokeStyle = rgba(color, 0.22 * power);
    g.lineWidth = 1;
    g.beginPath();
    for (let x = x0 + 20; x < x1; x += 40) {
      const y = L.shieldY(x);
      g.moveTo(x, y + 4);
      g.lineTo(x, y + 9);
    }
    g.stroke();

    for (const r of this.ripples) {
      if (r.t < 0) continue;
      const p = r.t / 1.2;
      const a = (1 - p) * (1 - p);
      const spread = p * 260 * L.k;
      for (const dir of [-1, 1]) {
        const x = r.x + dir * spread;
        const y = L.shieldY(x);
        g.globalAlpha = a;
        g.drawImage(glowSprite(r.color), x - 40, y - 40, 80, 80);
      }
      const y = L.shieldY(r.x);
      g.globalAlpha = a * 0.9;
      g.drawImage(glowSprite(r.color), r.x - 90 * (1 - p * 0.5), y - 60, 180 * (1 - p * 0.5), 120);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ turret

  private drawTurret(g: CanvasRenderingContext2D): void {
    const L = this.layout;
    const game = this.game;
    const t = game.turret;
    const k = L.k;
    const x = L.turretX;
    const y = L.turretY;
    const dead = game.phase === 'over';
    const power = dead ? 0 : game.phase === 'idle' ? 0.6 + 0.4 * t.power : t.power;
    const beat = this.beatPulse();
    const mult = game.phase === 'playing' ? game.stats.multiplier : 1;
    const col = laserColor(mult);

    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = (0.3 + beat * 0.12) * power + t.heat * 0.2;
    g.drawImage(glowSprite(col), x - 170 * k, L.horizonY - 60 * k, 340 * k, 120 * k);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Pedestal
    g.beginPath();
    g.moveTo(x - 70 * k, L.h + 2);
    g.lineTo(x - 52 * k, y + 14 * k);
    g.lineTo(x - 26 * k, y + 4 * k);
    g.lineTo(x + 26 * k, y + 4 * k);
    g.lineTo(x + 52 * k, y + 14 * k);
    g.lineTo(x + 70 * k, L.h + 2);
    g.closePath();
    const ped = g.createLinearGradient(0, y, 0, L.h);
    ped.addColorStop(0, '#2b3152');
    ped.addColorStop(1, '#0a0c18');
    g.fillStyle = ped;
    g.fill();
    g.strokeStyle = rgba(col, 0.25 + 0.3 * power);
    g.lineWidth = 1.2;
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const ly = y + (24 + i * 13) * k;
      const on = power > 0.2 && (Math.floor(this.time * 3 - i) % 4 !== 0 || this.reducedMotion);
      g.fillStyle = on ? rgba(col, 0.8 * power) : 'rgba(95,246,255,0.12)';
      g.fillRect(x - 40 * k + i * 2 * k, ly, 6 * k, 2 * k);
      g.fillRect(x + 34 * k - i * 2 * k, ly, 6 * k, 2 * k);
    }

    // Orbiting ring segments (spin faster with heat).
    if (!this.reducedMotion && power > 0.05) {
      g.save();
      g.translate(x, y);
      g.rotate(this.time * (0.6 + t.heat * 3));
      g.strokeStyle = rgba(col, 0.35 * power);
      g.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(0, 0, 36 * k, (i / 3) * TAU, (i / 3) * TAU + 1.2);
        g.stroke();
      }
      g.restore();
    }

    // Capacitor ring shows progress toward the next multiplier.
    g.beginPath();
    g.arc(x, y, 27 * k, 0, TAU);
    g.fillStyle = '#121528';
    g.fill();
    g.strokeStyle = rgba(col, 0.25 + 0.2 * power);
    g.lineWidth = 2;
    g.stroke();
    if (game.phase === 'playing') {
      const s = game.stats;
      const next = s.nextThreshold;
      const prev = MULT_THRESHOLDS[s.multiplier - 1];
      const p = next === null ? 1 : (s.combo - prev) / (next - prev);
      if (p > 0) {
        g.beginPath();
        g.arc(x, y, 27 * k, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p, 0, 1));
        g.strokeStyle = col;
        g.lineWidth = 3;
        g.stroke();
      }
    }

    // Rotating head
    g.save();
    g.translate(x, y);
    g.rotate(t.angle);
    const recoil = t.recoil * 9 * k;
    const jitter = t.jam > 0 && !this.reducedMotion ? rand(-1.5, 1.5) * t.jam : 0;
    g.translate(jitter, 0);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.roundRect(s * 7 * k - 3 * k, -48 * k + recoil, 6 * k, 40 * k, 2 * k);
      g.fillStyle = '#1f2440';
      g.fill();
      g.strokeStyle = rgba(mixHex(col, '#ffd36b', t.heat), 0.5 + 0.5 * power);
      g.lineWidth = 1.2;
      g.stroke();
    }
    g.globalCompositeOperation = 'lighter';
    const chan = g.createLinearGradient(0, -46 * k + recoil, 0, -8 * k);
    const hot = mixHex(col, '#fff3c4', t.heat);
    chan.addColorStop(0, rgba(hot, 0.2 + 0.8 * t.flash));
    chan.addColorStop(1, rgba(hot, 0.15 * power));
    g.fillStyle = chan;
    g.fillRect(-2 * k, -46 * k + recoil, 4 * k, 38 * k);
    g.globalCompositeOperation = 'source-over';
    g.beginPath();
    g.moveTo(-16 * k, 6 * k);
    g.lineTo(-13 * k, -14 * k);
    g.lineTo(-6 * k, -20 * k);
    g.lineTo(6 * k, -20 * k);
    g.lineTo(13 * k, -14 * k);
    g.lineTo(16 * k, 6 * k);
    g.closePath();
    g.fillStyle = '#262c4b';
    g.fill();
    g.strokeStyle = rgba(col, 0.5 + 0.4 * power);
    g.lineWidth = 1.4;
    g.stroke();
    g.restore();

    // Core
    g.globalCompositeOperation = 'lighter';
    const coreColor = t.jam > 0.1 ? mixHex(col, ERROR, t.jam) : col;
    const cs = (22 + beat * 7 + t.flash * 16) * k * (0.4 + 0.6 * power);
    g.globalAlpha = 0.9 * power + 0.1;
    g.drawImage(glowSprite(coreColor), x - cs, y - cs, cs * 2, cs * 2);
    g.beginPath();
    g.arc(x, y, 5 * k, 0, TAU);
    g.fillStyle = power > 0.1 ? '#f2ffff' : '#445';
    g.fill();

    if (t.flash > 0.01) {
      const mx = x + Math.sin(t.angle) * 48 * k;
      const my = y - Math.cos(t.angle) * 48 * k;
      const fs = (18 + 26 * t.flash) * k;
      g.globalAlpha = t.flash;
      g.drawImage(glowSprite('#ffffff'), mx - fs / 2, my - fs / 2, fs, fs);
      g.drawImage(glowSprite(col), mx - fs, my - fs, fs * 2, fs * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawTether(g: CanvasRenderingContext2D): void {
    const e = this.game.target;
    if (!e || e.state !== 'alive') return;
    const m = this.game.muzzle();
    g.save();
    g.setLineDash([3, 9]);
    g.lineDashOffset = -this.time * 40;
    g.strokeStyle = rgba(laserColor(this.game.stats.multiplier), 0.2 * e.lockT);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(m.x, m.y);
    g.lineTo(e.px, e.py);
    g.stroke();
    g.restore();
  }

  private drawBolts(g: CanvasRenderingContext2D, bloom: boolean): void {
    const mult = this.game.phase === 'playing' ? this.game.stats.multiplier : 1;
    const base = laserColor(mult);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const b of this.game.bolts) {
      const tr = b.trail;
      const color = mixHex(base, '#ffffff', b.heat * 0.35);
      const n = tr.length;
      if (n >= 4) {
        g.globalAlpha = bloom ? 0.8 : 0.3;
        g.strokeStyle = color;
        g.lineWidth = bloom ? 12 : 7;
        g.beginPath();
        g.moveTo(tr[0], tr[1]);
        for (let i = 2; i < n; i += 2) g.lineTo(tr[i], tr[i + 1]);
        g.lineTo(b.x, b.y);
        g.stroke();
        if (!bloom) {
          g.globalAlpha = 0.95;
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(tr[Math.max(0, n - 6)], tr[Math.max(1, n - 5)]);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      }
      const s = bloom ? 30 : 18;
      g.globalAlpha = 1;
      g.drawImage(glowSprite(color), b.x - s, b.y - s, s * 2, s * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawStrikes(g: CanvasRenderingContext2D, bloom: boolean): void {
    if (!this.strikes.length) return;
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const s of this.strikes) {
      const p = s.life / s.max;
      const flick = this.reducedMotion ? p : p * (0.7 + 0.3 * Math.sin(s.life * 120));
      g.globalAlpha = flick * (bloom ? 1 : 0.35);
      g.strokeStyle = s.color;
      g.lineWidth = bloom ? 14 : 9;
      strokePts(g, s.pts);
      if (!bloom) {
        g.globalAlpha = flick;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2.6;
        strokePts(g, s.pts);
        g.strokeStyle = s.color;
        g.lineWidth = 1.2;
        for (const br of s.branches) strokePts(g, br);
      }
      const r = (bloom ? 60 : 40) * p;
      g.globalAlpha = flick;
      g.drawImage(glowSprite('#ffffff'), s.x1 - r, s.y1 - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ enemies

  private engineOffsets(e: Enemy): number[] {
    return e.def.kind === 'heavy' ? [-1, 0, 1] : e.def.kind === 'fighter' ? [-0.35, 0.35] : [0];
  }

  /** Continuous exhaust particles so ships leave glowing contrails. */
  private emitTrails(dt: number): void {
    if (dt <= 0) return;
    const rate = this.reducedMotion ? 10 : this.quality === 'low' ? 16 : 34;
    const alive = new Set<number>();
    for (const e of this.game.enemies) {
      if (e.state !== 'alive') continue;
      alive.add(e.id);
      let acc = (this.trailAcc.get(e.id) ?? 0) + dt * rate;
      const offs = this.engineOffsets(e);
      while (acc >= 1) {
        acc -= 1;
        const off = offs[Math.floor(Math.random() * offs.length)];
        this.particles.spawn({
          kind: 'glow',
          x: e.px + off * e.r + rand(-1.5, 1.5),
          y: e.py - e.r * 0.95,
          vx: rand(-8, 8),
          vy: -rand(30, 70),
          color: e.def.color,
          size: e.r * (e.def.kind === 'heavy' ? 0.32 : 0.42),
          max: rand(0.3, 0.5),
          drag: 2,
        });
      }
      this.trailAcc.set(e.id, acc);
    }
    for (const id of this.trailAcc.keys()) if (!alive.has(id)) this.trailAcc.delete(id);
  }

  private armorAngle(e: Enemy): number {
    return this.reducedMotion ? -Math.PI / 2 : e.age * 0.7 - Math.PI / 2;
  }

  private drawShip(g: CanvasRenderingContext2D, e: Enemy): void {
    const L = this.layout;
    const def = e.def;
    const sprite = shipSprite(def.kind, def.radius * L.k, L.dpr);
    const appear = e.spawnT;
    const tilt = def.weaveAmp ? Math.cos(e.age * def.weaveFreq + e.phase) * 0.18 : 0;
    const knock = e.hitFlash * 3;

    g.globalCompositeOperation = 'lighter';
    const flick = this.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(this.time * 40 + e.id);
    for (const off of this.engineOffsets(e)) {
      const ex = e.px + off * e.r;
      const ey = e.py - e.r * 0.85 - knock;
      const len = e.r * (def.kind === 'heavy' ? 1.1 : 1.4) * flick;
      g.globalAlpha = 0.85 * appear;
      g.drawImage(glowSprite(def.color), ex - e.r * 0.45, ey - len, e.r * 0.9, len * 1.3);
      g.globalAlpha = 0.9 * appear;
      g.drawImage(glowSprite('#ffffff'), ex - e.r * 0.18, ey - e.r * 0.3, e.r * 0.36, e.r * 0.5);
    }
    if (def.kind === 'heavy') {
      const p = 0.6 + 0.4 * Math.sin(this.time * 3 + e.id);
      g.globalAlpha = p * appear;
      const cs = e.r * 1.2;
      g.drawImage(glowSprite(def.accent), e.px - cs / 2, e.py - cs / 2 - knock, cs, cs);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    g.save();
    g.translate(e.px, e.py - knock);
    g.rotate(tilt);
    const sc = 0.6 + 0.4 * appear;
    g.scale(sc, sc);
    g.globalAlpha = appear;
    g.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
    if (e.hitFlash > 0) {
      g.globalAlpha = e.hitFlash * 0.85;
      g.drawImage(sprite.flash, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
    }
    g.restore();
    g.globalAlpha = 1;

    // Heavy armour ring: one plate per letter, plates break off as you type.
    if (def.kind === 'heavy') {
      const n = e.word.length;
      const rr = e.r * 1.55;
      const a0 = this.armorAngle(e);
      const seg = TAU / n;
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const broken = i < e.typed;
        g.strokeStyle = broken ? 'rgba(255,255,255,0.08)' : rgba(def.color, 0.75 * appear);
        g.beginPath();
        g.ellipse(e.px, e.py - knock, rr, rr * 0.9, 0, a0 + i * seg + seg * 0.14, a0 + (i + 1) * seg - seg * 0.14);
        g.stroke();
      }
      g.lineCap = 'butt';
    }

    if (e === this.game.target) this.drawReticle(g, e);
  }

  private drawReticle(g: CanvasRenderingContext2D, e: Enemy): void {
    const t = e.lockT;
    const ease = 1 - Math.pow(1 - t, 3);
    const size = e.r * (2.6 - 1.05 * ease) + 6 + (e.def.kind === 'heavy' ? 10 : 0);
    const rot = this.reducedMotion ? 0 : this.time * 1.4;
    g.save();
    g.translate(e.px, e.py);
    g.rotate(rot);
    g.strokeStyle = rgba(laserColor(this.game.stats.multiplier), 0.35 + 0.65 * ease);
    g.lineWidth = 2;
    const c = size * 0.35;
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(size, size - c);
      g.lineTo(size, size);
      g.lineTo(size - c, size);
      g.stroke();
    }
    g.restore();
  }

  private drawLabels(g: CanvasRenderingContext2D): void {
    const L = this.layout;
    const target = this.game.target;
    g.font = `700 ${L.labelFont}px ${FONT_MONO}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const demo = this.game.phase === 'idle';
    g.globalAlpha = 1;
    for (const e of this.game.enemies) if (e !== target) this.drawLabel(g, e, false, demo);
    if (target && target.state !== 'dead') this.drawLabel(g, target, true, demo);
  }

  private drawLabel(g: CanvasRenderingContext2D, e: Enemy, locked: boolean, demo: boolean): void {
    const L = this.layout;
    if (e.state === 'dead') return;
    const w = e.labelW;
    const h = L.labelH;
    const shakeX = e.errorShake > 0 && !this.reducedMotion ? Math.sin(e.errorShake * 38) * 5 * e.errorShake : 0;
    const scale = locked ? 1 + 0.06 * (1 - Math.pow(1 - e.lockT, 2)) : 1;
    const x = e.lx + shakeX;
    const y = e.ly;
    const danger = clamp((e.progress - 0.72) / 0.28, 0, 1);
    const baseAlpha = Math.min(1, e.spawnT * 1.5) * (demo ? 0.6 : 1);

    g.save();
    g.translate(x, y + h / 2);
    g.scale(scale, scale);
    g.globalAlpha = baseAlpha;

    g.strokeStyle = rgba(e.def.color, 0.45);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(e.px - x, -h / 2 - (e.ly - e.py) + e.r * 0.9);
    g.lineTo(0, -h / 2);
    g.stroke();

    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, h * 0.28);
    g.fillStyle = locked ? 'rgba(6,14,30,0.94)' : 'rgba(7,8,22,0.84)';
    g.fill();
    let border = rgba(e.def.color, 0.6);
    if (danger > 0 && !locked) border = rgba(mixHex(e.def.color, ERROR, danger), 0.6 + 0.4 * danger * (0.5 + 0.5 * Math.sin(this.time * 10)));
    if (locked) border = CYAN;
    if (e.errorShake > 0.05) border = mixHex(locked ? CYAN : e.def.color, ERROR, e.errorShake);
    g.strokeStyle = border;
    g.lineWidth = locked ? 2 : 1.25;
    g.stroke();

    // Typed part: cyan; the newest letter pops. Remaining: bright white.
    const cw = L.charW;
    const tx = -(e.word.length * cw) / 2;
    const ty = 1;
    const n = e.typed;
    if (n > 0) {
      g.fillStyle = CYAN;
      if (n > 1) g.fillText(e.word.slice(0, n - 1), tx, ty);
      const pop = e.pop;
      const cx = tx + (n - 1) * cw + cw / 2;
      g.save();
      g.translate(cx, ty);
      g.scale(1 + pop * 0.45, 1 + pop * 0.45);
      g.fillStyle = pop > 0.05 ? mixHex(CYAN, '#ffffff', pop) : CYAN;
      g.fillText(e.word[n - 1], -cw / 2, 0);
      g.restore();
    }
    const rest = e.word.slice(n);
    if (rest) {
      g.fillStyle = n > 0 && !locked ? '#d8dcf0' : TEXT;
      g.fillText(rest, tx + n * cw, ty);
      if (locked) {
        const cx = tx + n * cw;
        const blink = this.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(this.time * 12);
        g.fillStyle = rgba(CYAN, blink);
        g.fillRect(cx + 1, h / 2 - 5, cw - 2, 2);
      }
    }
    g.restore();
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ overlays in world space

  private drawCombo(g: CanvasRenderingContext2D): void {
    const game = this.game;
    if (game.phase !== 'playing') return;
    const L = this.layout;
    const s = game.stats;
    const col = laserColor(s.multiplier);
    const x = L.turretX - 150 * L.k;
    const y = L.turretY + 6 * L.k;
    const alpha = s.combo >= 2 ? 1 : 0.35;
    const pop = Math.max(0, this.comboPulse) * 0.18;
    g.save();
    g.translate(x, y);
    g.globalAlpha = alpha;
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.font = `600 ${Math.round(11 * L.k + 2)}px ${FONT_DISPLAY}`;
    g.fillStyle = 'rgba(200,210,255,0.7)';
    g.fillText('COMBO', 0, -26 * L.k);
    g.save();
    g.scale(1 + pop, 1 + pop);
    g.font = `800 ${Math.round(30 * L.k)}px ${FONT_DISPLAY}`;
    g.fillStyle = this.comboPulse < -0.05 ? mixHex(TEXT, ERROR, -this.comboPulse) : s.multiplier >= 2 ? col : TEXT;
    g.fillText(String(s.combo), 0, 4 * L.k);
    g.restore();

    const next = s.nextThreshold;
    const prev = MULT_THRESHOLDS[s.multiplier - 1];
    const barW = 86 * L.k;
    const p = next === null ? 1 : (s.combo - prev) / (next - prev);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(-barW, 12 * L.k, barW, 3);
    g.fillStyle = col;
    g.fillRect(-barW, 12 * L.k, barW * clamp(p, 0, 1), 3);
    g.font = `700 ${Math.round(11 * L.k + 2)}px ${FONT_DISPLAY}`;
    g.fillStyle = s.multiplier > 1 ? col : 'rgba(200,210,255,0.7)';
    g.fillText(next === null ? `×${s.multiplier} OVERDRIVE` : `×${s.multiplier} → ×${s.multiplier + 1}`, 0, 32 * L.k);
    g.restore();
  }

  private drawHint(g: CanvasRenderingContext2D): void {
    const game = this.game;
    if (game.phase !== 'playing' || !game.showHint || game.wave !== 1 || game.wavePhase !== 'combat') return;
    if (!game.enemies.some((e) => e.ly > 0)) return;
    const L = this.layout;
    const a = this.reducedMotion ? 0.9 : 0.6 + 0.4 * Math.sin(this.time * 3);
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${Math.round(14 * L.k + 2)}px ${FONT_DISPLAY}`;
    g.fillStyle = CYAN;
    g.fillText('TYPE A SHIP’S WORD TO FIRE', L.cx, L.shieldApexY + 34 * L.k);
    g.restore();
  }

  private bakeVignette(inner: string, outer: string): HTMLCanvasElement {
    const L = this.layout;
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.ceil(L.w / 4));
    c.height = Math.max(2, Math.ceil(L.h / 4));
    const g = c.getContext('2d')!;
    const r = Math.max(c.width, c.height) * 0.75;
    const v = g.createRadialGradient(c.width / 2, c.height * 0.45, r * 0.45, c.width / 2, c.height * 0.45, r);
    v.addColorStop(0, inner);
    v.addColorStop(1, outer);
    g.fillStyle = v;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  private drawVignette(g: CanvasRenderingContext2D, danger: number): void {
    const L = this.layout;
    this.vignette ??= this.bakeVignette('rgba(0,0,0,0)', 'rgba(0,0,6,0.6)');
    g.drawImage(this.vignette, 0, 0, L.w, L.h);
    const low = this.game.phase === 'playing' && this.game.integrity <= 3;
    if (low) {
      this.dangerVignette ??= this.bakeVignette('rgba(255,30,60,0)', 'rgba(255,30,60,1)');
      const p = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 4);
      g.globalAlpha = 0.12 + 0.14 * p * danger;
      g.drawImage(this.dangerVignette, 0, 0, L.w, L.h);
      g.globalAlpha = 1;
    }
  }

  /** Magenta energy frame pulsing on the beat while in Overdrive. */
  private drawOverdriveFrame(g: CanvasRenderingContext2D): void {
    if (this.overdriveT <= 0.01) return;
    const L = this.layout;
    const a = this.overdriveT * (0.35 + 0.35 * this.beatPulse());
    const w = 90 * L.k;
    g.globalCompositeOperation = 'lighter';
    for (const side of [0, 1]) {
      const x0 = side ? L.w : 0;
      const grad = g.createLinearGradient(x0, 0, side ? L.w - w : w, 0);
      grad.addColorStop(0, `rgba(255,110,242,${a})`);
      grad.addColorStop(1, 'rgba(255,110,242,0)');
      g.fillStyle = grad;
      g.fillRect(side ? L.w - w : 0, 0, w, L.h);
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** Brief horizontal tearing + chromatic split when the shield is struck. */
  private drawGlitch(g: CanvasRenderingContext2D): void {
    const c = this.canvas;
    const k = Math.min(1, this.glitch / 0.35);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const slices = 3 + Math.floor(k * 5);
    for (let i = 0; i < slices; i++) {
      const h = rand(3, 34) * this.layout.dpr;
      const y = rand(0, c.height - h);
      const dx = rand(-28, 28) * this.layout.dpr * k;
      g.drawImage(c, 0, y, c.width, h, dx, y, c.width, h);
    }
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.18 * k;
    g.drawImage(c, 6 * k * this.layout.dpr, 0);
    g.restore();
  }
}
