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

const STAR_COLORS = ['#ffffff', '#cfe8ff', '#ffe9c9', '#d9d0ff', '#b8fbff'];

/**
 * Layered animated backdrop: deep gradient, baked drifting nebula, parallax
 * starfield, distant storm lightning, the planet horizon and city lights.
 */
export class Background {
  private stars: Star[] = [];
  private nebula: HTMLCanvasElement | null = null;
  private nebula2: HTMLCanvasElement | null = null;
  private planet: HTMLCanvasElement | null = null;
  private bolts: Bolt[] = [];
  private nextBolt = 2.5;
  /** Ambient flash intensity, read by the renderer to light up the scene. */
  flash = 0;
  flashColor = '#8fd3ff';
  time = 0;
  reducedMotion = false;
  /** Global speed multiplier for the starfield (rises with wave intensity). */
  warp = 1;
  onThunder: ((intensity: number) => void) | null = null;

  constructor(private layout: Layout) {}

  resize(): void {
    const L = this.layout;
    const count = Math.round((L.w * L.h) / 3600);
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
    this.nebula = this.bakeNebula(L.w, L.h, 7, ['#3a1670', '#0d4a6b', '#5a1250', '#14205e'], true);
    this.nebula2 = this.bakeNebula(L.w, L.h, 5, ['#1d6b8a', '#6b1d78', '#232a8a']);
    this.planet = this.bakePlanet();
    this.dangerGrad = null;
  }

  private bakeNebula(w: number, h: number, blobs: number, colors: string[], withSky = false): HTMLCanvasElement {
    // Bake at quarter resolution; it's blurry by nature and scales up beautifully.
    const s = 0.25;
    const c = document.createElement('canvas');
    // The base layer is drawn with an overscan margin so it can drift without exposing edges.
    c.width = Math.max(2, Math.ceil(w * s));
    c.height = Math.max(2, Math.ceil(h * s));
    const g = c.getContext('2d')!;
    if (withSky) {
      // Deep space gradient baked under the nebula so the base layer is one opaque blit per frame.
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

    // Terrain ridges
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
    // City lights scattered along the horizon
    for (let i = 0; i < 160; i++) {
      const x = rand(0, L.w);
      const surfaceY = cy - Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx)));
      const y = surfaceY + Math.pow(Math.random(), 1.6) * (L.h - surfaceY);
      const near = Math.abs(x - cx) < L.w * 0.18 ? 1 : 0.5;
      g.fillStyle = Math.random() < 0.7 ? `rgba(255,200,120,${0.5 * near})` : `rgba(120,240,255,${0.6 * near})`;
      g.fillRect(x, y, 1.4, 1.4);
    }
    g.restore();
    return c;
  }

  update(dt: number): void {
    this.time += dt;
    const L = this.layout;
    const speedBase = this.reducedMotion ? 2 : 9 * this.warp;
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
  }

  private spawnLightning(): void {
    const L = this.layout;
    const x = rand(0.08, 0.92) * L.w;
    const y = rand(0.04, 0.3) * L.h;
    const len = rand(0.12, 0.3) * L.h;
    const points = this.jagged(x, y, x + rand(-80, 80), y + len, 9);
    const branches: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const idx = 2 + Math.floor(Math.random() * 5) * 2;
      const bx = points[idx];
      const by = points[idx + 1];
      branches.push(this.jagged(bx, by, bx + rand(-90, 90), by + rand(30, 90), 5));
    }
    const intensity = rand(0.4, 1);
    const color = Math.random() < 0.5 ? '#a9e6ff' : '#d6b8ff';
    this.bolts.push({ points, branches, life: 0.5, max: 0.5, x, y: y + len / 2, r: len * 1.4, color });
    this.flash = this.reducedMotion ? intensity * 0.25 : intensity * 0.7;
    this.flashColor = color;
    this.onThunder?.(intensity);
  }

  private jagged(x0: number, y0: number, x1: number, y1: number, segs: number): number[] {
    const pts = [x0, y0];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      pts.push(x0 + (x1 - x0) * t + rand(-18, 18), y0 + (y1 - y0) * t + rand(-6, 6));
    }
    pts.push(x1, y1);
    return pts;
  }

  /** Everything behind gameplay. */
  draw(g: CanvasRenderingContext2D, danger: number): void {
    const L = this.layout;
    const t = this.time;

    // Base layer: sky + nebula baked together, drifting slowly. Second nebula layer adds parallax.
    if (this.nebula && this.nebula2) {
      const drift = this.reducedMotion ? 0 : 1;
      g.drawImage(this.nebula, Math.sin(t * 0.02) * 30 * drift - 32, Math.cos(t * 0.015) * 20 * drift - 22, L.w + 64, L.h + 44);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.6 + Math.sin(t * 0.3) * 0.08 * drift;
      g.drawImage(this.nebula2, Math.cos(t * 0.03) * 50 * drift - 50, -30, L.w + 100, L.h + 60);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    // The sky warms toward red as the shield fails.
    if (danger > 0.01) {
      g.globalAlpha = danger * 0.35;
      g.fillStyle = this.dangerGrad ??= this.makeDangerGrad(g);
      g.fillRect(0, 0, L.w, L.h);
      g.globalAlpha = 1;
    }

    // Stars
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
      const streak = this.reducedMotion ? 0 : Math.max(0, (this.warp - 1) * s.z * 10);
      g.fillRect(s.x - s.size / 2, s.y - s.size / 2 - streak, s.size, s.size + streak);
    }
    g.globalAlpha = 1;

    // Distant lightning in the nebula.
    g.globalCompositeOperation = 'lighter';
    for (const b of this.bolts) {
      const p = b.life / b.max;
      const flicker = this.reducedMotion ? p : p * (0.6 + 0.4 * Math.sin(b.life * 90));
      // cloud illumination
      g.globalAlpha = flicker * 0.5;
      g.drawImage(glowSprite(b.color), b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      if (!this.reducedMotion || p > 0.5) {
        g.globalAlpha = flicker * 0.85;
        g.strokeStyle = b.color;
        g.lineWidth = 1.6;
        g.lineJoin = 'round';
        this.stroke(g, b.points);
        g.lineWidth = 0.8;
        for (const br of b.branches) this.stroke(g, br);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private dangerGrad: CanvasGradient | null = null;

  private makeDangerGrad(g: CanvasRenderingContext2D): CanvasGradient {
    const grad = g.createLinearGradient(0, 0, 0, this.layout.h);
    grad.addColorStop(0, 'rgba(60,0,20,0)');
    grad.addColorStop(0.6, 'rgba(90,10,30,0.6)');
    grad.addColorStop(1, 'rgba(120,20,40,0.8)');
    return grad;
  }

  private stroke(g: CanvasRenderingContext2D, pts: number[]): void {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  }

  /** The planet horizon, drawn after the shield but before the turret. */
  drawPlanet(g: CanvasRenderingContext2D): void {
    const L = this.layout;
    if (!this.planet) return;
    const top = L.horizonY - 80 * L.k;
    g.drawImage(this.planet, 0, top, L.w, this.planet.height / L.dpr);
    if (this.flash > 0.01) {
      // lightning briefly lights the atmosphere
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = this.flash * 0.25;
      g.fillStyle = this.flashColor;
      g.fillRect(0, top, L.w, 80 * L.k);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }
}
