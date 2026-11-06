import type { Layout } from '../core/layout';
import { TAU, rand, rgba } from '../core/math';
import { glowSprite } from './sprites';

interface Star {
  x: number;
  y: number;
  z: number; // layer depth 0..1 (1 = near)
  tw: number;
  size: number;
  hue: string;
}

interface Bolt {
  points: number[];
  branches: number[][];
  life: number;
  max: number;
  x: number;
  y: number;
  r: number;
  color: string;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

const STAR_COLORS = ['#ffffff', '#cfe8ff', '#ffe9c9', '#d9d0ff', '#b8fbff'];

/**
 * Layered animated backdrop: baked sky + drifting nebulae, parallax starfield,
 * a ringed gas giant, distant storm lightning, shooting stars, and the planet
 * horizon with its city lights.
 */
export class Background {
  private stars: Star[] = [];
  private nebula: HTMLCanvasElement | null = null;
  private planet: HTMLCanvasElement | null = null;
  private giant: HTMLCanvasElement | null = null;
  private giantPos = { x: 0, y: 0, size: 0 };
  private bolts: Bolt[] = [];
  private meteors: Meteor[] = [];
  private nextBolt = 2.5;
  private nextMeteor = 3;
  private dangerGrad: CanvasGradient | null = null;
  /** Ambient flash intensity, read by the renderer to light up the scene. */
  flash = 0;
  flashColor = '#8fd3ff';
  time = 0;
  reducedMotion = false;
  /** Global speed multiplier for the starfield (rises with wave intensity). */
  warp = 1;
  /** Short hyperspace burst at the start of each wave (decays to 0). */
  warpBoost = 0;
  onThunder: ((intensity: number, pan: number) => void) | null = null;

  constructor(private layout: Layout) {}

  resize(): void {
    const L = this.layout;
    const count = Math.round((L.w * L.h) / 3400);
    this.stars = [];
    for (let i = 0; i < count; i++) {
      const z = Math.pow(Math.random(), 2.2);
      this.stars.push({
        x: Math.random() * L.w,
        y: Math.random() * L.h,
        z,
        tw: Math.random() * TAU,
        size: 0.5 + z * 1.6 + (Math.random() < 0.03 ? 1.2 : 0),
        hue: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      });
    }
    // Both nebula layers are baked into one opaque canvas: one full-screen blit per frame.
    this.nebula = this.bakeNebula(L.w, L.h, 7, ['#3a1670', '#0d4a6b', '#5a1250', '#14205e'], true);
    const second = this.bakeNebula(L.w, L.h, 5, ['#1d6b8a', '#6b1d78', '#232a8a']);
    const ng = this.nebula.getContext('2d')!;
    ng.globalCompositeOperation = 'lighter';
    ng.globalAlpha = 0.65;
    ng.drawImage(second, 0, 0);
    ng.globalAlpha = 1;
    ng.globalCompositeOperation = 'source-over';
    this.planet = this.bakePlanet();
    this.giant = this.bakeGiant();
    this.dangerGrad = null;
  }

