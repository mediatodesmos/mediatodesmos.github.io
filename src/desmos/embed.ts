/**
 * Loads the Desmos API on demand and wraps a calculator instance.
 *
 * The expressions panel is OFF: with it on, Desmos typesets every huge list
 * with MathQuill, and 10k-item lists then take seconds. With it off,
 * setState returns in milliseconds and evaluation runs in Desmos' own worker.
 * Our own inspector replaces the panel.
 */

import type { DesmosState, Viewport } from './state';
import { HIGHLIGHT, INK } from './build';

export const DESMOS_API_VERSION = 'v1.12';
/** Desmos' public demo key, for development. Production builds should set VITE_DESMOS_API_KEY (get one at desmos.com/my-api). */
const DEMO_KEY = 'dcb31709b452b1cf9dc26972add0fda6';
export const DESMOS_API_KEY: string = (import.meta.env.VITE_DESMOS_API_KEY as string | undefined) || DEMO_KEY;
export const USING_DEMO_KEY = DESMOS_API_KEY === DEMO_KEY;

let loading: Promise<typeof Desmos> | null = null;

/** Give up on Desmos after this long and fall back to the built-in preview. */
const LOAD_TIMEOUT_MS = 8000;

/** `?nodesmos` in the URL simulates a blocked Desmos (for testing the fallback). */
const FORCE_FAIL = typeof location !== 'undefined' && /[?&]nodesmos\b/.test(location.search);

