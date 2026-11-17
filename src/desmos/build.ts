/**
 * Traced shapes -> Desmos graph state, plus an "inspector entry" for every
 * expression that explains in plain English what it draws.
 */

import type { BBox, FourierShape, RegionShape, Shape, StrokeShape, TraceResult } from '../pipeline/types';
import { bezierLatex, flipY, fourierLatex, list, num, polygonLatex } from './latex';
import { emptyState, imageViewport, stateWeight, type DesmosExpression, type DesmosItem, type DesmosState } from './state';
import { BEZIER_FN, BEZIER_FN_ID, FOURIER_FN, FOURIER_FN_ID, LIST_CAP, UNDEF_ID, UNDEF_VAR, coordUnit, packedList, pName, pointFn, rangeLatex, strokePoints, unitList, unitTimes, xName, yName } from './packed';

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
  /** Outline: draw every stroke of a colour with one equation per chunk (fewest expressions). */
  mergeAll?: boolean;
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
  // Point lists store whole numbers of `unit` px (see coordUnit); an explicit `decimals` means units of 10^-decimals.
  const unit = opts.decimals !== undefined ? Number((10 ** -opts.decimals).toFixed(opts.decimals)) : coordUnit(W, H);

  if (res.mode === 'outline' && opts.packed !== false) {
    addPackedStrokes(res, opts, unit, items, entries);
  } else if (res.mode === 'fill' && opts.packed !== false) {
    addPackedRegions(res, opts, unit, items, entries);
  } else if (res.mode === 'fourier' && opts.packed !== false && opts.mergeAll) {
    addMergedFourier(res, opts, decimals + 1, items, entries);
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
        expr.latex = `Z\\left(t,${list(c.k, 0)},${termList(c.re, c, decimals + 1)},${termList(c.im, c, decimals + 1)}\\right)`;
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

/**
 * Outline, fewest equations: strokes of one colour are laid end to end in the
 * point lists with two undefined fillers (u) between them, so every segment
 * start is exactly 3 apart and a single P_c(t,[a,a+3...b]) draws them all (the
 * filler "segments" are undefined and draw nothing). One expression per colour
 * per chunk instead of one per stroke: much lighter for Desmos to manage.
 */
function addMergedStrokes(res: TraceResult, opts: BuildOptions, unit: number, items: DesmosItem[], entries: InspectorEntry[]): void {
  const { height: H } = res;
  const strokes = res.shapes.filter((s): s is StrokeShape => s.kind === 'stroke' && s.segs.length >= 8);
  // Group by colour (first appearance order) so each colour is one run.
  const byColor = new Map<string, StrokeShape[]>();
  for (const sh of strokes) {
    const color = sh.color ?? INK;
    const g = byColor.get(color);
    if (g) g.push(sh);
    else byColor.set(color, [sh]);
  }
  interface Chunk {
    xs: (number | string)[];
    ys: (number | string)[];
  }
  interface Run {
    c: number;
    color: string;
    a: number;
    b: number;
    strokes: number;
    segs: number;
  }
  const chunks: Chunk[] = [];
  const runs: Run[] = [];
  let cur: Chunk | null = null;
  let run: Run | null = null;
  for (const [color, list] of byColor) {
    run = null;
    for (const sh of list) {
      const p = strokePoints(sh.segs, H);
      const n = sh.segs.length / 8;
      const joinable = run && cur && cur.xs.length + 2 + p.xs.length <= LIST_CAP;
      if (!joinable) {
        // A new run starts at the next point of the chunk, or in a fresh chunk when full.
        if (!cur || cur.xs.length + p.xs.length > LIST_CAP) {
          cur = { xs: [], ys: [] };
          chunks.push(cur);
        }
        const a = cur.xs.length + 1;
        run = { c: chunks.length, color, a, b: a + 3 * (n - 1), strokes: 1, segs: n };
        runs.push(run);
        cur.xs.push(...p.xs);
        cur.ys.push(...p.ys);
        continue;
      }
      cur!.xs.push('u', 'u', ...p.xs);
      cur!.ys.push('u', 'u', ...p.ys);
      // the filler bridge counts as one (undefined) segment, then n real ones
      run!.b += 3 * (n + 1);
      run!.strokes++;
      run!.segs += n;
    }
  }

  items.push({ type: 'folder', id: 'm2d-curves', title: 'Curve data: control points and the Bezier function', collapsed: true });
  items.push({ type: 'expression', id: UNDEF_ID, folderId: 'm2d-curves', latex: UNDEF_VAR });
  items.push({ type: 'expression', id: BEZIER_FN_ID, folderId: 'm2d-curves', latex: BEZIER_FN });
  chunks.forEach((ch, i) => {
    const c = i + 1;
    items.push({ type: 'expression', id: `cx${c}`, folderId: 'm2d-curves', latex: `${xName(c)}=${unitList(ch.xs, unit)}` });
    items.push({ type: 'expression', id: `cy${c}`, folderId: 'm2d-curves', latex: `${yName(c)}=${unitList(ch.ys, unit)}` });
    items.push({ type: 'expression', id: `cp${c}`, folderId: 'm2d-curves', latex: pointFn(c, unit) });
  });
  const colored = byColor.size > 1 || !byColor.has(INK);
  runs.forEach((r, i) => {
    const id = `sr${i + 1}`;
    const latex = `${pName(r.c)}\\left(t,${rangeLatex(r.a, r.b)}\\right)`;
    items.push({ type: 'expression', id, latex, color: r.color, lineWidth: String(opts.strokeWidth), lineOpacity: '1' });
    entries.push({
      id,
      kind: 'stroke',
      title: colored ? `Curves in ${r.color}` + (runs.length > byColor.size ? ` (chunk ${r.c})` : '') : runs.length > 1 ? `Curves, part ${i + 1}` : 'All curves',
      summary: `${plural(r.strokes, 'stroke')} drawn by one equation (${r.segs.toLocaleString('en-US')} Bezier segments)`,
      explain:
        `Every stroke${colored ? ' of this colour' : ''} sits end to end in the point lists X_${r.c} and Y_${r.c}: each is its start point followed by 3 points per segment ` +
        `(two pulls and the end, which is also the next segment's start). Two undefined fillers (u) separate neighbouring strokes, so every segment start is exactly 3 apart ` +
        `and the list [${r.a}, ${r.a + 3}, ..., ${r.b}] reaches all of them. P_${r.c}(t,k) blends the 4 points from position k with B(t,a,b,c,d) = (1-t)^3 a + 3t(1-t)^2 b + 3t^2(1-t) c + t^3 d, ` +
        `and the segments that touch a filler are undefined, so the gaps between strokes stay empty.` +
        (unit !== 1 ? ` The lists hold whole numbers of ${unit} px; P_${r.c} multiplies by ${unit}.` : ''),
      latex,
    });
  });
}

/** Outline shapes in the compact encoding (see packed.ts). */
function addPackedStrokes(res: TraceResult, opts: BuildOptions, unit: number, items: DesmosItem[], entries: InspectorEntry[]): void {
  if (opts.mergeAll) {
    addMergedStrokes(res, opts, unit, items, entries);
    return;
  }
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
    items.push({ type: 'expression', id: `cx${c}`, folderId: 'm2d-curves', latex: `${xName(c)}=${unitList(ch.xs, unit)}` });
    items.push({ type: 'expression', id: `cy${c}`, folderId: 'm2d-curves', latex: `${yName(c)}=${unitList(ch.ys, unit)}` });
    items.push({ type: 'expression', id: `cp${c}`, folderId: 'm2d-curves', latex: pointFn(c, unit) });
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
 * Fill shapes, packed: the outline points of every region live in shared
 * lists (X_fc, Y_fc), and each colour layer is ONE expression that builds a
 * polygon per region with a list comprehension:
 *   [polygon((X[S[j]...E[j]], Y[S[j]...E[j]])) for j=[1...n]]
 * S and E say where each region's points start and end. Regions stay
 * separate polygons (no bridges between them, so nothing stray shows even when
 * a plain paste turns polygon outlines on); holes are still joined to their
 * outline by a zero-width bridge. Layers are drawn in order, background first.
 */
function addPackedRegions(res: TraceResult, opts: BuildOptions, unit: number, items: DesmosItem[], entries: InspectorEntry[]): void {
  const { width: W, height: H } = res;
  interface Group {
    color: string;
    layer: number;
    shapes: RegionShape[];
  }
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const sh of res.shapes) {
    if (sh.kind !== 'region') continue;
    const color = sh.color ?? INK;
    const layer = sh.layer ?? 0;
    const key = `${layer}|${color}`;
    let g = byKey.get(key);
    if (!g) {
      g = { color, layer, shapes: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.shapes.push(sh);
  }
  groups.sort((a, b) => a.layer - b.layer);
  const colored = groups.length > 1 || groups.some((g) => g.color !== INK);

  interface Chunk {
    xs: number[];
    ys: number[];
  }
  interface Run {
    c: number;
    gi: number;
    color: string;
    starts: number[];
    ends: number[];
    members: RegionShape[];
  }
  const chunks: Chunk[] = [];
  const runs: Run[] = [];
  let cur: Chunk | null = null;
  groups.forEach((g, gi) => {
    let run: Run | null = null;
    for (const sh of g.shapes) {
      const path = bridgedPath(regionRings(sh, H));
      const m = path.length / 2;
      if (m < 3) continue;
      if (!cur || cur.xs.length + m > LIST_CAP) {
        cur = { xs: [], ys: [] };
        chunks.push(cur);
        run = null;
      }
      if (!run) {
        run = { c: chunks.length, gi, color: g.color, starts: [], ends: [], members: [] };
        runs.push(run);
      }
      const a = cur.xs.length + 1;
      for (let i = 0; i < path.length; i += 2) {
        cur.xs.push(path[i]);
        cur.ys.push(path[i + 1]);
      }
      run.starts.push(a);
      run.ends.push(a + m - 1);
      run.members.push(sh);
    }
  });
  if (!runs.length) return;

  items.push({ type: 'folder', id: 'm2d-fill', title: 'Fill data: outline points and where each region starts and ends', collapsed: true });
  chunks.forEach((ch, i) => {
    const c = i + 1;
    items.push({ type: 'expression', id: `fx${c}`, folderId: 'm2d-fill', latex: `X_{f${c}}=${unitList(ch.xs, unit)}` });
    items.push({ type: 'expression', id: `fy${c}`, folderId: 'm2d-fill', latex: `Y_{f${c}}=${unitList(ch.ys, unit)}` });
  });
  const ut = unitTimes(unit);
  runs.forEach((r, i) => {
    const k = i + 1;
    items.push({ type: 'expression', id: `fs${k}`, folderId: 'm2d-fill', latex: `S_{f${k}}=${list(r.starts, 0)}` });
    items.push({ type: 'expression', id: `fe${k}`, folderId: 'm2d-fill', latex: `E_{f${k}}=${list(r.ends, 0)}` });
  });
  runs.forEach((r, i) => {
    const k = i + 1;
    const id = `f${k}`;
    const idx = `\\left[S_{f${k}}\\left[j\\right]...E_{f${k}}\\left[j\\right]\\right]`;
    const n = r.members.length;
    const latex = `\\left[${polygonLatex(`${ut}X_{f${r.c}}${idx}`, `${ut}Y_{f${r.c}}${idx}`)}\\operatorname{for}j=\\left[1...${n}\\right]\\right]`;
    items.push({ type: 'expression', id, color: r.color, latex, fillOpacity: '1', lines: false, lineOpacity: '1' });
    const bbox: BBox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const m of r.members) {
      bbox[0] = Math.min(bbox[0], m.bbox[0]);
      bbox[1] = Math.min(bbox[1], m.bbox[1]);
      bbox[2] = Math.max(bbox[2], m.bbox[2]);
      bbox[3] = Math.max(bbox[3], m.bbox[3]);
    }
    const holes = r.members.reduce((a, m) => a + m.rings.length - 1, 0);
    const pts = r.ends.reduce((a, e, j) => a + e - r.starts[j] + 1, 0);
    const pct = (r.members.reduce((a, m) => a + Math.abs(m.area), 0) / (W * H)) * 100;
    entries.push({
      id,
      kind: 'region',
      title: colored ? `Colour layer ${r.gi + 1} (${r.color})` + (runs.length > groups.length ? `, chunk ${r.c}` : '') : runs.length > 1 ? `Filled shapes, part ${k}` : 'Filled shapes',
      summary: `${plural(n, 'region')}, ${plural(pts, 'point')}, ${holes ? plural(holes, 'hole') : 'no holes'}, covers ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of the image`,
      explain:
        `One equation fills every ${colored ? 'region of this colour' : 'filled region'}. The outline points of all regions sit end to end in X_f${r.c} and Y_f${r.c}; ` +
        `S_f${k} and E_f${k} say where region j starts and ends, so X_f${r.c}[S_f${k}[j]...E_f${k}[j]] is just region j's outline. The "for j" list builds one polygon() per region. ` +
        `Each outline runs counter-clockwise and each hole clockwise, joined by a zero-width bridge, so Desmos' fill rule cuts the holes out.` +
        (unit !== 1 ? ` The point lists hold whole numbers of ${unit} px; the ${unit} in front scales them back.` : '') +
        (colored ? ` Colour layers are drawn in order, background first, like stacked paper cut-outs.` : ''),
      example: `Region 1 starts at (${num(r.members[0].rings[0][0])}, ${num(flipY(r.members[0].rings[0][1], H))}) and has ${plural(r.ends[0] - r.starts[0] + 1, 'point')}.`,
      latex,
      bbox,
    });
  });
  void opts;
}

/**
 * Fourier, fewest equations: the terms of every curve of a colour sit end to
 * end in shared lists (K, A, B), and one expression draws them all:
 *   [Z(t, K[S[j]...E[j]], A[S[j]...E[j]], B[S[j]...E[j]]) for j=[1...n]]
 */
function addMergedFourier(res: TraceResult, opts: BuildOptions, decimals: number, items: DesmosItem[], entries: InspectorEntry[]): void {
  const { height: H } = res;
  const curves = res.shapes.filter((s): s is FourierShape => s.kind === 'fourier');
  if (!curves.length) return;
  interface Chunk {
    k: number[];
    re: number[];
    im: number[];
  }
  interface Run {
    c: number;
    color: string;
    starts: number[];
    ends: number[];
    terms: number;
  }
  const byColor = new Map<string, FourierShape[]>();
  for (const sh of curves) {
    const color = sh.color ?? INK;
    const g = byColor.get(color);
    if (g) g.push(sh);
    else byColor.set(color, [sh]);
  }
  const chunks: Chunk[] = [];
  const runs: Run[] = [];
  let cur: Chunk | null = null;
  for (const [color, list] of byColor) {
    let run: Run | null = null;
    for (const sh of list) {
      const col = fourierColumns(sh, H);
      // per-term precision as in termList
      const fmt = (v: number, j: number) => {
        const r = Math.hypot(col.re[j], col.im[j]);
        const f = 10 ** (r >= 1 ? Math.min(1, decimals) : Math.max(2, decimals));
        return Math.round(v * f) / f;
      };
      const n = col.k.length;
      if (!cur || cur.k.length + n > LIST_CAP) {
        cur = { k: [], re: [], im: [] };
        chunks.push(cur);
        run = null;
      }
      if (!run) {
        run = { c: chunks.length, color, starts: [], ends: [], terms: 0 };
        runs.push(run);
      }
      const a = cur.k.length + 1;
      for (let j = 0; j < n; j++) {
        cur.k.push(col.k[j]);
        cur.re.push(fmt(col.re[j], j));
        cur.im.push(fmt(col.im[j], j));
      }
      run.starts.push(a);
      run.ends.push(a + n - 1);
      run.terms += n;
    }
  }
  items.push({ type: 'folder', id: 'm2d-fn', title: 'The Fourier series function and every curve’s terms', collapsed: true });
  items.push({ type: 'expression', id: FOURIER_FN_ID, folderId: 'm2d-fn', latex: FOURIER_FN });
  chunks.forEach((ch, i) => {
    const c = i + 1;
    items.push({ type: 'expression', id: `zk${c}`, folderId: 'm2d-fn', latex: `K_{z${c}}=${list(ch.k, 0)}` });
    items.push({ type: 'expression', id: `za${c}`, folderId: 'm2d-fn', latex: `A_{z${c}}=${list(ch.re, Math.max(2, decimals))}` });
    items.push({ type: 'expression', id: `zb${c}`, folderId: 'm2d-fn', latex: `B_{z${c}}=${list(ch.im, Math.max(2, decimals))}` });
  });
  runs.forEach((r, i) => {
    const k = i + 1;
    items.push({ type: 'expression', id: `zs${k}`, folderId: 'm2d-fn', latex: `S_{z${k}}=${list(r.starts, 0)}` });
    items.push({ type: 'expression', id: `ze${k}`, folderId: 'm2d-fn', latex: `E_{z${k}}=${list(r.ends, 0)}` });
  });
  const colored = byColor.size > 1 || !byColor.has(INK);
  runs.forEach((r, i) => {
    const k = i + 1;
    const id = `zr${k}`;
    const idx = `\\left[S_{z${k}}\\left[j\\right]...E_{z${k}}\\left[j\\right]\\right]`;
    const latex = `\\left[Z\\left(t,K_{z${r.c}}${idx},A_{z${r.c}}${idx},B_{z${r.c}}${idx}\\right)\\operatorname{for}j=\\left[1...${r.starts.length}\\right]\\right]`;
    items.push({ type: 'expression', id, latex, color: r.color, lineWidth: String(opts.strokeWidth), lineOpacity: '1', parametricDomain: { min: '0', max: '1' } });
    entries.push({
      id,
      kind: 'fourier',
      title: colored ? `Fourier curves in ${r.color}` : runs.length > 1 ? `Fourier curves, part ${k}` : 'All Fourier curves',
      summary: `${plural(r.starts.length, 'curve')} drawn by one equation (${r.terms.toLocaleString('en-US')} rotating circles in all)`,
      explain:
        `Each curve is a sum of circles spinning at whole-number speeds. The terms of every curve sit end to end in K_z${r.c} (speeds), A_z${r.c} and B_z${r.c} ` +
        `(radius and starting angle as a complex number). S_z${k}[j] and E_z${k}[j] say where curve j's terms start and end, and the "for j" list draws ` +
        `Z(t,k,a,b) once per curve: its x is total(a cos(2 pi k t) - b sin(2 pi k t)) and its y is total(a sin(2 pi k t) + b cos(2 pi k t)).`,
      latex,
    });
  });
}

/**
 * Fourier coefficients with precision that follows each term's size: big
 * circles to 0.1 px, small ones to 0.01 px (their absolute error is what shows).
 */
function termList(values: number[], c: { re: number[]; im: number[] }, decimals: number): string {
  return list(
    values.map((v, j) => {
      const r = Math.hypot(c.re[j], c.im[j]);
      const f = 10 ** (r >= 1 ? Math.min(1, decimals) : Math.max(2, decimals));
      return Math.round(v * f) / f;
    }),
    Math.max(2, decimals),
  );
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
