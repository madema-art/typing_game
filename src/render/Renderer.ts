import type { Layout } from '../core/layout';
import { TAU, clamp, mixHex, rand, rgba } from '../core/math';
import { CONFIG } from '../game/config';
import type { Enemy } from '../game/entities';
import type { Game } from '../game/Game';
import { MULT_THRESHOLDS } from '../game/stats';
import { Background } from './Background';
import { Particles } from './Particles';
import { clearSpriteCache, glowSprite, shipSprite } from './sprites';

export const FONT_MONO = '"JetBrains Mono", ui-monospace, Consolas, "Courier New", monospace';
export const FONT_DISPLAY = 'Orbitron, "Segoe UI", system-ui, sans-serif';

const CYAN = '#5ff6ff';
const LASER = '#62e8ff';
const ERROR = '#ff4d6d';
const TEXT = '#f5f7ff';

interface Ripple {
  x: number;
  t: number;
  color: string;
}

/** Draws the whole world to a single canvas and turns game events into juice. */
export class Renderer {
  readonly g: CanvasRenderingContext2D;
  readonly bg: Background;
  readonly particles = new Particles();
  private trauma = 0;
  private flashA = 0;
  private flashColor = '#ffffff';
  private ripples: Ripple[] = [];
  private shieldHit = 0;
  private comboPulse = 0;
  private multPulse = 0;
  private time = 0;
  private reducedMotion = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private layout: Layout,
    private game: Game,
  ) {
    this.g = canvas.getContext('2d', { alpha: false })!;
    this.bg = new Background(layout);
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
    this.measureFont();
    clearSpriteCache();
    this.vignette = null;
    this.dangerVignette = null;
    this.bg.resize();
    this.particles.clear();
  }

  measureFont(): void {
    const L = this.layout;
    this.g.font = `700 ${L.labelFont}px ${FONT_MONO}`;
    L.charW = this.g.measureText('mmmmmmmmmm').width / 10;
  }

  // ------------------------------------------------------------------ effects

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  flash(color: string, a: number): void {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, this.reducedMotion ? a * 0.4 : a);
  }

  private bindEvents(): void {
    const ev = this.game.events;
    const P = this.particles;

    ev.on('shot', ({ x, y, angle, final }) => {
      const dir = angle - Math.PI / 2;
      P.spawn({ kind: 'glow', x, y, color: LASER, size: final ? 26 : 18, max: 0.12 });
      P.spray(x, y, dir, 0.7, '#bff9ff', final ? 6 : 3, 520, { size: 1.2 });
      this.comboPulse = 1;
    });

    ev.on('hit', ({ enemy, x, y }) => {
      const L = this.layout;
      const back = Math.atan2(L.turretY - y, L.turretX - x);
      P.spray(x, y, back, 1.6, '#ffffff', 5, 380, { size: 1.3 });
      P.spray(x, y, back, 2.2, enemy.def.color, 4, 260, { size: 1.6 });
      P.spawn({ kind: 'glow', x, y, color: enemy.def.color, size: enemy.r * 1.1, max: 0.16 });
    });

    ev.on('kill', ({ enemy, x, y, points, multiplier }) => this.explode(enemy, x, y, points, multiplier));

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
    });

    ev.on('multiplierUp', ({ multiplier }) => {
      this.multPulse = 1;
      const L = this.layout;
      P.text({ text: `×${multiplier}`, sub: 'MULTIPLIER', x: L.turretX, y: L.shieldApexY - 50 * L.k, color: '#ffd36b', size: 34, max: 1.2 });
    });

    ev.on('comboBreak', () => {
      this.comboPulse = -1;
    });

    ev.on('waveClear', ({ repaired }) => {
      if (repaired) {
        const L = this.layout;
        this.ripples.push({ x: L.cx, t: 0, color: '#7dffb2' });
        P.text({ text: '+1', sub: 'SHIELD REPAIRED', x: L.turretX, y: L.shieldApexY - 30 * L.k, color: '#7dffb2', size: 30, max: 1.8 });
      }
    });

    ev.on('gameOver', () => {
      const L = this.layout;
      const x = L.turretX;
      const y = L.turretY;
      this.flash('#ffffff', 0.6);
      this.shake(1);
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

  private explode(enemy: Enemy, x: number, y: number, points: number, multiplier: number): void {
    const P = this.particles;
    const kind = enemy.def.kind;
    const s = kind === 'heavy' ? 1.7 : kind === 'fighter' ? 1.15 : 0.8;
    const c = enemy.def.color;
    P.spawn({ kind: 'glow', x, y, color: '#ffffff', size: 60 * s, max: 0.18 });
    P.spawn({ kind: 'glow', x, y, color: c, size: 110 * s, max: 0.45 });
    P.spawn({ kind: 'ring', x, y, color: c, size: 90 * s * this.layout.k, max: 0.5 });
    P.spawn({ kind: 'ring', x, y, color: '#ffffff', size: 50 * s * this.layout.k, max: 0.3 });
    P.burst(x, y, '#fff6d8', 26 * s, 620 * s, { kind: 'spark', max: 0.55, size: 1.6 });
    P.burst(x, y, c, 22 * s, 420 * s, { kind: 'spark', max: 0.8, size: 2, gravity: 120 });
    P.burst(x, y, c, 8 * s, 240 * s, { kind: 'debris', size: 3 + 2 * s, vr: 10, drag: 1.6, max: 0.9, gravity: 160 });
    P.burst(x, y, '#2a2346', 6 * s, 90, { kind: 'smoke', size: 14 * s, max: 1.1, drag: 1, gravity: -20 });
    P.burst(x, y, c, 10 * s, 140, { kind: 'ember', max: 1.2, drag: 1.4, size: 1.2 });
    if (points > 0) {
      P.text({
        text: `+${points}`,
        sub: multiplier > 1 ? `×${multiplier}` : undefined,
        x,
        y: y - 10,
        color: multiplier >= 4 ? '#ffd36b' : multiplier >= 2 ? '#9ffcff' : TEXT,
        size: Math.round(20 + Math.min(14, points / 120)),
        max: 0.95,
      });
    }
    this.shake(kind === 'heavy' ? 0.45 : kind === 'fighter' ? 0.25 : 0.16);
    if (kind === 'heavy') this.flash(c, 0.12);
  }

  // ------------------------------------------------------------------ frame

  render(dt: number, paused: boolean): void {
    const L = this.layout;
    const g = this.g;
    const game = this.game;
    const simDt = paused ? 0 : dt * game.timeScale;
    this.time += paused ? dt * 0.2 : dt;

    // Starfield speeds up a little as waves progress.
    const targetWarp = game.phase === 'playing' ? 1 + Math.min(game.wave, 12) * 0.08 : 1;
    this.bg.warp += (targetWarp - this.bg.warp) * Math.min(1, dt * 0.5);
    this.bg.update(paused ? dt * 0.15 : dt);
    if (!paused) this.particles.update(simDt);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
    this.shieldHit = Math.max(0, this.shieldHit - dt * 2);
    this.comboPulse *= Math.exp(-dt * 8);
    this.multPulse = Math.max(0, this.multPulse - dt * 1.5);
    for (const r of this.ripples) r.t += simDt;
    this.ripples = this.ripples.filter((r) => r.t < 1.2);

    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    const danger = game.phase === 'playing' || game.phase === 'dying' ? clamp(1 - game.integrity / CONFIG.maxIntegrity, 0, 1) : 0;
    this.bg.draw(g, danger * danger);

    g.save();
    if (!this.reducedMotion && this.trauma > 0) {
      const s = this.trauma * this.trauma * 12;
      g.translate(rand(-s, s), rand(-s, s));
    }

    this.drawShield(g);
    this.bg.drawPlanet(g);
    this.drawTurret(g);
    this.drawTether(g);
    this.drawBolts(g);
    for (const e of game.enemies) this.drawShip(g, e);
    this.particles.draw(g);
    this.drawLabels(g);
    this.particles.drawTexts(g, FONT_DISPLAY);
    this.drawCombo(g);
    this.drawHint(g);
    g.restore();

    this.drawVignette(g, danger);
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
  }

  // ------------------------------------------------------------------ shield

  private shieldColor(): string {
    const ratio = this.game.integrity / CONFIG.maxIntegrity;
    if (this.game.phase === 'idle') return CYAN;
    if (ratio > 0.6) return CYAN;
    if (ratio > 0.3) return mixHex('#ffb547', CYAN, (ratio - 0.3) / 0.3);
    return mixHex(ERROR, '#ffb547', ratio / 0.3);
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
    const x0 = L.fieldX - 80;
    const x1 = L.fieldX + L.fieldW + 80;
    const step = 14;

    // Translucent dome body.
    g.beginPath();
    g.moveTo(x0, L.shieldY(x0));
    for (let x = x0; x <= x1; x += step) g.lineTo(x, L.shieldY(x));
    g.lineTo(x1, L.horizonY);
    g.lineTo(x0, L.horizonY);
    g.closePath();
    const body = g.createLinearGradient(0, L.shieldApexY, 0, L.horizonY);
    body.addColorStop(0, rgba(color, 0.13 * power * flicker + this.shieldHit * 0.12));
    body.addColorStop(1, rgba(color, 0));
    g.fillStyle = body;
    g.fill();

    // Edge: wide soft glow + bright core.
    g.globalCompositeOperation = 'lighter';
    const pathEdge = () => {
      g.beginPath();
      g.moveTo(x0, L.shieldY(x0));
      for (let x = x0; x <= x1; x += step) g.lineTo(x, L.shieldY(x));
    };
    pathEdge();
    g.strokeStyle = rgba(color, 0.16 * power * flicker);
    g.lineWidth = 10;
    g.stroke();
    g.strokeStyle = rgba(color, 0.75 * power * flicker);
    g.lineWidth = 1.6;
    g.stroke();

    // Travelling shimmer highlight.
    if (!this.reducedMotion) {
      const span = x1 - x0;
      for (let k = 0; k < 2; k++) {
        const sx = x0 + (((this.time * 0.12 + k * 0.5) % 1) * span);
        const sy = L.shieldY(sx);
        g.globalAlpha = 0.5 * power * flicker;
        g.drawImage(glowSprite(color), sx - 60, sy - 14, 120, 28);
      }
      g.globalAlpha = 1;
    }

    // Hex tick marks along the arc.
    g.strokeStyle = rgba(color, 0.22 * power);
    g.lineWidth = 1;
    g.beginPath();
    for (let x = x0 + 20; x < x1; x += 40) {
      const y = L.shieldY(x);
      g.moveTo(x, y + 4);
      g.lineTo(x, y + 9);
    }
    g.stroke();

    // Impact ripples spreading along the edge.
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
    const t = this.game.turret;
    const k = L.k;
    const x = L.turretX;
    const y = L.turretY;
    const dead = this.game.phase === 'over';
    const power = dead ? 0 : this.game.phase === 'idle' ? 0.6 + 0.4 * t.power : t.power;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4);

    // Ground glow under the spire.
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.35 * power + t.heat * 0.2;
    g.drawImage(glowSprite(CYAN), x - 160 * k, L.horizonY - 60 * k, 320 * k, 120 * k);
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
    g.strokeStyle = rgba(CYAN, 0.25 + 0.3 * power);
    g.lineWidth = 1.2;
    g.stroke();
    // Pedestal lights
    for (let i = 0; i < 4; i++) {
      const ly = y + (24 + i * 13) * k;
      const on = power > 0.2 && (Math.floor(this.time * 3 - i) % 4 !== 0 || this.reducedMotion);
      g.fillStyle = on ? rgba(CYAN, 0.8 * power) : 'rgba(95,246,255,0.12)';
      g.fillRect(x - 40 * k + i * 2 * k, ly, 6 * k, 2 * k);
      g.fillRect(x + 34 * k - i * 2 * k, ly, 6 * k, 2 * k);
    }

    // Capacitor ring (shows heat as an arc)
    g.beginPath();
    g.arc(x, y, 27 * k, 0, TAU);
    g.fillStyle = '#121528';
    g.fill();
    g.strokeStyle = rgba(CYAN, 0.35 + 0.3 * power);
    g.lineWidth = 2;
    g.stroke();
    if (t.heat > 0.02) {
      g.beginPath();
      g.arc(x, y, 27 * k, -Math.PI / 2 - t.heat * Math.PI, -Math.PI / 2 + t.heat * Math.PI);
      g.strokeStyle = mixHex(CYAN, '#ffb547', t.heat);
      g.lineWidth = 3;
      g.stroke();
    }

    // Rotating head
    g.save();
    g.translate(x, y);
    g.rotate(t.angle);
    const recoil = t.recoil * 9 * k;
    const jitter = t.jam > 0 && !this.reducedMotion ? rand(-1.5, 1.5) * t.jam : 0;
    g.translate(jitter, 0);
    // barrel rails
    for (const s of [-1, 1]) {
      g.beginPath();
      g.roundRect(s * 7 * k - 3 * k, -48 * k + recoil, 6 * k, 40 * k, 2 * k);
      g.fillStyle = '#1f2440';
      g.fill();
      g.strokeStyle = rgba(mixHex(CYAN, '#ffd36b', t.heat), 0.5 + 0.5 * power);
      g.lineWidth = 1.2;
      g.stroke();
    }
    // energy channel between rails
    g.globalCompositeOperation = 'lighter';
    const chan = g.createLinearGradient(0, -46 * k + recoil, 0, -8 * k);
    const hot = mixHex(CYAN, '#fff3c4', t.heat);
    chan.addColorStop(0, rgba(hot, 0.2 + 0.8 * t.flash));
    chan.addColorStop(1, rgba(hot, 0.15 * power));
    g.fillStyle = chan;
    g.fillRect(-2 * k, -46 * k + recoil, 4 * k, 38 * k);
    g.globalCompositeOperation = 'source-over';
    // head housing
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
    g.strokeStyle = rgba(CYAN, 0.5 + 0.4 * power);
    g.lineWidth = 1.4;
    g.stroke();
    g.restore();

    // Core
    g.globalCompositeOperation = 'lighter';
    const coreColor = t.jam > 0.1 ? mixHex(CYAN, ERROR, t.jam) : CYAN;
    const cs = (22 + pulse * 6 + t.flash * 16) * k * (0.4 + 0.6 * power);
    g.globalAlpha = 0.9 * power + 0.1;
    g.drawImage(glowSprite(coreColor), x - cs, y - cs, cs * 2, cs * 2);
    g.beginPath();
    g.arc(x, y, 5 * k, 0, TAU);
    g.fillStyle = power > 0.1 ? '#e9feff' : '#445';
    g.fill();

    // Muzzle flash
    if (t.flash > 0.01) {
      const mx = x + Math.sin(t.angle) * 48 * k;
      const my = y - Math.cos(t.angle) * 48 * k;
      const fs = (18 + 26 * t.flash) * k;
      g.globalAlpha = t.flash;
      g.drawImage(glowSprite('#ffffff'), mx - fs / 2, my - fs / 2, fs, fs);
      g.drawImage(glowSprite(LASER), mx - fs, my - fs, fs * 2, fs * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawTether(g: CanvasRenderingContext2D): void {
    const e = this.game.target;
    if (!e || e.state !== 'alive') return;
    const L = this.layout;
    const t = this.game.turret;
    const mx = L.turretX + Math.sin(t.angle) * 48 * L.k;
    const my = L.turretY - Math.cos(t.angle) * 48 * L.k;
    g.save();
    g.setLineDash([3, 9]);
    g.lineDashOffset = -this.time * 40;
    g.strokeStyle = rgba(CYAN, 0.18 * e.lockT);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(e.px, e.py);
    g.stroke();
    g.restore();
  }

  private drawBolts(g: CanvasRenderingContext2D): void {
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const b of this.game.bolts) {
      const fade = b.enemy.state === 'dead' ? Math.max(0, 1 - b.age * 3) : 1;
      if (fade <= 0) continue;
      const tr = b.trail;
      const color = b.final ? '#d9fbff' : mixHex(LASER, '#a8ffef', b.heat);
      const n = tr.length;
      if (n >= 4) {
        g.globalAlpha = 0.28 * fade;
        g.strokeStyle = color;
        g.lineWidth = b.final ? 10 : 7;
        g.beginPath();
        g.moveTo(tr[0], tr[1]);
        for (let i = 2; i < n; i += 2) g.lineTo(tr[i], tr[i + 1]);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.globalAlpha = 0.95 * fade;
        g.strokeStyle = '#ffffff';
        g.lineWidth = b.final ? 3 : 2;
        g.beginPath();
        g.moveTo(tr[Math.max(0, n - 6)], tr[Math.max(1, n - 5)]);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
      const s = b.final ? 26 : 18;
      g.globalAlpha = fade;
      g.drawImage(glowSprite(color), b.x - s, b.y - s, s * 2, s * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ enemies

  private drawShip(g: CanvasRenderingContext2D, e: Enemy): void {
    const L = this.layout;
    const def = e.def;
    const sprite = shipSprite(def.kind, def.radius * L.k, L.dpr);
    const appear = e.spawnT;
    const doomed = e.state === 'doomed';
    const tilt = def.weaveAmp ? Math.cos(e.age * def.weaveFreq + e.phase) * 0.18 : 0;

    // Engine exhaust (engines face up, away from the planet).
    g.globalCompositeOperation = 'lighter';
    const flick = this.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(this.time * 40 + e.id);
    const engines = def.kind === 'heavy' ? [-1, 0, 1] : def.kind === 'fighter' ? [-0.35, 0.35] : [0];
    for (const off of engines) {
      const ex = e.px + off * e.r * (def.kind === 'heavy' ? 1.0 : 1);
      const ey = e.py - e.r * (def.kind === 'heavy' ? 0.85 : 0.85);
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
      g.drawImage(glowSprite(def.accent), e.px - cs / 2, e.py - cs / 2, cs, cs);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    g.save();
    g.translate(e.px, e.py);
    g.rotate(tilt);
    const sc = 0.6 + 0.4 * appear;
    g.scale(sc, sc);
    g.globalAlpha = appear * (doomed && !this.reducedMotion ? 0.6 + 0.4 * Math.sin(this.time * 60) : 1);
    g.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
    if (e.hitFlash > 0 || doomed) {
      g.globalAlpha = doomed ? 0.7 : e.hitFlash * 0.85;
      g.drawImage(sprite.flash, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
    }
    g.restore();
    g.globalAlpha = 1;

    // Lock-on reticle.
    if (e === this.game.target) this.drawReticle(g, e);
  }

  private drawReticle(g: CanvasRenderingContext2D, e: Enemy): void {
    const t = e.lockT;
    const ease = 1 - Math.pow(1 - t, 3);
    const size = e.r * (2.6 - 1.05 * ease) + 6;
    const rot = this.reducedMotion ? 0 : this.time * 1.4;
    g.save();
    g.translate(e.px, e.py);
    g.rotate(rot);
    g.strokeStyle = rgba(CYAN, 0.35 + 0.65 * ease);
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
    const font = `700 ${L.labelFont}px ${FONT_MONO}`;
    g.font = font;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    // Untargeted first, the locked target on top.
    for (const e of this.game.enemies) if (e !== target) this.drawLabel(g, e, false);
    if (target && target.state !== 'dead') this.drawLabel(g, target, true);
  }

  private drawLabel(g: CanvasRenderingContext2D, e: Enemy, locked: boolean): void {
    const L = this.layout;
    if (e.state === 'dead') return;
    const doomed = e.state === 'doomed';
    const w = e.labelW;
    const h = L.labelH;
    const shakeX = e.errorShake > 0 && !this.reducedMotion ? Math.sin(e.errorShake * 38) * 5 * e.errorShake : 0;
    const scale = locked ? 1 + 0.06 * (1 - Math.pow(1 - e.lockT, 2)) : 1;
    const x = e.lx + shakeX;
    const y = e.ly;
    const danger = clamp((e.progress - 0.72) / 0.28, 0, 1);

    g.save();
    g.translate(x, y + h / 2);
    g.scale(scale, scale);
    g.globalAlpha = Math.min(1, e.spawnT * 1.5) * (doomed ? 0.55 : 1);

    // Stem from ship to label.
    g.strokeStyle = rgba(e.def.color, 0.45);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(e.px - x, -h / 2 - (e.ly - e.py) + e.r * 0.9);
    g.lineTo(0, -h / 2);
    g.stroke();

    // Backplate
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, h * 0.28);
    g.fillStyle = locked ? 'rgba(6,14,30,0.92)' : 'rgba(7,8,22,0.82)';
    g.fill();
    let border = rgba(e.def.color, 0.6);
    if (danger > 0 && !locked) border = rgba(mixHex(e.def.color, ERROR, danger), 0.6 + 0.4 * danger * (0.5 + 0.5 * Math.sin(this.time * 10)));
    if (locked) border = CYAN;
    if (e.errorShake > 0.05) border = mixHex(locked ? CYAN : e.def.color, ERROR, e.errorShake);
    g.strokeStyle = border;
    g.lineWidth = locked ? 2 : 1.25;
    g.stroke();
    if (locked) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha *= 0.35;
      g.drawImage(glowSprite(CYAN), -w * 0.7, -h * 1.2, w * 1.4, h * 2.4);
      g.globalAlpha = Math.min(1, e.spawnT * 1.5);
      g.globalCompositeOperation = 'source-over';
    }

    // Letters: typed part glows cyan, remaining part bright white.
    const textW = e.word.length * L.charW;
    const tx = -textW / 2;
    const typed = e.word.slice(0, e.typed);
    const rest = e.word.slice(e.typed);
    const ty = 1;
    if (typed) {
      g.fillStyle = CYAN;
      g.shadowColor = CYAN;
      g.shadowBlur = locked ? 10 : 4;
      g.fillText(typed, tx, ty);
      g.shadowBlur = 0;
    }
    if (rest) {
      g.fillStyle = e.typed > 0 && !locked ? '#d8dcf0' : TEXT;
      g.fillText(rest, tx + typed.length * L.charW, ty);
      if (locked) {
        // Caret under the next letter.
        const cx = tx + typed.length * L.charW;
        const blink = this.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(this.time * 12);
        g.fillStyle = rgba(CYAN, blink);
        g.fillRect(cx + 1, h / 2 - 5, L.charW - 2, 2);
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
    g.fillStyle = this.comboPulse < -0.05 ? mixHex(TEXT, ERROR, -this.comboPulse) : s.multiplier >= 4 ? '#ffd36b' : TEXT;
    g.fillText(String(s.combo), 0, 4 * L.k);
    g.restore();

    // Progress toward the next multiplier tier.
    const next = s.nextThreshold;
    const prev = MULT_THRESHOLDS[s.multiplier - 1];
    const barW = 86 * L.k;
    const p = next === null ? 1 : (s.combo - prev) / (next - prev);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(-barW, 12 * L.k, barW, 3);
    g.fillStyle = s.multiplier >= 4 ? '#ffd36b' : CYAN;
    g.fillRect(-barW, 12 * L.k, barW * clamp(p, 0, 1), 3);
    g.font = `700 ${Math.round(11 * L.k + 2)}px ${FONT_DISPLAY}`;
    g.fillStyle = s.multiplier > 1 ? '#ffd36b' : 'rgba(200,210,255,0.7)';
    g.fillText(next === null ? `×${s.multiplier} MAX` : `×${s.multiplier} → ×${s.multiplier + 1}`, 0, 32 * L.k);
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

  private vignette: HTMLCanvasElement | null = null;
  private dangerVignette: HTMLCanvasElement | null = null;

  /** Bake a radial edge-darkening overlay at low resolution (it is smooth, so upscaling is invisible). */
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
}
