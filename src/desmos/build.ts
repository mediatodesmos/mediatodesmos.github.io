/**
 * Traced shapes -> Desmos graph state, plus an "inspector entry" for every
 * expression that explains in plain English what it draws.
 */

import type { BBox, FourierShape, RegionShape, Shape, StrokeShape, TraceResult } from '../pipeline/types';
import { bezierLatex, flipY, fourierLatex, list, num, polygonLatex } from './latex';
import { emptyState, imageViewport, stateWeight, type DesmosExpression, type DesmosItem, type DesmosState } from './state';
import { BEZIER_FN, BEZIER_FN_ID, FOURIER_FN, FOURIER_FN_ID, LIST_CAP, packedList, pName, pointFn, rangeLatex, strokePoints, xName, yName } from './packed';

export const INK = '#000000';
export const HIGHLIGHT = '#2f6fed';

export type EntryKind = 'stroke' | 'region' | 'fourier' | 'slider' | 'ticker' | 'draw' | 'data' | 'note';

export interface InspectorEntry {
  /** Desmos expression id. */
  id: string;
  kind: EntryKind;
  title: string;
  summary: string;
  /** Plain-English explanation of the formula. */
  explain: string;
  /** Concrete worked example (first segment, first point...). */
  example?: string;
  latex: string;
  /** Image-space bounding box for overlay highlighting (pixels, y down). */
  bbox?: BBox;
  shapeId?: number;
  /** Extra ids that belong to this entry (e.g. data lists of a chunk). */
  related?: string[];
  /** A self-contained version of the equation (works without the graph's data lists). */
  standalone?: string;
}

export interface BuildOptions {
  strokeWidth: number;
  /** Add a text note above every shape (makes the Desmos list self-explanatory). */
  notes: boolean;
  /** Name shown in the header note. */
  name?: string;
  /** Fourier mode: add a rotating-circle animation for the largest shape. */
  epicycles?: boolean;
  /** Decimal places for coordinates (default: 0 for images 500 px or larger, else 1). */
  decimals?: number;
  /** Outline: fold strokes shorter than this (px) into one "small details" expression. 0 = off. */
  mergeBelow?: number;
  /** Outline: compact shared-function encoding (default true). */
  packed?: boolean;
}

export interface BuiltGraph {
  state: DesmosState;
  entries: InspectorEntry[];
  width: number;
  height: number;
  bytes: number;
  expressions: number;
}

const MODE_LABEL: Record<string, string> = {
  outline: 'outline (cubic Bezier curves)',
  fill: 'fill (polygons)',
  fourier: 'Fourier series',
};

export function buildImageGraph(res: TraceResult, opts: BuildOptions): BuiltGraph {
  const { width: W, height: H } = res;
  const state = emptyState(imageViewport(W, H));
  const items: DesmosItem[] = [];
  const entries: InspectorEntry[] = [];

  items.push({
    type: 'text',
    id: 'm2d-head',
    text:
      `${opts.name ? opts.name + ' | ' : ''}Made with Media to Desmos (mediatodesmos.github.io). ` +
      `Style: ${MODE_LABEL[res.mode]}. ${res.shapes.length} shapes traced from a ${W}x${H} px image.`,
  });

  const decimals = opts.decimals ?? (Math.max(W, H) >= 500 ? 0 : 1);

  if (res.mode === 'outline' && opts.packed !== false) {
    addPackedStrokes(res, opts, decimals, items, entries);
  } else {
    const fourier = res.mode === 'fourier' && opts.packed !== false;
    if (fourier) {
      items.push({ type: 'folder', id: 'm2d-fn', title: 'The Fourier series function', collapsed: true });
      items.push({ type: 'expression', id: FOURIER_FN_ID, folderId: 'm2d-fn', latex: FOURIER_FN });
    }
    for (const sh of res.shapes) {
      const expr = shapeExpression(sh, H, opts.strokeWidth, decimals);
      if (fourier && sh.kind === 'fourier') {
        const c = fourierColumns(sh, H);
        const standalone = expr.latex;
        expr.latex = `Z\\left(t,${list(c.k, 0)},${list(c.re, decimals + 1)},${list(c.im, decimals + 1)}\\right)`;
        const entry = describeShape(sh, expr.latex, W, H);
        entry.standalone = standalone;
        entry.explain +=
          ' Z(t,k,a,b) is defined once for the whole graph: its x is total(a cos(2 pi k t) - b sin(2 pi k t)) and its y is total(a sin(2 pi k t) + b cos(2 pi k t)).';
        if (opts.notes) items.push({ type: 'text', id: `n${sh.id}`, text: `${entry.title}: ${entry.summary}` });
        items.push(expr);
        entries.push(entry);
        continue;
      }
      const entry = describeShape(sh, expr.latex, W, H);
      if (opts.notes) items.push({ type: 'text', id: `n${sh.id}`, text: `${entry.title}: ${entry.summary}` });
      items.push(expr);
      entries.push(entry);
    }
  }

  if (opts.epicycles && res.mode === 'fourier') {
    const biggest = res.shapes
      .filter((s): s is FourierShape => s.kind === 'fourier' && s.freq.length >= 3)
      .sort((a, b) => b.length - a.length)[0];
    if (biggest) addEpicycles(biggest, H, items, entries, state);
  }

  state.expressions.list = items;
  const w = stateWeight(state);
  return { state, entries, width: W, height: H, bytes: w.bytes, expressions: w.expressions };
}