  private bakeNebula(w: number, h: number, blobs: number, colors: string[], withSky = false): HTMLCanvasElement {
    // Bake at quarter resolution; it's blurry by nature and scales up beautifully.
    const s = 0.25;
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.ceil(w * s));
    c.height = Math.max(2, Math.ceil(h * s));
    const g = c.getContext('2d')!;
    if (withSky) {
      const sky = g.createLinearGradient(0, 0, 0, c.height);
      sky.addColorStop(0, '#04040c');
      sky.addColorStop(0.55, '#0a0820');
      sky.addColorStop(1, '#0d1030');
      g.fillStyle = sky;
      g.fillRect(0, 0, c.width, c.height);
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < blobs * 3; i++) {
      const color = colors[i % colors.length];
      const x = rand(-0.1, 1.1) * c.width;
      const y = rand(-0.1, 0.75) * c.height;
      const r = rand(0.15, 0.45) * Math.max(c.width, c.height);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const a = rand(0.08, 0.2);
      grad.addColorStop(0, rgba(color, a));
      grad.addColorStop(0.5, rgba(color, a * 0.4));
      grad.addColorStop(1, rgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    }
    // Wisps: thin, stretched bright filaments give the clouds structure.
    for (let i = 0; i < blobs * 2; i++) {
      g.save();
      g.translate(rand(0, c.width), rand(0, c.height * 0.7));
      g.rotate(rand(-0.6, 0.6));
      g.scale(1, rand(0.08, 0.2));
      const r = rand(0.1, 0.3) * c.width;
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      const color = colors[(i + 1) % colors.length];
      grad.addColorStop(0, rgba(color, 0.25));
      grad.addColorStop(1, rgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
    // Dark dust lanes for depth.
    g.globalCompositeOperation = withSky ? 'source-over' : 'destination-out';
    for (let i = 0; i < blobs; i++) {
      const x = rand(0, 1) * c.width;
      const y = rand(0, 0.7) * c.height;
      const r = rand(0.05, 0.16) * Math.max(c.width, c.height);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, withSky ? 'rgba(4,4,12,0.5)' : 'rgba(0,0,0,0.5)');
      grad.addColorStop(1, withSky ? 'rgba(4,4,12,0)' : 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  /** A distant ringed gas giant with banded atmosphere and a lit crescent. */
  private bakeGiant(): HTMLCanvasElement {
    const L = this.layout;
    const R = Math.max(42, Math.min(L.w, L.h) * 0.085);
    const size = R * 5.2;
    const c = document.createElement('canvas');
    const dpr = L.dpr;
    c.width = Math.ceil(size * dpr);
    c.height = Math.ceil(size * 0.75 * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const cx = size / 2;
    const cy = (size * 0.75) / 2;
    const tilt = -0.32;

    const ring = (front: boolean) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(tilt);
      g.beginPath();
      if (front) g.rect(-size, 0, size * 2, size);
      else g.rect(-size, -size, size * 2, size);
      g.clip();
      for (let i = 0; i < 26; i++) {
        const rr = R * (1.35 + i * 0.045);
        const a = (0.05 + 0.2 * Math.abs(Math.sin(i * 1.7))) * (i > 20 ? 0.4 : 1);
        g.beginPath();
        g.ellipse(0, 0, rr, rr * 0.22, 0, 0, TAU);
        g.strokeStyle = `rgba(${215 + (i % 3) * 10},${190 - i * 2},${200 - i * 3},${a})`;
        g.lineWidth = R * 0.04;
        g.stroke();
      }
      g.restore();
    };

    ring(false);
    // Planet body with bands
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.clip();
    const body = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    body.addColorStop(0, '#e8a07c');
    body.addColorStop(0.5, '#8a4a7a');
    body.addColorStop(1, '#2a1640');
    g.fillStyle = body;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.translate(cx, cy);
    g.rotate(tilt);
    for (let i = 0; i < 14; i++) {
      const y = -R + (i / 14) * R * 2 + rand(-3, 3);
      g.fillStyle = i % 2 ? 'rgba(255,220,200,0.08)' : 'rgba(60,20,70,0.12)';
      g.fillRect(-R * 1.2, y, R * 2.4, rand(R * 0.05, R * 0.14));
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Terminator shadow
    const shade = g.createRadialGradient(cx - R * 0.45, cy - R * 0.45, R * 0.2, cx, cy, R * 1.25);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.6, 'rgba(6,4,18,0.35)');
    shade.addColorStop(1, 'rgba(6,4,18,0.92)');
    g.fillStyle = shade;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.restore();
    // Atmospheric rim
    g.beginPath();
    g.arc(cx, cy, R, Math.PI * 0.9, Math.PI * 1.75);
    g.strokeStyle = 'rgba(255,200,170,0.5)';
    g.lineWidth = 1.5;
    g.stroke();
    ring(true);

    this.giantPos = { x: L.w * 0.92, y: L.h * 0.46, size };
    return c;
  }

  private planetGeom(): { cx: number; cy: number; r: number } {
    const L = this.layout;
    const r = Math.max(L.w * 1.4, 1600);
    return { cx: L.cx, cy: L.horizonY + r, r };
  }

  private bakePlanet(): HTMLCanvasElement {
    const L = this.layout;
    const height = Math.ceil(L.h - L.horizonY + 80 * L.k);
    const c = document.createElement('canvas');
    c.width = Math.ceil(L.w * L.dpr);
    c.height = Math.ceil(height * L.dpr);
    const g = c.getContext('2d')!;
    g.scale(L.dpr, L.dpr);
    const top = L.horizonY - 80 * L.k;
    g.translate(0, -top);
    const { cx, cy, r } = this.planetGeom();

    // Atmosphere halo
    const halo = g.createRadialGradient(cx, cy, r * 0.995, cx, cy, r + 70 * L.k);
    halo.addColorStop(0, 'rgba(95,246,255,0.45)');
    halo.addColorStop(0.2, 'rgba(80,140,255,0.18)');
    halo.addColorStop(1, 'rgba(60,40,160,0)');
    g.fillStyle = halo;
    g.fillRect(0, top, L.w, L.h - top);

    // Surface
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    const surf = g.createLinearGradient(0, L.horizonY, 0, L.h);
    surf.addColorStop(0, '#16193a');
    surf.addColorStop(0.25, '#0b0d22');
    surf.addColorStop(1, '#04050d');
    g.fillStyle = surf;
    g.fill();

    // Rim light
    g.beginPath();
    g.arc(cx, cy, r, Math.PI * 1.25, Math.PI * 1.75);
    g.strokeStyle = 'rgba(159,252,255,0.75)';
    g.lineWidth = 1.5;
    g.stroke();

    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.clip();
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(cx, cy, r - (10 + i * 14) * L.k, Math.PI * 1.2, Math.PI * 1.8);
      g.strokeStyle = `rgba(120,140,255,${0.08 - i * 0.015})`;
      g.lineWidth = 1;
      g.stroke();
    }
    // City lights, clustered and denser near the Spire
    for (let i = 0; i < 260; i++) {
      const near = Math.random() < 0.45;
      const x = near ? cx + rand(-0.22, 0.22) * L.w : rand(0, L.w);
      const surfaceY = cy - Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx)));
      const y = surfaceY + 3 + Math.pow(Math.random(), 1.8) * (L.h - surfaceY);
      const warm = Math.random() < 0.7;
      g.fillStyle = warm ? `rgba(255,200,120,${near ? 0.6 : 0.3})` : `rgba(120,240,255,${near ? 0.7 : 0.35})`;
      g.fillRect(x, y, 1.4, 1.4);
      if (near && Math.random() < 0.15) {
        g.globalCompositeOperation = 'lighter';
        g.drawImage(glowSprite(warm ? '#ffb070' : '#5ff6ff'), x - 6, y - 6, 12, 12);
        g.globalCompositeOperation = 'source-over';
      }
    }
    g.restore();
    return c;
  }

