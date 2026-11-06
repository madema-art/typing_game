import { TAU, rand } from '../core/math';
import { glowSprite } from './sprites';

export type ParticleKind = 'spark' | 'glow' | 'debris' | 'smoke' | 'ring' | 'ember' | 'shard' | 'glyph';

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
  /** Shard image (kind 'shard'). */
  img: HTMLCanvasElement | null;
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Character (kind 'glyph'). */
  ch: string;
}

export interface FloatText {
  text: string;
  sub?: string;
  subColor?: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

const MAX_PARTICLES = 1800;

/**
 * Pooled particle system. Drawing is split in two passes so the renderer can
 * send the light-emitting pass to the bloom buffer as well.
 */
export class Particles {
  list: Particle[] = [];
  texts: FloatText[] = [];
  private pool: Particle[] = [];
  /** 0..1 multiplier on particle counts (reduced motion lowers it). */
  density = 1;
  glyphFont = '700 20px monospace';

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
    o.img = p.img ?? null;
    o.ox = p.ox ?? 0;
    o.oy = p.oy ?? 0;
    o.w = p.w ?? 0;
    o.h = p.h ?? 0;
    o.ch = p.ch ?? '';
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

  /** Non-emissive particles: smoke, debris, hull shards, flying letters. */
  drawSolid(g: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      const t = p.life / p.max;
      switch (p.kind) {
        case 'smoke':
          g.globalAlpha = t * 0.35;
          g.fillStyle = p.color;
          g.beginPath();
          g.arc(p.x, p.y, p.size * (1.8 - t), 0, TAU);
          g.fill();
          break;
        case 'debris':
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
          break;
        case 'shard':
          if (!p.img) break;
          g.globalAlpha = Math.min(1, t * 1.8);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.drawImage(p.img, -p.w / 2 - p.ox, -p.h / 2 - p.oy, p.w, p.h);
          g.restore();
          break;
        case 'glyph': {
          g.globalAlpha = Math.min(1, t * 1.6);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          const s = 1 + (1 - t) * 0.6;
          g.scale(s, s);
          g.font = this.glyphFont;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = t > 0.7 ? '#ffffff' : p.color;
          g.fillText(p.ch, 0, 0);
          g.restore();
          break;
        }
        default:
          break;
      }
    }
    g.globalAlpha = 1;
  }

  /** Emissive particles, drawn additively. Safe to call on the bloom buffer too. */
  drawLight(g: CanvasRenderingContext2D, bloom = false): void {
    g.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const t = p.life / p.max;
      switch (p.kind) {
        case 'spark':
        case 'ember': {
          const len = p.kind === 'spark' ? 0.035 : 0.02;
          g.strokeStyle = p.color;
          g.globalAlpha = Math.min(1, t * 1.6);
          g.lineWidth = p.size * (0.5 + t * 0.6) * (bloom ? 2 : 1);
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
          g.lineWidth = (1 + 5 * t) * (bloom ? 2 : 1);
          g.beginPath();
          g.arc(p.x, p.y, r, 0, TAU);
          g.stroke();
          break;
        }
        case 'debris':
        case 'shard': {
          // hot, cooling edge glow
          const heat = Math.max(0, t - 0.35) / 0.65;
          if (heat <= 0) break;
          g.globalAlpha = heat * (p.kind === 'shard' ? 0.7 : 0.5);
          const s = p.kind === 'shard' ? p.w * 0.35 : p.size * 2.5;
          g.drawImage(glowSprite(p.kind === 'shard' ? '#ffb27a' : p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'glyph': {
          if (!bloom) break;
          g.globalAlpha = t;
          g.drawImage(glowSprite(p.color), p.x - 14, p.y - 14, 28, 28);
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
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(4,5,14,0.85)';
      g.strokeText(t.text, 0, 0);
      g.fillStyle = t.color;
      g.fillText(t.text, 0, 0);
      if (t.sub) {
        g.font = `700 ${Math.round(t.size * 0.5)}px ${font}`;
        g.strokeText(t.sub, 0, t.size * 0.85);
        g.fillStyle = t.subColor ?? '#ffffff';
        g.fillText(t.sub, 0, t.size * 0.85);
      }
      g.restore();
    }
    g.globalAlpha = 1;
  }

  /** Bloom halo for floating texts. */
  drawTextGlow(g: CanvasRenderingContext2D): void {
    g.globalCompositeOperation = 'lighter';
    for (const t of this.texts) {
      g.globalAlpha = Math.min(1, t.life * 2.5) * 0.5;
      const w = t.size * 2.2;
      g.drawImage(glowSprite(t.color), t.x - w, t.y - t.size, w * 2, t.size * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
