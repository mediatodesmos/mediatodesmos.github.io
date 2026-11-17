/**
 * The picture that gets traced, built from layers:
 *   1. the source (a file, a sample, or a blank canvas for drawings)
 *   2. background removal: a mask (MODNet or plain-background fill) plus
 *      keep/remove touch-up strokes, feathered, applied with destination-in
 *   3. the user's drawing (pen, shapes, fill, text) on top
 * Everything is stored in source fractions, so crop and resolution changes
 * keep working, and video frames get the same treatment.
 */

import { maskToCanvas, plainBackground, segment, type BgMask, type BgMethod, type BgProgress } from '../../pipeline/bgremove';
import type { RgbaImage } from '../../pipeline/types';
import { sourceSize, type Drawable } from '../../media/raster';
import { renderOps, type DetailStroke, type DrawOp } from './draw/ops';

/** Longest side the layers are composed at (the tracer never needs more than 1920). */
const MAX_SIDE = 2048;

export interface MaskEdit {
  /** Stroke points in source fractions. */
  pts: number[];
  /** Radius as a fraction of the long side. */
  r: number;
  keep: boolean;
}

export interface BgOptions {
  on: boolean;
  method: BgMethod;
  /** Plain method: colour tolerance 0..100. */
  tolerance: number;
  /** Edge softening in px of the composed picture. */
  feather: number;
}

export class SourceLayers {
  readonly width: number;
  readonly height: number;
  private base: HTMLCanvasElement;
  private baseMask: { method: BgMethod; tolerance: number; canvas: HTMLCanvasElement } | null = null;
  edits: MaskEdit[] = [];
  ops: DrawOp[] = [];
  detail: DetailStroke[] = [];
  private composed: HTMLCanvasElement | null = null;
  private composedKey = '';
  private rev = 0;

  constructor(source: Drawable) {
    const { width, height } = sourceSize(source);
    const s = Math.min(1, MAX_SIDE / Math.max(width, height));
    this.width = Math.max(1, Math.round(width * s));
    this.height = Math.max(1, Math.round(height * s));
    this.base = document.createElement('canvas');
    this.base.width = this.width;
    this.base.height = this.height;
    this.base.getContext('2d')!.drawImage(source as CanvasImageSource, 0, 0, this.width, this.height);
  }

  /** A white canvas to draw on from scratch. */
  static blank(width = 1280, height = 960): SourceLayers {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    return new SourceLayers(c);
  }

  /** Changes whenever anything that affects the composed picture changes. */
  get version(): number {
    return this.rev;
  }

  touch(): void {
    this.rev++;
  }

  hasMask(method: BgMethod, tolerance: number): boolean {
    const m = this.baseMask;
    return !!m && m.method === method && (method === 'auto' || m.tolerance === tolerance);
  }

  /** Compute the background mask (downloads the model the first time for "auto"). */
  async computeMask(method: BgMethod, tolerance: number, onProgress?: (p: BgProgress) => void): Promise<void> {
    if (this.hasMask(method, tolerance)) return;
    let mask: BgMask;
    if (method === 'auto') mask = await segment(this.base, onProgress);
    else {
      const g = this.base.getContext('2d', { willReadFrequently: true })!;
      const id = g.getImageData(0, 0, this.width, this.height);
      mask = plainBackground({ width: this.width, height: this.height, data: id.data }, tolerance);
    }
    const mc = maskToCanvas(mask);
    // Store at the composed size.
    const full = document.createElement('canvas');
    full.width = this.width;
    full.height = this.height;
    const fg = full.getContext('2d')!;
    fg.imageSmoothingQuality = 'high';
    fg.drawImage(mc, 0, 0, this.width, this.height);
    this.baseMask = { method, tolerance, canvas: full };
    this.rev++;
  }

