/**
 * "Source analysis" card: the input next to what the tracer saw (bitmap or
 * edge map) and an overlay of the traced shapes, plus a luminance histogram
 * with the threshold marker (click it to set the threshold).
 */

import { el } from '../../ui/dom';
import { segmented } from '../../ui/components';
import type { RgbaImage, TraceResult } from '../../pipeline/types';
import { drawShapes } from '../../render/shapes';

export type AnalysisView = 'source' | 'bitmap' | 'overlay';

export interface AnalysisOptions {
  onThreshold: (t: number) => void;
  /** BETA crop: a new crop rectangle was drawn (fractions of the full source). */
  onCrop?: (crop: CropRect | null) => void;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ASPECTS: Record<string, number | null> = { free: null, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16 };

export class Analysis {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private hist: HTMLCanvasElement;
  private info: HTMLElement;
  private view: AnalysisView = 'overlay';
  private img: RgbaImage | null = null;
  private res: TraceResult | null = null;
  private highlight = new Set<number>();
  private tray: { el: HTMLElement; set(v: AnalysisView): void };
  private srcCanvas: HTMLCanvasElement | null = null;
  private histData: number[] | null = null;
  private threshold = -1;
  private showHist = true;
  // BETA crop editing
  private cropMode = false;
  private cropFull: HTMLCanvasElement | null = null;
  private crop: CropRect | null = null;
  private aspect: number | null = null;
  private drag: { kind: 'move' | 'new' | 'corner'; ax: number; ay: number; start: CropRect | null } | null = null;

  constructor(private opts: AnalysisOptions) {
    this.canvas = el('canvas', { class: 'an-canvas', attrs: { 'aria-label': 'Source analysis preview' } });
    this.hist = el('canvas', {
      class: 'an-hist',
      width: 256,
      height: 40,
      title: 'Luminance histogram. Click to set the threshold.',
      on: {
        click: (e: MouseEvent) => {
          const r = this.hist.getBoundingClientRect();
          const t = Math.round(((e.clientX - r.left) / r.width) * 255);
          this.opts.onThreshold(Math.max(0, Math.min(255, t)));
        },
      },
    });
    this.info = el('div', { class: 'an-info' });
    this.tray = segmented<AnalysisView>(
      [
        { value: 'source', label: 'Source', icon: 'image' },
        { value: 'bitmap', label: 'Bitmap', icon: 'contrast' },
        { value: 'overlay', label: 'Overlay', icon: 'layers' },
      ],
      this.view,
      (v) => {
        this.view = v;
        this.draw();
      },
      { size: 'sm', full: true },
    );
    this.canvas.addEventListener('pointerdown', (e) => this.cropDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.cropMove(e));
    this.canvas.addEventListener('pointerup', () => this.cropUp());
    this.el = el(
      'div',
      { class: 'an' },
      el('div', { class: 'an-head' }, el('h3', { class: 'overline' }, 'Source analysis'), this.tray.el),
      el('div', { class: 'an-frame' }, this.canvas),
      this.hist,
      this.info,
    );
  }

  /** The traced input at working resolution (for the before/after overlay). */
  sourceCanvas(): HTMLCanvasElement | null {
    return this.srcCanvas;
  }

  setSource(img: RgbaImage): void {
    this.img = img;
    const c = this.srcCanvas ?? document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    this.srcCanvas = c;
    this.draw();
  }

  setResult(res: TraceResult, opts: { threshold: number; showHistogram: boolean; bitmapLabel: string }): void {
    this.res = res;
    this.threshold = opts.threshold;
    this.showHist = opts.showHistogram;
    if (res.histogram) this.histData = res.histogram;
    const chips = this.tray.el.querySelectorAll<HTMLElement>('button, [role=tab]');
    if (chips[1]) {
      const label = chips[1].querySelector('.chip-label') ?? chips[1].lastChild;
      if (label && label.nodeType === Node.TEXT_NODE) label.textContent = opts.bitmapLabel;
      else if (label instanceof HTMLElement) label.textContent = opts.bitmapLabel;
    }
    this.info.textContent = `Traced at ${res.width} x ${res.height} px in ${res.stats.ms} ms${res.stats.dropped ? `, ${res.stats.dropped.toLocaleString('en-US')} small shapes dropped by the budget` : ''}.`;
    this.draw();
  }

  /**
   * BETA crop editing: show the whole, uncropped source with the crop rectangle.
   * Drag inside to move it, from a corner to resize, anywhere else to draw a new one.
   */
  setCropMode(on: boolean, full: HTMLCanvasElement | null, crop: CropRect | null, aspect: string): void {
    this.cropMode = on && !!full;
    this.cropFull = full;
    this.crop = crop;
    this.aspect = ASPECTS[aspect] ?? null;
    this.canvas.classList.toggle('is-cropping', this.cropMode);
    this.draw();
  }

  private point(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }

  /** Height (as a fraction) that keeps the locked aspect ratio for a given width fraction. */
  private lockedH(wFrac: number): number {
    const f = this.cropFull!;
    return this.aspect ? (wFrac * f.width) / (this.aspect * f.height) : wFrac;
  }