  update(dt: number): void {
    this.time += dt;
    const L = this.layout;
    this.warpBoost = Math.max(0, this.warpBoost - dt * 0.7);
    const speedBase = this.reducedMotion ? 2 : 9 * (this.warp + this.warpBoost * this.warpBoost * 14);
    for (const s of this.stars) {
      s.y += speedBase * (0.15 + s.z * 1.4) * dt;
      if (s.y > L.h) {
        s.y -= L.h;
        s.x = Math.random() * L.w;
      }
    }

    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = rand(3.5, 9);
      this.spawnLightning();
    }
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    this.flash = Math.max(0, this.flash - dt * 3);

    this.nextMeteor -= dt;
    if (this.nextMeteor <= 0 && !this.reducedMotion) {
      this.nextMeteor = rand(4, 11);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const speed = rand(700, 1100);
      const a = rand(0.35, 0.6);
      this.meteors.push({
        x: dir > 0 ? rand(-0.1, 0.5) * L.w : rand(0.5, 1.1) * L.w,
        y: rand(-0.05, 0.25) * L.h,
        vx: Math.cos(a) * speed * dir,
        vy: Math.sin(a) * speed,
        life: 0.9,
        max: 0.9,
      });
    }
    for (const m of this.meteors) {
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    this.meteors = this.meteors.filter((m) => m.life > 0);
  }

  private spawnLightning(): void {
    const L = this.layout;
    const x = rand(0.08, 0.92) * L.w;
    const y = rand(0.04, 0.3) * L.h;
    const len = rand(0.12, 0.3) * L.h;
    const points = jagged(x, y, x + rand(-80, 80), y + len, 9, 18);
    const branches: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const idx = 2 + Math.floor(Math.random() * 5) * 2;
      const bx = points[idx];
      const by = points[idx + 1];
      branches.push(jagged(bx, by, bx + rand(-90, 90), by + rand(30, 90), 5, 14));
    }
    const intensity = rand(0.4, 1);
    const color = Math.random() < 0.5 ? '#a9e6ff' : '#d6b8ff';
    this.bolts.push({ points, branches, life: 0.5, max: 0.5, x, y: y + len / 2, r: len * 1.4, color });
    this.flash = this.reducedMotion ? intensity * 0.25 : intensity * 0.7;
    this.flashColor = color;
    this.onThunder?.(intensity, (x / L.w) * 2 - 1);
  }