/** Outline shapes in the compact encoding (see packed.ts). */
function addPackedStrokes(res: TraceResult, opts: BuildOptions, decimals: number, items: DesmosItem[], entries: InspectorEntry[]): void {
  const { width: W, height: H } = res;
  const strokes = res.shapes.filter((s): s is StrokeShape => s.kind === 'stroke' && s.segs.length >= 8);
  interface Chunk {
    xs: number[];
    ys: number[];
  }
  const chunks: Chunk[] = [];
  const placed: { sh: StrokeShape; c: number; a: number; b: number }[] = [];
  let cur: Chunk | null = null;
  for (const sh of strokes) {
    const { xs, ys } = strokePoints(sh.segs, H);
    if (!cur || cur.xs.length + xs.length > LIST_CAP) {
      cur = { xs: [], ys: [] };
      chunks.push(cur);
    }
    const a = cur.xs.length + 1;
    cur.xs.push(...xs);
    cur.ys.push(...ys);
    placed.push({ sh, c: chunks.length, a, b: a + 3 * (sh.segs.length / 8 - 1) });
  }

  items.push({ type: 'folder', id: 'm2d-curves', title: 'Curve data: control points and the Bezier function', collapsed: true });
  items.push({ type: 'expression', id: BEZIER_FN_ID, folderId: 'm2d-curves', latex: BEZIER_FN });
  chunks.forEach((ch, i) => {
    const c = i + 1;
    items.push({ type: 'expression', id: `cx${c}`, folderId: 'm2d-curves', latex: `${xName(c)}=${packedList(ch.xs, decimals)}` });
    items.push({ type: 'expression', id: `cy${c}`, folderId: 'm2d-curves', latex: `${yName(c)}=${packedList(ch.ys, decimals)}` });
    items.push({ type: 'expression', id: `cp${c}`, folderId: 'm2d-curves', latex: pointFn(c) });
  });

  const mergeBelow = opts.mergeBelow ?? 0;
  // Small strokes are merged per chunk and per colour (In Color keeps each colour separate).
  const small = new Map<string, { c: number; color: string; starts: number[] }>();
  let smallCount = 0;
  let smallSegs = 0;
  const style = { color: INK, lineWidth: String(opts.strokeWidth), lineOpacity: '1' };
  for (const p of placed) {
    if (mergeBelow > 0 && p.sh.length < mergeBelow) {
      const color = p.sh.color ?? INK;
      const key = `${p.c}|${color}`;
      const group = small.get(key) ?? { c: p.c, color, starts: [] };
      for (let k = p.a; k <= p.b; k += 3) group.starts.push(k);
      small.set(key, group);
      smallCount++;
      smallSegs += p.sh.segs.length / 8;
      continue;
    }
    const latex = `${pName(p.c)}\\left(t,${rangeLatex(p.a, p.b)}\\right)`;
    const entry = describeShape(p.sh, latex, W, H, { chunk: p.c, a: p.a, b: p.b });
    entry.standalone = strokeLatex(p.sh, H);
    if (opts.notes) items.push({ type: 'text', id: `n${p.sh.id}`, text: `${entry.title}: ${entry.summary}` });
    items.push({ type: 'expression', id: `s${p.sh.id}`, latex, ...style, color: p.sh.color ?? INK });
    entries.push(entry);
  }
  let g = 0;
  for (const { c, color, starts } of small.values()) {
    g++;
    const listId = `sm${g}`;
    const mName = small.size > 1 ? `M_{${g}}` : `M_{${c}}`;
    items.push({ type: 'expression', id: `smk${g}`, folderId: 'm2d-curves', latex: `${mName}=${packedList(starts, 0)}` });
    const latex = `${pName(c)}\\left(t,${mName}\\right)`;
    items.push({ type: 'expression', id: listId, latex, ...style, color });
    entries.push({
      id: listId,
      kind: 'stroke',
      title: small.size > 1 ? `Small details (group ${g})` : 'Small details',
      summary: `${smallCount.toLocaleString('en-US')} short strokes merged into one equation (${smallSegs.toLocaleString('en-US')} Bezier segments)`,
      explain:
        `Short strokes (under ${mergeBelow} px) share a single equation so Desmos has fewer expressions to manage. ` +
        `M_${c} lists where each of their segments starts in the X_${c} and Y_${c} point lists, and P_${c} draws a Bezier segment from each start.`,
      latex,
    });
  }
}