  private cropDown(e: PointerEvent): void {
    if (!this.cropMode || !this.cropFull) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.point(e);
    const c = this.crop;
    const r = this.canvas.getBoundingClientRect();
    const tol = 12 / Math.max(1, r.width);
    if (c) {
      const corners: [number, number, number, number][] = [
        [c.x, c.y, c.x + c.w, c.y + c.h],
        [c.x + c.w, c.y, c.x, c.y + c.h],
        [c.x, c.y + c.h, c.x + c.w, c.y],
        [c.x + c.w, c.y + c.h, c.x, c.y],
      ];
      for (const [cx, cy, ox, oy] of corners) {
        if (Math.abs(x - cx) < tol && Math.abs(y - cy) < tol * (r.width / r.height)) {
          this.drag = { kind: 'corner', ax: ox, ay: oy, start: c };
          return;
        }
      }
      if (x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) {
        this.drag = { kind: 'move', ax: x, ay: y, start: { ...c } };
        return;
      }
    }
    this.drag = { kind: 'new', ax: x, ay: y, start: null };
  }

  private cropMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const [x, y] = this.point(e);
    if (d.kind === 'move' && d.start) {
      const s = d.start;
      this.crop = {
        x: Math.min(1 - s.w, Math.max(0, s.x + x - d.ax)),
        y: Math.min(1 - s.h, Math.max(0, s.y + y - d.ay)),
        w: s.w,
        h: s.h,
      };
    } else {
      // New rectangle or corner resize: anchored at (ax, ay).
      let w = Math.abs(x - d.ax);
      let h = Math.abs(y - d.ay);
      if (this.aspect) h = this.lockedH(w);
      const nx = x < d.ax ? d.ax - w : d.ax;
      const ny = y < d.ay ? d.ay - h : d.ay;
      const cx = Math.max(0, nx), cy = Math.max(0, ny);
      w = Math.min(w, 1 - cx);
      h = this.aspect ? Math.min(this.lockedH(w), 1 - cy) : Math.min(h, 1 - cy);
      if (this.aspect) w = (h * this.aspect * this.cropFull!.height) / this.cropFull!.width;
      this.crop = { x: cx, y: cy, w, h };
    }
    this.draw();
  }

  private cropUp(): void {
    if (!this.drag) return;
    this.drag = null;
    const c = this.crop;
    // Tiny rectangles (a click) clear the crop.
    const keep = c && c.w > 0.04 && c.h > 0.04 ? c : null;
    this.crop = keep;
    this.draw();
    this.opts.onCrop?.(keep);
  }

  setHighlight(ids: number[]): void {
    this.highlight = new Set(ids);
    if (this.view !== 'bitmap') this.draw();
  }

  private draw(): void {
    if (this.cropMode && this.cropFull) return this.drawCrop();
    const img = this.img;
    const res = this.res;
    const W = res?.width ?? img?.width ?? 1;
    const H = res?.height ?? img?.height ?? 1;
    const scale = Math.min(2, 640 / Math.max(W, H));
    this.canvas.width = Math.round(W * scale);
    this.canvas.height = Math.round(H * scale);
    const g = this.canvas.getContext('2d')!;
    g.save();
    g.fillStyle = '#fff';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.view === 'bitmap' && res?.preview) {
      const pv = res.preview;
      const id = new ImageData(res.width, res.height);
      for (let i = 0; i < pv.length; i++) {
        const v = 255 - pv[i];
        id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = v;
        id.data[4 * i + 3] = 255;
      }
      const tmp = document.createElement('canvas');
      tmp.width = res.width;
      tmp.height = res.height;
      tmp.getContext('2d')!.putImageData(id, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(tmp, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      if (this.srcCanvas) {
        g.globalAlpha = this.view === 'overlay' ? 0.35 : 1;
        g.drawImage(this.srcCanvas, 0, 0, this.canvas.width, this.canvas.height);
        g.globalAlpha = 1;
      }
      if (this.view === 'overlay' && res) {
        g.scale(this.canvas.width / res.width, this.canvas.height / res.height);
        drawShapes(g, res.shapes, {
          ink: '#111',
          strokeWidth: Math.max(0.8, res.width / 400),
          highlight: this.highlight,
          highlightColor: '#2f6fed',
          dimOthers: this.highlight.size > 0,
        });
      }
    }
    g.restore();
    this.drawHist();
  }

  private drawCrop(): void {
    const f = this.cropFull!;
    const scale = Math.min(2, 640 / Math.max(f.width, f.height));
    const W = (this.canvas.width = Math.round(f.width * scale));
    const H = (this.canvas.height = Math.round(f.height * scale));
    const g = this.canvas.getContext('2d')!;
    g.drawImage(f, 0, 0, W, H);
    const c = this.crop;
    if (!c) return;
    const x = c.x * W, y = c.y * H, w = c.w * W, h = c.h * H;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, W, y);
    g.fillRect(0, y + h, W, H - y - h);
    g.fillRect(0, y, x, h);
    g.fillRect(x + w, y, W - x - w, h);
    g.strokeStyle = '#3b82f6';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = '#3b82f6';
    const k = Math.max(8, W / 60);
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(cx - k / 2, cy - k / 2, k, k);
  }

  private drawHist(): void {
    const h = this.histData;
    this.hist.hidden = !this.showHist || !h;
    if (!h || !this.showHist) return;
    const g = this.hist.getContext('2d')!;
    const W = this.hist.width, H = this.hist.height;
    g.clearRect(0, 0, W, H);
    const max = Math.max(...h.slice(1, 255), 1);
    g.fillStyle = 'rgba(235,235,235,0.55)';
    for (let i = 0; i < 256; i++) {
      const v = Math.min(1, h[i] / max);
      const bh = Math.max(0, v * (H - 2));
      g.fillRect(i, H - bh, 1, bh);
    }
    if (this.threshold >= 0) {
      g.fillStyle = '#3b82f6';
      g.fillRect(Math.round(this.threshold) - 1, 0, 2, H);
    }
  }
}
