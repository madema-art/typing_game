import type { EnemyKind } from '../game/enemyTypes';
import { ENEMY_DEFS } from '../game/enemyTypes';
import { rgba } from '../core/math';

/**
 * Pre-rendered sprites. Rendering glow with shadowBlur every frame is slow,
 * so soft glows and ship hulls are baked into offscreen canvases.
 */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

const glowCache = new Map<string, HTMLCanvasElement>();

/** A soft radial glow of the given colour, 128px. Draw with 'lighter'. */
export function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  const size = 128;
  const [cv, g] = makeCanvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.18, rgba(color, 0.55));
  grad.addColorStop(0.45, rgba(color, 0.16));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(color, cv);
  c = cv;
  return c;
}

export interface ShipSprite {
  canvas: HTMLCanvasElement;
  /** White silhouette used for hit flashes. */
  flash: HTMLCanvasElement;
  /** Size in CSS px (sprite is rendered at `scale` x for crispness). */
  w: number;
  h: number;
}

const shipCache = new Map<string, ShipSprite>();

export function shipSprite(kind: EnemyKind, radius: number, dpr: number): ShipSprite {
  const key = `${kind}:${radius.toFixed(1)}:${dpr}`;
  const cached = shipCache.get(key);
  if (cached) return cached;
  const def = ENEMY_DEFS[kind];
  const R = radius;
  const w = R * 3.2;
  const h = R * 3.2;
  const scale = dpr * 1.5;
  const [cv, g] = makeCanvas(w * scale, h * scale);
  g.scale(scale, scale);
  g.translate(w / 2, h / 2);
  drawHull(g, kind, R, def.color, def.accent);

  const [fl, fg] = makeCanvas(w * scale, h * scale);
  fg.drawImage(cv, 0, 0);
  fg.globalCompositeOperation = 'source-in';
  fg.fillStyle = '#ffffff';
  fg.fillRect(0, 0, fl.width, fl.height);

  const sprite = { canvas: cv, flash: fl, w, h };
  shipCache.set(key, sprite);
  return sprite;
}

export function clearSpriteCache(): void {
  shipCache.clear();
}

/** Ships point downward (toward the base). Engines are at the top. */
function drawHull(g: CanvasRenderingContext2D, kind: EnemyKind, R: number, color: string, accent: string): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const metal = g.createLinearGradient(-R, -R, R, R);
  metal.addColorStop(0, '#2a2f4a');
  metal.addColorStop(0.5, '#151829');
  metal.addColorStop(1, '#0a0c16');

  // underglow
  g.save();
  g.shadowColor = color;
  g.shadowBlur = R * 0.9;

  if (kind === 'scout') {
    g.beginPath();
    g.moveTo(0, R * 1.15);
    g.lineTo(R * 0.95, -R * 0.55);
    g.lineTo(R * 0.35, -R * 0.25);
    g.lineTo(0, -R * 0.85);
    g.lineTo(-R * 0.35, -R * 0.25);
    g.lineTo(-R * 0.95, -R * 0.55);
    g.closePath();
    g.fillStyle = metal;
    g.fill();
    g.restore();
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.stroke();
    // canopy
    g.beginPath();
    g.moveTo(0, R * 0.7);
    g.lineTo(R * 0.22, -R * 0.05);
    g.lineTo(-R * 0.22, -R * 0.05);
    g.closePath();
    g.fillStyle = accent;
    g.globalAlpha = 0.9;
    g.fill();
    g.globalAlpha = 1;
    // wing stripes
    g.strokeStyle = rgba(color, 0.7);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(R * 0.55, -R * 0.35);
    g.lineTo(R * 0.2, R * 0.45);
    g.moveTo(-R * 0.55, -R * 0.35);
    g.lineTo(-R * 0.2, R * 0.45);
    g.stroke();
  } else if (kind === 'fighter') {
    g.beginPath();
    g.moveTo(0, R * 1.05);
    g.lineTo(R * 0.32, R * 0.35);
    g.lineTo(R * 1.25, R * 0.05);
    g.lineTo(R * 1.1, -R * 0.45);
    g.lineTo(R * 0.45, -R * 0.35);
    g.lineTo(R * 0.3, -R * 0.9);
    g.lineTo(-R * 0.3, -R * 0.9);
    g.lineTo(-R * 0.45, -R * 0.35);
    g.lineTo(-R * 1.1, -R * 0.45);
    g.lineTo(-R * 1.25, R * 0.05);
    g.lineTo(-R * 0.32, R * 0.35);
    g.closePath();
    g.fillStyle = metal;
    g.fill();
    g.restore();
    g.strokeStyle = color;
    g.lineWidth = 1.8;
    g.stroke();
    // wing tips
    g.fillStyle = color;
    g.fillRect(R * 1.02, -R * 0.42, R * 0.18, R * 0.4);
    g.fillRect(-R * 1.2, -R * 0.42, R * 0.18, R * 0.4);
    // cockpit
    g.beginPath();
    g.ellipse(0, R * 0.2, R * 0.2, R * 0.42, 0, 0, Math.PI * 2);
    g.fillStyle = accent;
    g.fill();
    // panel lines
    g.strokeStyle = rgba(color, 0.55);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(R * 0.45, -R * 0.3);
    g.lineTo(R * 0.9, R * 0.02);
    g.moveTo(-R * 0.45, -R * 0.3);
    g.lineTo(-R * 0.9, R * 0.02);
    g.stroke();
  } else {
    // heavy: armoured hexagonal hull with flanking pods
    const hex = (r: number) => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 1.05;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };
    // pods
    for (const s of [-1, 1]) {
      g.beginPath();
      g.roundRect(s * R * 1.0 - R * 0.28, -R * 0.75, R * 0.56, R * 1.35, R * 0.2);
      g.fillStyle = metal;
      g.fill();
    }
    hex(R);
    g.fillStyle = metal;
    g.fill();
    g.restore();
    for (const s of [-1, 1]) {
      g.beginPath();
      g.roundRect(s * R * 1.0 - R * 0.28, -R * 0.75, R * 0.56, R * 1.35, R * 0.2);
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = rgba(accent, 0.85);
      g.fillRect(s * R * 1.0 - R * 0.08, R * 0.32, R * 0.16, R * 0.18);
    }
    hex(R);
    g.strokeStyle = color;
    g.lineWidth = 2.2;
    g.stroke();
    hex(R * 0.68);
    g.strokeStyle = rgba(color, 0.5);
    g.lineWidth = 1.2;
    g.stroke();
    // armour plates
    g.strokeStyle = rgba(color, 0.4);
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      g.moveTo(Math.cos(a) * R * 0.68, Math.sin(a) * R * 0.71);
      g.lineTo(Math.cos(a) * R, Math.sin(a) * R * 1.05);
    }
    g.stroke();
    // prow cannon
    g.fillStyle = '#0b0d18';
    g.strokeStyle = color;
    g.beginPath();
    g.roundRect(-R * 0.14, R * 0.7, R * 0.28, R * 0.6, 3);
    g.fill();
    g.stroke();
  }
}