/**
 * Rotating-circle ("epicycle") animation for one Fourier shape: the partial
 * sums of the series give the circle centres, each term's magnitude its
 * radius, and a ticker sweeps T from 0 to 1 so the chain traces the outline.
 */
function addEpicycles(sh: FourierShape, H: number, items: DesmosItem[], entries: InspectorEntry[], state: DesmosState): void {
  const c = fourierColumns(sh, H);
  const N = c.k.length;
  items.push({ type: 'folder', id: 'm2d-epi', title: `Rotating circles for Fourier curve ${sh.id}`, collapsed: true });
  items.push({ type: 'expression', id: 'epiK', folderId: 'm2d-epi', latex: `K_{e}=${list(c.k, 0)}` });
  items.push({ type: 'expression', id: 'epiA', folderId: 'm2d-epi', latex: `A_{e}=${list(c.re, 3)}` });
  items.push({ type: 'expression', id: 'epiB', folderId: 'm2d-epi', latex: `B_{e}=${list(c.im, 3)}` });
  const term = (xy: 'x' | 'y') =>
    xy === 'x'
      ? `A_{e}\\left[n\\right]\\cos\\left(2\\pi K_{e}\\left[n\\right]T\\right)-B_{e}\\left[n\\right]\\sin\\left(2\\pi K_{e}\\left[n\\right]T\\right)`
      : `A_{e}\\left[n\\right]\\sin\\left(2\\pi K_{e}\\left[n\\right]T\\right)+B_{e}\\left[n\\right]\\cos\\left(2\\pi K_{e}\\left[n\\right]T\\right)`;
  const partial = (xy: 'x' | 'y') => `\\left[\\sum_{n=1}^{j}\\left(${term(xy)}\\right)\\operatorname{for}j=\\left[1...${N}\\right]\\right]`;
  items.push({ type: 'expression', id: 'epiSx', folderId: 'm2d-epi', latex: `S_{x}=${partial('x')}` });
  items.push({ type: 'expression', id: 'epiSy', folderId: 'm2d-epi', latex: `S_{y}=${partial('y')}` });
  items.push({ type: 'expression', id: 'epiR', folderId: 'm2d-epi', latex: `R_{e}=\\sqrt{A_{e}^{2}+B_{e}^{2}}` });
  items.push({
    type: 'expression',
    id: 'epiT',
    color: INK,
    latex: 'T=0',
    slider: { hardMin: true, hardMax: true, min: '0', max: '1' },
  });
  const circles = `\\left(x-S_{x}\\left[1...${N - 1}\\right]\\right)^{2}+\\left(y-S_{y}\\left[1...${N - 1}\\right]\\right)^{2}=R_{e}\\left[2...${N}\\right]^{2}`;
  items.push({ type: 'expression', id: 'epiC', color: '#6b6b6b', latex: circles, lineWidth: '1', lineOpacity: '0.55' });
  items.push({ type: 'expression', id: 'epiArm', color: '#6b6b6b', latex: '\\left(S_{x},S_{y}\\right)', lines: true, points: false, lineWidth: '1.5', lineOpacity: '0.8' });
  items.push({ type: 'expression', id: 'epiTip', color: HIGHLIGHT, latex: `\\left(S_{x}\\left[${N}\\right],S_{y}\\left[${N}\\right]\\right)`, points: true });
  state.expressions.ticker = {
    handlerLatex: 'T\\to\\operatorname{mod}\\left(T+0.0025,1\\right)',
    minStepLatex: '16',
    open: true,
    playing: false,
  };
  entries.push({
    id: 'epiC',
    kind: 'fourier',
    title: 'Rotating circles',
    summary: `${N - 1} circles chained tip to tail, tracing Fourier curve ${sh.id}`,
    explain:
      `The animation version of the Fourier series. S_x and S_y are running totals of the terms (the j-th item adds the first j terms), so they give ` +
      `the centre of each circle. Each circle's radius is the size of its term, R = sqrt(A^2 + B^2). As T goes from 0 to 1, every circle turns ` +
      `K times, and the last tip retraces the outline. Press play on the ticker to animate it.`,
    latex: circles,
    shapeId: sh.id,
    bbox: sh.bbox,
  });
  entries.push({
    id: 'epiT',
    kind: 'slider',
    title: 'Animation time T',
    summary: 'Ticker: T -> mod(T + 0.0025, 1) every 16 ms (one loop is about 6.4 s)',
    explain: 'T is the position along the curve, from 0 to 1. The ticker nudges it forward and wraps it back to 0 at the end of each loop.',
    latex: 'T=0',
  });
}

