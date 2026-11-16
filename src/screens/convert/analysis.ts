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
}

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
    this.el = el(
      'div',
      { class: 'an' },
      el('div', { class: 'an-head' }, el('h3', { class: 'overline' }, 'Source analysis'), this.tray.el),
      el('div', { class: 'an-frame' }, this.canvas),
      this.hist,
      this.info,
    );
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

  setHighlight(ids: number[]): void {
    this.highlight = new Set(ids);
    if (this.view !== 'bitmap') this.draw();
  }

  private draw(): void {
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