export function loadDesmos(): Promise<typeof Desmos> {
  if (FORCE_FAIL) return Promise.reject(new Error('Desmos is turned off for this page (?nodesmos).'));
  if (window.Desmos) return Promise.resolve(window.Desmos);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        loading = null;
        reject(new Error('The Desmos calculator is taking too long to load.'));
      }, LOAD_TIMEOUT_MS);
      const s = document.createElement('script');
      s.src = `https://www.desmos.com/api/${DESMOS_API_VERSION}/calculator.js?apiKey=${encodeURIComponent(DESMOS_API_KEY)}`;
      s.async = true;
      s.onload = () => {
        clearTimeout(timer);
        if (window.Desmos) resolve(window.Desmos);
        else reject(new Error('The Desmos calculator loaded but did not start.'));
      };
      s.onerror = () => {
        clearTimeout(timer);
        loading = null;
        s.remove();
        reject(new Error('Could not load the Desmos calculator. Check your connection, or allow desmos.com in your ad blocker.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Invert a #rrggbb colour (used so highlights stay blue when the preview is inverted). */
export function invertHex(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return '#' + (0xffffff ^ v).toString(16).padStart(6, '0');
}

export interface GraphViewOptions {
  dark: boolean;
  /** Allow pan and zoom (default true). */
  interactive?: boolean;
}

export class GraphView {
  readonly calc: Desmos.Calculator;
  private state: DesmosState | null = null;
  private highlighted: string[] = [];
  private soloIds: string[] | null = null;
  private resizeObs: ResizeObserver;
  private axes = false;
  /** Base style per expression id (to restore after highlight). */
  private base = new Map<string, { color: string; lineWidth?: string }>();

  private constructor(private container: HTMLElement, calc: Desmos.Calculator, opts: GraphViewOptions) {
    this.calc = calc;
    this.resizeObs = new ResizeObserver(() => {
      this.calc.resize();
    });
    this.resizeObs.observe(container);
    container.classList.toggle('is-dark', opts.dark);
    if (import.meta.env.DEV) (window as unknown as { __m2dGraph?: GraphView }).__m2dGraph = this;
  }

  static async create(container: HTMLElement, opts: GraphViewOptions): Promise<GraphView> {
    const D = await loadDesmos();
    const calc = D.GraphingCalculator(container, {
      expressions: false,
      settingsMenu: false,
      keypad: false,
      border: false,
      zoomButtons: opts.interactive !== false,
      lockViewport: opts.interactive === false,
      pointsOfInterest: false,
      trace: false,
      showGrid: false,
      showXAxis: false,
      showYAxis: false,
    });
    return new GraphView(container, calc, opts);
  }

  /** Load a full graph state and fit the view. */
  load(state: DesmosState, opts: { keepView?: boolean } = {}): void {
    const keep = opts.keepView ? this.calc.graphpaperBounds.mathCoordinates : null;
    this.state = state;
    this.highlighted = [];
    this.soloIds = null;
    this.base.clear();
    for (const item of state.expressions.list) {
      if (item.type === 'expression') this.base.set(item.id, { color: item.color ?? INK, lineWidth: item.lineWidth });
    }
    // setState mutates nothing we keep, but pass a copy to be safe.
    this.calc.setState(structuredClone(state));
    if (keep) this.calc.setMathBounds({ left: keep.left, right: keep.right, bottom: keep.bottom, top: keep.top });
    else this.fit(state.graph.viewport);
    if (this.axes) this.setAxes(true);
  }

  /** Where an image of w x h px (Desmos x 0..w, y 0..h) sits in the container, in CSS px. */
  imageRect(w: number, h: number): { left: number; top: number; width: number; height: number } {
    const b = this.calc.graphpaperBounds.mathCoordinates;
    const r = this.container.getBoundingClientRect();
    const sx = r.width / (b.right - b.left), sy = r.height / (b.top - b.bottom);
    return { left: (0 - b.left) * sx, top: (b.top - h) * sy, width: w * sx, height: h * sy };
  }

  /** Run cb whenever the visible region changes (pan, zoom, resize). */
  onViewChange(cb: () => void): () => void {
    this.calc.observe('graphpaperBounds', cb);
    return () => this.calc.unobserve('graphpaperBounds');
  }

  /** Show Desmos' grid, axes and numbers in the preview (the exported state is untouched). */
  setAxes(on: boolean): void {
    this.axes = on;
    this.calc.updateSettings({ showGrid: on, showXAxis: on, showYAxis: on, xAxisNumbers: on, yAxisNumbers: on });
  }

  get current(): DesmosState | null {
    return this.state;
  }

  /**
   * Dark preview: a CSS filter (invert 93% + hue-rotate 180deg) maps Desmos'
   * white paper to the page background #121212 and black ink to #ededed,
   * while hues (the blue highlight) survive. Exports are untouched.
   */
  setDark(dark: boolean): void {
    this.container.classList.toggle('is-dark', dark);
  }

  /** Fit a viewport into the container without distorting the aspect ratio. */
  fit(vp?: Viewport): void {
    const v = vp ?? this.state?.graph.viewport;
    if (!v) return;
    const rect = this.container.getBoundingClientRect();
    const cw = Math.max(1, rect.width), ch = Math.max(1, rect.height);
    let { xmin, xmax, ymin, ymax } = v;
    const vw = xmax - xmin, vh = ymax - ymin;
    if (vw / vh > cw / ch) {
      const nh = (vw * ch) / cw;
      const cy = (ymin + ymax) / 2;
      ymin = cy - nh / 2;
      ymax = cy + nh / 2;
    } else {
      const nw = (vh * cw) / ch;
      const cx = (xmin + xmax) / 2;
      xmin = cx - nw / 2;
      xmax = cx + nw / 2;
    }
    this.calc.setMathBounds({ left: xmin, right: xmax, bottom: ymin, top: ymax });
  }

  /** Zoom to an image-space box (pixels, y down) of an image of height H. */
  zoomTo(b: [number, number, number, number], H: number, pad = 0.25): void {
    const w = b[2] - b[0], h = b[3] - b[1];
    const px = Math.max(w, h) * pad + 4;
    this.fit({ xmin: b[0] - px, xmax: b[2] + px, ymin: H - b[3] - px, ymax: H - b[1] + px });
  }

  /** Colour the given expressions in the accent colour (and thicken strokes). */
  highlight(ids: string[]): void {
    const color = HIGHLIGHT;
    const updates: Record<string, unknown>[] = [];
    for (const id of this.highlighted) {
      if (ids.includes(id)) continue;
      const b = this.base.get(id);
      if (b) updates.push({ id, color: b.color, ...(b.lineWidth ? { lineWidth: b.lineWidth } : {}) });
    }
    for (const id of ids) {
      const b = this.base.get(id);
      if (!b) continue;
      const lw = b.lineWidth ? String(Math.max(3, parseFloat(b.lineWidth) * 1.8)) : undefined;
      updates.push({ id, color, ...(lw ? { lineWidth: lw } : {}) });
    }
    this.highlighted = ids.filter((id) => this.base.has(id));
    if (updates.length) this.calc.setExpressions(updates);
  }

  /** Show only these drawable expressions (null = show all). */
  solo(ids: string[] | null): void {
    if (!this.state) return;
    const updates: Record<string, unknown>[] = [];
    for (const item of this.state.expressions.list) {
      if (item.type !== 'expression') continue;
      if (item.folderId) continue; // data lists never draw
      if (item.id === 'F') continue;
      const hidden = ids ? !ids.includes(item.id) : !!item.hidden;
      updates.push({ id: item.id, hidden });
    }
    this.soloIds = ids;
    this.calc.setExpressions(updates);
  }

  get soloed(): string[] | null {
    return this.soloIds;
  }

  setFrame(f: number): void {
    this.calc.setExpression({ id: 'F', latex: `F=${f}` });
  }

  /** Replace a few expressions in place (live webcam updates). */
  patch(exprs: Record<string, unknown>[]): void {
    this.calc.setExpressions(exprs);
  }

  errors(): string[] {
    const out: string[] = [];
    for (const [id, a] of Object.entries(this.calc.expressionAnalysis)) {
      if (a.isError && a.errorMessage) out.push(`${id}: ${a.errorMessage}`);
    }
    return out;
  }

  screenshot(width: number, height: number): Promise<string> {
    return new Promise((resolve) => {
      this.calc.asyncScreenshot(
        { width, height, targetPixelRatio: 1, mode: 'contain', mathBounds: this.state ? toBounds(this.state.graph.viewport) : undefined },
        resolve,
      );
    });
  }

  destroy(): void {
    this.resizeObs.disconnect();
    this.calc.destroy();
  }
}

function toBounds(v: Viewport): Desmos.MathBounds {
  return { left: v.xmin, right: v.xmax, bottom: v.ymin, top: v.ymax };
}