export function shapeExpression(sh: Shape, H: number, strokeWidth: number, decimals = 1): DesmosExpression {
  const id = `s${sh.id}`;
  switch (sh.kind) {
    case 'stroke':
      return {
        type: 'expression',
        id,
        color: sh.color ?? INK,
        latex: strokeLatex(sh, H, decimals),
        lineWidth: String(strokeWidth),
        lineOpacity: '1',
        parametricDomain: { min: '0', max: '1' },
      };
    case 'region':
      return {
        type: 'expression',
        id,
        color: sh.color ?? INK,
        latex: regionLatex(sh, H, decimals),
        fillOpacity: '1',
        lines: false,
        lineOpacity: '1',
      };
    case 'fourier':
      return {
        type: 'expression',
        id,
        color: sh.color ?? INK,
        latex: fourierShapeLatex(sh, H, decimals + 1),
        lineWidth: String(strokeWidth),
        lineOpacity: '1',
        parametricDomain: { min: '0', max: '1' },
      };
  }
}

/** Control-point columns of a stroke, flipped into Desmos coordinates. */
export function strokeColumns(segs: number[], H: number): number[][] {
  const cols: number[][] = [[], [], [], [], [], [], [], []];
  for (let o = 0; o < segs.length; o += 8) {
    cols[0].push(segs[o]);
    cols[1].push(segs[o + 2]);
    cols[2].push(segs[o + 4]);
    cols[3].push(segs[o + 6]);
    cols[4].push(flipY(segs[o + 1], H));
    cols[5].push(flipY(segs[o + 3], H));
    cols[6].push(flipY(segs[o + 5], H));
    cols[7].push(flipY(segs[o + 7], H));
  }
  return cols;
}

