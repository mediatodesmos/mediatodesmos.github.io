/**
 * Built-in graph preview, drawn by Media to Desmos itself. Used when Desmos
 * cannot load (blocked script, rejected API key, offline) and for smooth
 * video playback. Pan with drag, zoom with the wheel, double-click to fit.
 * Optional axes, grid and numbered ticks in Desmos' coordinates
 * (x = image px from the left, y = image px from the bottom).
 */

import type { TraceResult } from '../pipeline/types';
import { drawShapes } from './shapes';

export interface PreviewColors {
  paper: string;
  ink: string;
  grid: string;
  axis: string;
  label: string;
  highlight: string;
}

const DARK: PreviewColors = { paper: '#121212', ink: '#ededed', grid: 'rgba(235,235,235,0.08)', axis: 'rgba(235,235,235,0.55)', label: 'rgba(235,235,235,0.6)', highlight: '#5f96ff' };
const LIGHT: PreviewColors = { paper: '#ffffff', ink: '#000000', grid: 'rgba(0,0,0,0.08)', axis: 'rgba(0,0,0,0.6)', label: 'rgba(0,0,0,0.6)', highlight: '#2f6fed' };

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export class PreviewView {
  private res: TraceResult | null = null;
  private dark = true;
  private axes = false;
  private stroke = 2;
  private highlight = new Set<number>();
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private fitted = false;
  private drag: { x: number; y: number; ox: number; oy: number } | null = null;
  private ro: ResizeObserver;
  private disposers: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => canvas.removeEventListener(type, fn as EventListener));
    };
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const dpr = this.dpr();
        const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
        const k = Math.exp(-e.deltaY * 0.0015);
        this.ox = mx - (mx - this.ox) * k;
        this.oy = my - (my - this.oy) * k;
        this.scale *= k;
        this.draw();
      },
      { passive: false },
    );
    on('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy };
    });
    on('pointermove', (e) => {
      if (!this.drag) return;
      const dpr = this.dpr();
      this.ox = this.drag.ox + (e.clientX - this.drag.x) * dpr;
      this.oy = this.drag.oy + (e.clientY - this.drag.y) * dpr;
      this.draw();
    });
    on('pointerup', () => (this.drag = null));
    on('dblclick', () => this.fit());
  }

  private dpr(): number {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  setResult(res: TraceResult | null, opts: { refit?: boolean } = {}): void {
    const sizeChanged = !this.res || !res || this.res.width !== res.width || this.res.height !== res.height;
    this.res = res;
    if (opts.refit || sizeChanged || !this.fitted) this.fitted = false;
    this.draw();
  }

  setDark(d: boolean): void {
    this.dark = d;
    this.draw();
  }

  setAxes(a: boolean): void {
    this.axes = a;
    this.draw();
  }

  setStroke(px: number): void {
    this.stroke = px;
    this.draw();
  }

  setHighlight(ids: number[]): void {
    this.highlight = new Set(ids);
    this.draw();
  }

  fit(): void {
    this.fitted = false;
    this.draw();
  }

  /** Where the image currently sits on screen, in CSS pixels relative to the canvas. */
  imageRect(): { left: number; top: number; width: number; height: number } | null {
    if (!this.res) return null;
    const dpr = this.dpr();
    return { left: this.ox / dpr, top: this.oy / dpr, width: (this.res.width * this.scale) / dpr, height: (this.res.height * this.scale) / dpr };
  }

  /** Called after every redraw (pan, zoom, resize). */
  onDraw: (() => void) | null = null;

  /** Zoom to an image-space box (px, y down). */
  zoomTo(b: [number, number, number, number]): void {
    const c = this.canvas;
    const pad = Math.max(b[2] - b[0], b[3] - b[1]) * 0.25 + 4;
    const w = b[2] - b[0] + 2 * pad, h = b[3] - b[1] + 2 * pad;
    this.scale = Math.min(c.width / w, c.height / h);
    this.ox = (c.width - (b[0] + b[2]) * this.scale) / 2;
    this.oy = (c.height - (b[1] + b[3]) * this.scale) / 2;
    this.fitted = true;
    this.draw();
  }

  draw(): void {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = this.dpr();
    const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
    if (c.width !== W || c.height !== H) {
      // Keep the view centred through resizes.
      if (this.fitted && c.width && c.height) {
        this.ox += (W - c.width) / 2;
        this.oy += (H - c.height) / 2;
      }
      c.width = W;
      c.height = H;
    }
    const col = this.dark ? DARK : LIGHT;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = col.paper;
    g.fillRect(0, 0, W, H);
    const res = this.res;
    if (!res) return;
    if (!this.fitted) {
      this.scale = Math.min(W / res.width, H / res.height) * 0.92;
      this.ox = (W - res.width * this.scale) / 2;
      this.oy = (H - res.height * this.scale) / 2;
      this.fitted = true;
    }
    if (this.axes) this.drawAxes(g, res, col, W, H, dpr);
    g.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    drawShapes(g, res.shapes, {
      ink: col.ink,
      strokeWidth: (this.stroke * dpr) / this.scale,
      highlight: this.highlight,
      highlightColor: col.highlight,
      dimOthers: this.highlight.size > 0,
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.onDraw?.();
  }

  private drawAxes(g: CanvasRenderingContext2D, res: TraceResult, col: PreviewColors, W: number, H: number, dpr: number): void {
    const s = this.scale;
    // Desmos coords: X = px, Y = res.height - py. Screen = (X*s + ox, (res.height - Y)*s + oy).
    const toSX = (X: number) => X * s + this.ox;
    const toSY = (Y: number) => (res.height - Y) * s + this.oy;
    const xMin = -this.ox / s, xMax = (W - this.ox) / s;
    const yMin = res.height - (H - this.oy) / s, yMax = res.height + this.oy / s;
    const step = niceStep(90 * dpr / s);
    g.lineWidth = 1;
    g.font = `${11 * dpr}px "Geist Mono", ui-monospace, monospace`;
    g.textBaseline = 'top';
    g.strokeStyle = col.grid;
    g.beginPath();
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      g.moveTo(Math.round(toSX(x)) + 0.5, 0);
      g.lineTo(Math.round(toSX(x)) + 0.5, H);
    }
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      g.moveTo(0, Math.round(toSY(y)) + 0.5);
      g.lineTo(W, Math.round(toSY(y)) + 0.5);
    }
    g.stroke();
    // Axes, pinned to the edge when off screen.
    const ax = Math.min(W - 1, Math.max(0, toSX(0)));
    const ay = Math.min(H - 1, Math.max(0, toSY(0)));
    g.strokeStyle = col.axis;
    g.lineWidth = 1.25 * dpr;
    g.beginPath();
    g.moveTo(0, ay);
    g.lineTo(W, ay);
    g.moveTo(ax, 0);
    g.lineTo(ax, H);
    g.stroke();
    g.fillStyle = col.label;
    const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000));
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      if (Math.abs(x) < 1e-9) continue;
      g.textAlign = 'center';
      g.fillText(fmt(x), toSX(x), Math.min(H - 14 * dpr, ay + 4 * dpr));
    }
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      if (Math.abs(y) < 1e-9) continue;
      g.textAlign = 'right';
      g.fillText(fmt(y), Math.max(30 * dpr, ax - 5 * dpr), toSY(y) - 6 * dpr);
    }
  }

  destroy(): void {
    this.ro.disconnect();
    for (const d of this.disposers) d();
  }
}