  /** Everything behind gameplay. */
  draw(g: CanvasRenderingContext2D, danger: number): void {
    const L = this.layout;
    const t = this.time;

    if (this.nebula) {
      const drift = this.reducedMotion ? 0 : 1;
      g.drawImage(this.nebula, Math.sin(t * 0.02) * 30 * drift - 32, Math.cos(t * 0.015) * 20 * drift - 22, L.w + 64, L.h + 44);
    }
    if (danger > 0.01) {
      g.globalAlpha = danger * 0.35;
      g.fillStyle = this.dangerGrad ??= this.makeDangerGrad(g);
      g.fillRect(0, 0, L.w, L.h);
      g.globalAlpha = 1;
    }

    // Stars
    const streakBase = this.reducedMotion ? 0 : Math.max(0, this.warp - 1) * 10 + this.warpBoost * this.warpBoost * 120;
    for (const s of this.stars) {
      const tw = this.reducedMotion ? 0.85 : 0.6 + 0.4 * Math.sin(t * (1 + s.z * 2) + s.tw);
      g.globalAlpha = tw * (0.35 + s.z * 0.65);
      g.fillStyle = s.hue;
      if (s.size > 1.8) {
        g.globalCompositeOperation = 'lighter';
        const gs = s.size * 5;
        g.drawImage(glowSprite(s.hue), s.x - gs, s.y - gs, gs * 2, gs * 2);
        g.globalCompositeOperation = 'source-over';
      }
      const streak = streakBase * s.z;
      g.fillRect(s.x - s.size / 2, s.y - s.size / 2 - streak, s.size, s.size + streak);
    }
    g.globalAlpha = 1;

    // Gas giant, slowly drifting.
    if (this.giant) {
      const gp = this.giantPos;
      const drift = this.reducedMotion ? 0 : Math.sin(t * 0.03) * 8;
      const w = gp.size;
      const h = gp.size * 0.75;
      g.globalAlpha = 0.9;
      g.drawImage(this.giant, gp.x - w / 2 + drift, gp.y - h / 2, w, h);
      g.globalAlpha = 1;
    }

    // Shooting stars
    g.globalCompositeOperation = 'lighter';
    for (const m of this.meteors) {
      const a = Math.sin((m.life / m.max) * Math.PI);
      const tail = 0.12;
      const grad = g.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
      grad.addColorStop(0, `rgba(220,245,255,${a})`);
      grad.addColorStop(1, 'rgba(120,180,255,0)');
      g.strokeStyle = grad;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
      g.stroke();
      g.globalAlpha = a;
      g.drawImage(glowSprite('#cdeeff'), m.x - 6, m.y - 6, 12, 12);
      g.globalAlpha = 1;
    }

    // Distant lightning in the nebula.
    for (const b of this.bolts) {
      const p = b.life / b.max;
      const flicker = this.reducedMotion ? p : p * (0.6 + 0.4 * Math.sin(b.life * 90));
      g.globalAlpha = flicker * 0.5;
      g.drawImage(glowSprite(b.color), b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      if (!this.reducedMotion || p > 0.5) {
        g.globalAlpha = flicker * 0.85;
        g.strokeStyle = b.color;
        g.lineWidth = 1.6;
        g.lineJoin = 'round';
        strokePts(g, b.points);
        g.lineWidth = 0.8;
        for (const br of b.branches) strokePts(g, br);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private makeDangerGrad(g: CanvasRenderingContext2D): CanvasGradient {
    const grad = g.createLinearGradient(0, 0, 0, this.layout.h);
    grad.addColorStop(0, 'rgba(60,0,20,0)');
    grad.addColorStop(0.6, 'rgba(90,10,30,0.6)');
    grad.addColorStop(1, 'rgba(120,20,40,0.8)');
    return grad;
  }

  /** The planet horizon, drawn after the shield but before the turret. */
  drawPlanet(g: CanvasRenderingContext2D): void {
    const L = this.layout;
    if (!this.planet) return;
    const top = L.horizonY - 80 * L.k;
    g.drawImage(this.planet, 0, top, L.w, this.planet.height / L.dpr);
    if (this.flash > 0.01) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = this.flash * 0.25;
      g.fillStyle = this.flashColor;
      g.fillRect(0, top, L.w, 80 * L.k);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }
}

/** A jagged polyline between two points (lightning). */
export function jagged(x0: number, y0: number, x1: number, y1: number, segs: number, amp: number): number[] {
  const pts = [x0, y0];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const off = (Math.random() * 2 - 1) * amp * Math.sin(t * Math.PI);
    pts.push(x0 + dx * t + nx * off, y0 + dy * t + ny * off);
  }
  pts.push(x1, y1);
  return pts;
}

export function strokePts(g: CanvasRenderingContext2D, pts: number[]): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}