export function strokeLatex(sh: StrokeShape, H: number, decimals = 1): string {
  const c = strokeColumns(sh.segs, H).map((col) => list(col, decimals));
  return bezierLatex(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
}

/**
 * One polygon path for a set of rings (outer boundaries and holes) in
 * Desmos coordinates. Rings are joined to an anchor by "bridges" walked out
 * and back, which add zero area. Outer rings run counter-clockwise and holes
 * clockwise, so the nonzero fill rule cuts the holes out.
 */
export function bridgedPath(rings: { pts: number[]; hole: boolean }[]): number[] {
  const out: number[] = [];
  if (rings.length === 0) return out;
  let ax = 0, ay = 0;
  rings.forEach((r, idx) => {
    const pts = orient(r.pts, !r.hole);
    const m = pts.length / 2;
    if (m < 3) return;
    if (idx === 0 || out.length === 0) {
      ax = pts[0];
      ay = pts[1];
      for (let i = 0; i < m; i++) out.push(pts[2 * i], pts[2 * i + 1]);
      out.push(ax, ay);
      return;
    }
    // Start this ring at its vertex nearest the anchor.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < m; i++) {
      const d = (pts[2 * i] - ax) ** 2 + (pts[2 * i + 1] - ay) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    for (let k = 0; k <= m; k++) {
      const i = (best + k) % m;
      out.push(pts[2 * i], pts[2 * i + 1]);
    }
    out.push(ax, ay);
  });
  return out;
}

/** Return the ring with counter-clockwise (ccw=true) or clockwise orientation, y up. */
function orient(pts: number[], ccw: boolean): number[] {
  let a = 0;
  const m = pts.length / 2;
  for (let i = 0, j = m - 1; i < m; j = i++) a += pts[2 * j] * pts[2 * i + 1] - pts[2 * i] * pts[2 * j + 1];
  if (a > 0 === ccw) return pts;
  const out: number[] = [];
  for (let i = m - 1; i >= 0; i--) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** Rings of a region in Desmos coordinates. */
export function regionRings(sh: RegionShape, H: number): { pts: number[]; hole: boolean }[] {
  return sh.rings.map((r, i) => {
    const pts: number[] = [];
    for (let k = 0; k < r.length; k += 2) pts.push(r[k], flipY(r[k + 1], H));
    return { pts, hole: i > 0 };
  });
}

export function regionLatex(sh: RegionShape, H: number, decimals = 1): string {
  const path = bridgedPath(regionRings(sh, H));
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < path.length; i += 2) {
    xs.push(path[i]);
    ys.push(path[i + 1]);
  }
  return polygonLatex(list(xs, decimals), list(ys, decimals));
}

/** Fourier coefficients in Desmos coordinates (y flipped: z' = conj(z) + iH). */
export function fourierColumns(sh: FourierShape, H: number): { k: number[]; re: number[]; im: number[] } {
  const k = sh.freq.map((f) => (f === 0 ? 0 : -f));
  const re = sh.re.slice();
  const im = sh.im.map((v) => -v);
  const z = sh.freq.indexOf(0);
  if (z >= 0) im[z] += H;
  else {
    k.push(0);
    re.push(0);
    im.push(H);
  }
  return { k, re, im };
}

export function fourierShapeLatex(sh: FourierShape, H: number, decimals = 2): string {
  const c = fourierColumns(sh, H);
  return fourierLatex(list(c.k, 0), list(c.re, decimals), list(c.im, decimals));
}

// ---------------------------------------------------------------- descriptions

export function positionWords(b: BBox, W: number, H: number): string {
  const cx = (b[0] + b[2]) / 2 / W;
  const cy = (b[1] + b[3]) / 2 / H;
  const v = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : '';
  const h = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : '';
  if (!v && !h) return 'centre';
  if (!v) return h === 'left' ? 'left side' : 'right side';
  if (!h) return v;
  return `${v}-${h}`;
}

function sizeWords(b: BBox, W: number, H: number): string {
  const f = Math.max((b[2] - b[0]) / W, (b[3] - b[1]) / H);
  if (f > 0.6) return 'large';
  if (f > 0.25) return 'medium';
  if (f > 0.08) return 'small';
  return 'tiny';
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const px = (v: number) => `(${num(v)}, `;

export function describeShape(
  sh: Shape,
  latex: string,
  W: number,
  H: number,
  packed?: { chunk: number; a: number; b: number },
): InspectorEntry {
  const where = positionWords(sh.bbox, W, H);
  const size = sizeWords(sh.bbox, W, H);
  const id = `s${sh.id}`;
  if (sh.kind === 'stroke') {
    const n = sh.segs.length / 8;
    const s = sh.segs;
    const ex =
      `Segment 1 starts at ${px(s[0])}${num(flipY(s[1], H))}) and ends at ${px(s[6])}${num(flipY(s[7], H))}). ` +
      `It is pulled toward the control points ${px(s[2])}${num(flipY(s[3], H))}) and ${px(s[4])}${num(flipY(s[5], H))}).`;
    const c = packed?.chunk;
    const explain = packed
      ? `A parametric curve made of ${plural(n, 'cubic Bezier segment')}. The list ${n > 1 ? `[${packed.a}, ${packed.a + 3}, ..., ${packed.b}]` : `[${packed.a}]`} ` +
        `gives where each segment starts in the point lists X_${c} and Y_${c} (neighbouring segments share their end points, so starts are 3 apart). ` +
        `P_${c}(t,k) takes the 4 points from position k onward and blends them with B(t,a,b,c,d) = (1-t)^3 a + 3t(1-t)^2 b + 3t^2(1-t) c + t^3 d. ` +
        `As t runs from 0 to 1 each segment travels from its start point to its end point, pulled toward its two middle control points. ` +
        `Desmos applies P_${c} to every start at once, so this one short equation draws the whole ${sh.closed ? 'loop' : 'line'}.`
      : `A parametric curve. As t runs from 0 to 1, each segment travels from its start point (the first list) to its end point ` +
        `(the fourth list) while being pulled toward two control points (the middle lists). The four weights ` +
        `(1-t)^3, 3t(1-t)^2, 3t^2(1-t) and t^3 always add up to 1. Desmos applies the formula to every position in the lists ` +
        `at once, so this single equation draws all ${plural(n, 'segment')} of the ${sh.closed ? 'loop' : 'line'}.`;
    return {
      id,
      kind: 'stroke',
      shapeId: sh.id,
      title: `Curve ${sh.id}`,
      summary: `${plural(n, 'Bezier segment')}, ${sh.closed ? 'closed loop' : 'open line'}, ${Math.round(sh.length)} px long, ${size}, ${where}`,
      explain,
      example: ex,
      latex,
      bbox: sh.bbox,
    };
  }
  if (sh.kind === 'region') {
    const verts = sh.rings.reduce((a, r) => a + r.length / 2, 0);
    const holes = sh.rings.length - 1;
    const pct = (Math.abs(sh.area) / (W * H)) * 100;
    return {
      id,
      kind: 'region',
      shapeId: sh.id,
      title: `Region ${sh.id}`,
      summary: `${plural(verts, 'vertex', 'vertices')}, ${holes ? plural(holes, 'hole') : 'no holes'}, covers ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of the image, ${size}, ${where}`,
      explain:
        `polygon() connects the points in order and fills the inside solid black. ` +
        (holes
          ? `The ${plural(holes, 'hole')} ${holes === 1 ? 'is' : 'are'} cut out by walking around ${holes === 1 ? 'it' : 'them'} in the opposite direction. ` +
            `A zero-width bridge, walked there and back, connects each hole to the outline so the whole region stays one polygon.`
          : `The outline runs counter-clockwise, which Desmos fills as the inside.`),
      example: `The outline starts at (${num(sh.rings[0][0])}, ${num(flipY(sh.rings[0][1], H))}) and has ${plural(sh.rings[0].length / 2, 'corner')}.`,
      latex,
      bbox: sh.bbox,
    };
  }
  const n = sh.freq.length;
  const big = sh.freq
    .map((k, j) => ({ k, r: Math.hypot(sh.re[j], sh.im[j]) }))
    .filter((c) => c.k !== 0)
    .sort((a, b) => b.r - a.r)[0];
  return {
    id,
    kind: 'fourier',
    shapeId: sh.id,
    title: `Fourier curve ${sh.id}`,
    summary: `${plural(Math.max(0, n - 1), 'rotating circle')}, mean error ${sh.error.toFixed(2)} px, ${sh.closed ? 'closed outline' : 'open line traced out and back'}, ${size}, ${where}`,
    explain:
      `A sum of circles spinning at whole-number speeds. The first list gives each circle's speed (the frequency k), and the other two give ` +
      `its radius and starting angle as a complex number. total() adds every circle's contribution, so the tip of the ` +
      `chain traces the outline once as t goes from 0 to 1. The radii and angles come from a discrete Fourier transform of the traced path.`,
    example: big ? `The biggest circle has radius ${num(big.r)} px and turns ${plural(Math.abs(big.k), 'time')} per loop.` : undefined,
    latex,
    bbox: sh.bbox,
  };
}
