import { TAU, rand } from '../core/math';
import { glowSprite } from './sprites';

export type ParticleKind = 'spark' | 'glow' | 'debris' | 'smoke' | 'ring' | 'ember';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  gravity: number;
  rot: number;
  vr: number;
}

export interface FloatText {
  text: string;
  sub?: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

const MAX_PARTICLES = 1400;

/** Simple pooled particle system with additive glow rendering. */
export class Particles {
  list: Particle[] = [];
  texts: FloatText[] = [];
  private pool: Particle[] = [];
  /** 0..1 multiplier on particle counts (reduced motion lowers it). */
  density = 1;

  clear(): void {
    this.pool.push(...this.list);
    this.list = [];
    this.texts = [];
  }

  spawn(p: Partial<Particle> & { x: number; y: number; color: string }): void {
    if (this.list.length >= MAX_PARTICLES) return;
    const o = this.pool.pop() ?? ({} as Particle);
    o.kind = p.kind ?? 'spark';
    o.x = p.x;
    o.y = p.y;
    o.vx = p.vx ?? 0;
    o.vy = p.vy ?? 0;
    o.life = o.max = p.max ?? 0.5;
    o.size = p.size ?? 2;
    o.color = p.color;
    o.drag = p.drag ?? 2;
    o.gravity = p.gravity ?? 0;
    o.rot = p.rot ?? Math.random() * TAU;
    o.vr = p.vr ?? 0;
    this.list.push(o);
  }

  burst(x: number, y: number, color: string, count: number, speed: number, opts: Partial<Particle> = {}): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.25 + Math.random() * 0.75);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        color,
        max: rand(0.35, 0.8),
        size: rand(1, 2.4),
        ...opts,
      });
    }
  }

  /** Directed spray (e.g. impact sparks bouncing back toward the shooter). */
  spray(x: number, y: number, angle: number, spread: number, color: string, count: number, speed: number, opts: Partial<Particle> = {}): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, max: rand(0.18, 0.4), ...opts });
    }
  }

  text(t: Omit<FloatText, 'life'>): void {
    this.texts.push({ ...t, life: t.max });
  }

  update(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.push(p);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      keep.push(p);
    }
    this.list = keep;
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= dt * 38;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  draw(g: CanvasRenderingContext2D): void {
    // Smoke first (normal blending), then additive light.
    for (const p of this.list) {
      if (p.kind !== 'smoke' && p.kind !== 'debris') continue;
      const t = p.life / p.max;
      if (p.kind === 'smoke') {
        g.globalAlpha = t * 0.35;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.8 - t), 0, TAU);
        g.fill();
      } else {
        g.globalAlpha = Math.min(1, t * 2);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(-p.size, -p.size * 0.6);
        g.lineTo(p.size, 0);
        g.lineTo(-p.size * 0.4, p.size * 0.7);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    g.globalAlpha = 1;

    g.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const t = p.life / p.max;
      switch (p.kind) {
        case 'spark':
        case 'ember': {
          const len = p.kind === 'spark' ? 0.035 : 0.02;
          g.strokeStyle = p.color;
          g.globalAlpha = Math.min(1, t * 1.6);
          g.lineWidth = p.size * (0.5 + t * 0.6);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * len, p.y - p.vy * len);
          g.stroke();
          break;
        }
        case 'glow': {
          const s = p.size * (0.6 + 0.4 * t) * 2;
          g.globalAlpha = t;
          g.drawImage(glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'ring': {
          const prog = 1 - t;
          const r = p.size * (0.15 + 0.85 * (1 - Math.pow(1 - prog, 3)));
          g.globalAlpha = t * t;
          g.strokeStyle = p.color;
          g.lineWidth = 1 + 5 * t;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, TAU);
          g.stroke();
          break;
        }
        case 'debris': {
          // hot edge glow on debris
          g.globalAlpha = t * 0.5;
          const s = p.size * 2.5;
          g.drawImage(glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        default:
          break;
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawTexts(g: CanvasRenderingContext2D, font: string): void {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of this.texts) {
      const age = t.max - t.life;
      const pop = Math.min(1, age * 8);
      const fade = Math.min(1, t.life * 2.5);
      const scale = 0.6 + 0.4 * pop + (age < 0.12 ? 0.15 : 0);
      g.globalAlpha = fade;
      g.save();
      g.translate(t.x, t.y);
      g.scale(scale, scale);
      g.font = `800 ${t.size}px ${font}`;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(4,5,14,0.85)';
      g.strokeText(t.text, 0, 0);
      g.fillStyle = t.color;
      g.fillText(t.text, 0, 0);
      if (t.sub) {
        g.font = `700 ${Math.round(t.size * 0.55)}px ${font}`;
        g.strokeText(t.sub, 0, t.size * 0.85);
        g.fillStyle = '#ffffff';
        g.fillText(t.sub, 0, t.size * 0.85);
      }
      g.restore();
    }
    g.globalAlpha = 1;
  }
}