  /** The mask with touch-up edits, as an alpha canvas. */
  maskCanvas(feather = 0): HTMLCanvasElement | null {
    if (!this.baseMask) return null;
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const g = c.getContext('2d')!;
    g.drawImage(this.baseMask.canvas, 0, 0);
    const L = Math.max(this.width, this.height);
    for (const e of this.edits) {
      g.save();
      g.globalCompositeOperation = e.keep ? 'source-over' : 'destination-out';
      g.strokeStyle = '#fff';
      g.fillStyle = '#fff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = Math.max(1, e.r * 2 * L);
      g.beginPath();
      if (e.pts.length === 2) {
        g.arc(e.pts[0] * this.width, e.pts[1] * this.height, g.lineWidth / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.moveTo(e.pts[0] * this.width, e.pts[1] * this.height);
        for (let i = 2; i < e.pts.length; i += 2) g.lineTo(e.pts[i] * this.width, e.pts[i + 1] * this.height);
        g.stroke();
      }
      g.restore();
    }
    if (feather <= 0) return c;
    const f = document.createElement('canvas');
    f.width = this.width;
    f.height = this.height;
    const fg = f.getContext('2d')!;
    fg.filter = `blur(${feather}px)`;
    fg.drawImage(c, 0, 0);
    return f;
  }

  /** Whether the composed picture differs from the source. */
  active(bg: BgOptions): boolean {
    return (bg.on && !!this.baseMask) || this.ops.length > 0;
  }

  /** The picture to trace: source, minus the background, plus the drawing. */
  compose(bg: BgOptions): HTMLCanvasElement {
    const key = `${this.rev}|${bg.on}|${bg.feather}`;
    if (this.composed && this.composedKey === key) return this.composed;
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const g = c.getContext('2d')!;
    g.drawImage(this.base, 0, 0);
    if (bg.on) {
      const m = this.maskCanvas(bg.feather);
      if (m) {
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(m, 0, 0);
        g.globalCompositeOperation = 'source-over';
      }
    }
    if (this.ops.length) {
      const layer = document.createElement('canvas');
      layer.width = this.width;
      layer.height = this.height;
      renderOps(layer.getContext('2d', { willReadFrequently: true })!, this.ops, this.width, this.height, c);
      g.drawImage(layer, 0, 0);
    }
    this.composed = c;
    this.composedKey = key;
    return c;
  }

  /**
   * Apply the same layers to a video frame: background removal per frame (the
   * fast model, no touch-ups, since every frame differs) and the drawing on top.
   */
  async processFrame(img: RgbaImage, bg: BgOptions): Promise<RgbaImage> {
    if (!(bg.on || this.ops.length)) return img;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    if (bg.on) {
      const mask = bg.method === 'auto' ? await segment(c) : plainBackground(img, bg.tolerance);
      const mc = maskToCanvas(mask);
      g.save();
      if (bg.feather > 0) g.filter = `blur(${(bg.feather * img.width) / this.width}px)`;
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mc, 0, 0, img.width, img.height);
      g.restore();
    }
    if (this.ops.length) {
      const layer = document.createElement('canvas');
      layer.width = img.width;
      layer.height = img.height;
      renderOps(layer.getContext('2d', { willReadFrequently: true })!, this.ops, img.width, img.height, c);
      g.drawImage(layer, 0, 0);
    }
    const id = g.getImageData(0, 0, img.width, img.height);
    return { width: img.width, height: img.height, data: id.data };
  }

  /** The detail-brush strokes as a mask (0/1) at w x h, or null when there are none. */
  detailMask(w: number, h: number, crop?: { x: number; y: number; w: number; h: number } | null): Uint8Array | null {
    if (!this.detail.length) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const cx = crop?.x ?? 0, cy = crop?.y ?? 0, cw = crop?.w ?? 1, ch = crop?.h ?? 1;
    const fx = (v: number) => ((v - cx) / cw) * w;
    const fy = (v: number) => ((v - cy) / ch) * h;
    const L = Math.max(w / cw, h / ch);
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of this.detail) {
      g.lineWidth = Math.max(1, s.r * 2 * L);
      g.beginPath();
      if (s.pts.length === 2) {
        g.arc(fx(s.pts[0]), fy(s.pts[1]), g.lineWidth / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.moveTo(fx(s.pts[0]), fy(s.pts[1]));
        for (let i = 2; i < s.pts.length; i += 2) g.lineTo(fx(s.pts[i]), fy(s.pts[i + 1]));
        g.stroke();
      }
    }
    const d = g.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 64 ? 1 : 0;
    return out;
  }

  /** The source canvas (for editors that show the picture underneath). */
  sourceCanvas(): HTMLCanvasElement {
    return this.base;
  }
}
