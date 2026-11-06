import { clamp } from './math';

/**
 * Screen geometry, recomputed on resize. All values are CSS pixels.
 * Gameplay positions are stored in normalised form (x in 0..1 of the field,
 * descent progress in 0..1) so a resize never teleports enemies unfairly.
 */
export class Layout {
  w = 1280;
  h = 800;
  dpr = 1;
  /** Uniform scale relative to a 900px tall reference viewport. */
  k = 1;
  fieldX = 0;
  fieldW = 1280;
  cx = 640;
  shieldApexY = 600;
  shieldSag = 40;
  turretX = 640;
  turretY = 720;
  horizonY = 740;
  spawnY = -60;
  labelFont = 20;
  labelH = 30;
  labelOffset = 30;
  charW = 12;

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.k = clamp(h / 900, 0.72, 1.2);
    this.fieldW = Math.min(w, 1500);
    this.fieldX = (w - this.fieldW) / 2;
    this.cx = w / 2;
    this.horizonY = h - 62 * this.k;
    this.turretX = this.cx;
    this.turretY = h - 92 * this.k;
    this.shieldApexY = h - 180 * this.k;
    this.shieldSag = 46 * this.k;
    this.spawnY = -56 * this.k;
    this.labelFont = Math.round(clamp(21 * this.k, 17, 24));
    this.labelH = Math.round(this.labelFont * 1.55);
    this.labelOffset = Math.round(28 * this.k);
  }

  /** y of the shield dome at horizontal pixel position x. */
  shieldY(x: number): number {
    const half = this.fieldW / 2 + 60;
    const t = clamp((x - this.cx) / half, -1, 1);
    return this.shieldApexY + this.shieldSag * t * t;
  }

  /** Convert normalised field x (0..1) to pixels. */
  fx(nx: number): number {
    return this.fieldX + nx * this.fieldW;
  }

  /** y of a ship's centre when its label bottom touches the shield. */
  endY(px: number, shipLabelGap: number): number {
    return this.shieldY(px) - this.labelOffset - this.labelH - shipLabelGap;
  }

  labelWidth(len: number): number {
    return Math.ceil(len * this.charW + this.labelFont * 1.1);
  }
}
