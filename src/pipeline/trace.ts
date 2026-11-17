/**
 * The tracing pipeline: RGBA pixels + settings -> shapes.
 *
 *   outline/edges      : Canny -> thin -> chains -> smooth -> cubic Beziers
 *   outline/centerline : threshold -> thin -> chains -> smooth -> cubic Beziers
 *   outline/ink        : adaptive ink map (darker than surroundings) -> thin -> chains -> Beziers
 *   outline/contours   : threshold contours (marching squares) -> cubic Beziers
 *   fill               : threshold contours -> polygons with holes
 *   fourier            : contours or chains -> Fourier series
 */

import { binarize, gaussianBlur, histogram, otsu, toGray, toPreview } from './image';
import { canny } from './canny';
import { thin } from './thin';
import { traceChains, pathLength, type Chain } from './chains';
import { groupRings, marchingSquares, bboxOf, signedArea, type Ring } from './contours';
import { rdpClosed, smooth } from './simplify';
import { fitBeziers } from './bezier';
import { fourierFit } from './fourier';
import { inkMap, removeSmallComponents } from './ink';
import { joinChains, pruneSpurs } from './chainops';
import { autoColors, colorIndexAt, hex, quantize, stackedLayerField, type Palette } from './color';
import { matchPalette } from './colormatch';
import { closeGaps, enhanceGray, median3 } from './enhance';
import { sampleSegs } from './bezier';
import { sampleFourier } from './fourier';
import type { FourierShape, RegionShape, RgbaImage, Shape, StrokeShape, TraceResult, TraceSettings } from './types';
import { shapeCost } from './types';

export interface TraceOptions {
  /** Include the analysis bitmap / edge map in the result. */
  preview?: boolean;
  /** Include the luminance histogram. */
  histogram?: boolean;
}

interface Polyline {
  pts: number[];
  closed: boolean;
}

export function trace(img: RgbaImage, s: TraceSettings, opts: TraceOptions = {}): TraceResult {
  const t0 = now();
  const { width: w, height: h } = img;
  let gray = toGray(img);
  if (s.enhance) gray = enhanceGray(gray, w, h);
  if (s.lineCleanup && (s.lineSource === 'ink' || s.lineSource === 'centerline') && s.mode !== 'fill') gray = median3(gray, w, h);
  const hist = histogram(gray);
  const autoThr = otsu(hist);
  const thr = s.threshold >= 0 ? s.threshold + 0.5 : autoThr;
  let preview: Uint8Array | undefined;

  let shapes: Shape[] = [];
  // Detail brush mask (1 = more detail), only when it matches this image's size.
  const detail = s.detail && s.detail.length === w * h ? s.detail : null;

  const needsContours = s.mode === 'fill' || s.lineSource === 'contours';
  let palette: Palette | null = null;

  // Auto Color (BETA): pick the number of colours for this picture.
  const auto = s.color && s.autoColor ? autoColors(img) : null;
  const colorCount = auto ? auto.k : s.colors;

  if (s.color && s.mode === 'fill') {
    // In Color fill: stacked colour layers, background rectangle first.
    palette = quantize(img, colorCount);
    const minArea = s.minSize * s.minSize * 0.5;
    shapes = [
      {
        kind: 'region',
        id: 0,
        rings: [[0, 0, w, 0, w, h, 0, h]],
        area: w * h,
        bbox: [0, 0, w, h],
        color: hex(palette.colors[0]),
        layer: 0,
        paletteIndex: 0,
      },
    ];
    for (let layer = 1; layer < palette.colors.length; layer++) {
      let field = stackedLayerField(palette, layer);
      field = gaussianBlur(field, w, h, Math.max(0.5, s.blur));
      const rings = marchingSquares(field, w, h, 127.5, true);
      for (const r of regionsFromRings(rings, minArea, Math.max(1, s.smoothing * 1.3))) {
        r.color = hex(palette.colors[layer]);
        r.layer = layer;
        r.paletteIndex = layer;
        shapes.push(r);
      }
    }
    if (opts.preview) {
      const pv = new Uint8Array(w * h);
      for (let i = 0; i < pv.length; i++) pv[i] = Math.round((palette.labels[i] / Math.max(1, palette.colors.length - 1)) * 255);
      preview = pv;
    }
  } else if (needsContours) {
    const field = s.blur > 0.05 ? gaussianBlur(gray, w, h, s.blur) : gray;
    if (opts.preview) preview = toPreview(binarize(field, thr, s.invert));
    // Foreground is dark (value < thr) unless inverted.
    const rings = marchingSquares(field, w, h, thr, s.invert);
    const minArea = s.minSize * s.minSize * 0.5;
    if (s.mode === 'fill') {
      shapes = regionsFromRings(detail ? rings.filter((r) => Math.abs(r.area) >= minArea || inDetail(r.pts, detail, w) > 0.5) : rings, detail ? minArea * 0.12 : minArea, s.smoothing);
    } else {
      const lines: Polyline[] = rings
        .filter((r) => Math.abs(r.area) >= minArea || (!!detail && Math.abs(r.area) >= minArea * 0.12 && inDetail(r.pts, detail, w) > 0.5))
        .map((r) => ({ pts: r.pts, closed: true }));
      shapes = s.mode === 'fourier' ? fourierShapes(lines, s) : strokeShapes(lines, s, 0);
    }
  } else {
    let thinMap: Uint8Array;
    if (s.lineSource === 'centerline') {
      const field = s.blur > 0.05 ? gaussianBlur(gray, w, h, s.blur) : gray;
      thinMap = thin(binarize(field, thr, s.invert), w, h);
    } else if (s.lineSource === 'ink') {
      // Drawings and anime: pixels clearly darker than their surroundings, thinned to centre lines.
      const field = s.blur > 0.05 ? gaussianBlur(gray, w, h, s.blur) : gray;
      const radius = Math.max(3, Math.round(Math.max(w, h) / 60));
      const ink = inkMap(field, w, h, { radius, detail: s.edgeDetail, invert: s.invert });
      removeSmallComponents(ink, w, h, Math.max(3, s.minSize) * (s.lineCleanup ? 3 : 1));
      thinMap = thin(s.lineCleanup ? closeGaps(ink, w, h, 1) : ink, w, h);
    } else {
      // Edge detection always needs some smoothing on top of the user's blur.
      const { edges } = canny(gray, w, h, { sigma: 0.6 + s.blur, detail: s.edgeDetail });
      thinMap = thin(edges, w, h);
    }
    if (opts.preview) preview = toPreview(thinMap);
    // Short pieces survive tracing so they can be joined; the length filter runs after joining.
    let chains = traceChains(thinMap, w, h, 2);
    chains = pruneSpurs(chains, Math.max(4, s.minSize));
    chains = joinChains(chains);
    // Detail brush: short pieces survive where the user painted.
    chains = chains.filter((c) => pathLength(c.pts, c.closed) >= (detail && inDetail(c.pts, detail, w) > 0.5 ? s.minSize * 0.35 : s.minSize));
    const lines = chains.map((c: Chain) => ({ pts: c.pts, closed: c.closed }));
    shapes = s.mode === 'fourier' ? fourierShapes(lines, s) : strokeShapes(lines, s, 1);
  }

  // In Color outline / Fourier: each shape takes the (palette-snapped) colour under it.
  if (s.color && s.mode !== 'fill') {
    palette = quantize(img, colorCount);
    const pal = palette.colors;
    for (const sh of shapes) {
      if (sh.kind === 'region') continue;
      const idx = colorIndexAt(img, sh.kind === 'stroke' ? sampleSegs(sh.segs, 3) : sampleFourier(sh, 48), pal);
      sh.paletteIndex = idx;
      sh.color = hex(pal[idx]);
    }
  }

  // Budget: keep the most important shapes that fit. The detail brush multiplies the importance of what it covers.
  const boost = new Map<Shape, number>();
  if (detail) for (const sh of shapes) boost.set(sh, 1 + 4 * inDetail(shapePoints(sh), detail, w));
  const importance = (sh: Shape) =>
    (sh.kind === 'region' ? (sh.layer === 0 ? Infinity : Math.abs(sh.area) + 1) : sh.length) * (boost.get(sh) ?? 1);
  const sorted = shapes.slice().sort((a, b) => importance(b) - importance(a));
  const kept: Shape[] = [];
  let used = 0;
  let dropped = 0;
  // Colour layers have long outlines; polygons are cheap for Desmos, so allow three times the vertices.
  const budget = palette && s.mode === 'fill' ? Math.min(60000, s.budget * 3) : s.budget;
  for (const sh of sorted) {
    const c = shapeCost(sh);
    if (used + c <= budget) {
      kept.push(sh);
      used += c;
    } else dropped++;
  }
  // Colour layers must be drawn bottom to top; within a layer, biggest first.
  if (palette && s.mode === 'fill') {
    kept.sort((a, b) => ((a.kind === 'region' ? a.layer ?? 0 : 0) - (b.kind === 'region' ? b.layer ?? 0 : 0)) || importance(b) - importance(a));
  }
  kept.forEach((sh, i) => (sh.id = i + 1));

  // Match the colours to the picture, using what is actually visible once drawn.
  if (palette) {
    palette.colors = matchPalette(kept, palette.colors, img);
    for (const sh of kept) if (sh.paletteIndex !== undefined) sh.color = hex(palette.colors[sh.paletteIndex]);
  }

  let segments = 0, points = 0, terms = 0;
  for (const sh of kept) {
    if (sh.kind === 'stroke') segments += sh.segs.length / 8;
    else if (sh.kind === 'region') points += sh.rings.reduce((n, r) => n + r.length / 2, 0);
    else terms += sh.freq.length;
  }

  return {
    width: w,
    height: h,
    mode: s.mode,
    shapes: kept,
    stats: {
      shapes: kept.length,
      dropped,
      segments,
      points,
      terms,
      threshold: Math.round(thr - 0.5),
      ms: Math.round(now() - t0),
    },
    preview,
    histogram: opts.histogram ? hist : undefined,
    ...(palette ? { palette: palette.colors.map(hex) } : {}),
    ...(auto ? { autoColor: auto } : {}),
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function strokeShapes(lines: Polyline[], s: TraceSettings, smoothIters: number): StrokeShape[] {
  const out: StrokeShape[] = [];
  for (const line of lines) {
    const pts = smoothIters > 0 ? smooth(line.pts, line.closed, smoothIters) : line.pts;
    const segs = fitBeziers(pts, line.closed, { tolerance: s.smoothing });
    if (segs.length === 0) continue;
    out.push({
      kind: 'stroke',
      id: 0,
      closed: line.closed,
      segs: roundAll(segs),
      length: pathLength(pts, line.closed),
      bbox: bboxOf(pts),
    });
  }
  return out;
}

function fourierShapes(lines: Polyline[], s: TraceSettings): FourierShape[] {
  const out: FourierShape[] = [];
  for (const line of lines) {
    const length = pathLength(line.pts, line.closed);
    // Small shapes need few circles; big ones get up to the cap.
    // Up to the cap, but only as many circles as it takes to stay within the curve tolerance.
    const cap = Math.max(3, Math.min(s.fourierTerms, Math.ceil(length / 6)));
    const fit = fourierFit(line.pts, line.closed, cap, Math.max(0.4, s.smoothing * 0.75));
    out.push({
      kind: 'fourier',
      id: 0,
      closed: line.closed,
      freq: fit.freq,
      re: fit.re.map(r3),
      im: fit.im.map(r3),
      length,
      error: fit.error,
      bbox: bboxOf(line.pts),
    });
  }
  return out;
}

function regionsFromRings(rings: Ring[], minArea: number, smoothing: number): RegionShape[] {
  const groups = groupRings(rings.filter((r) => Math.abs(r.area) >= minArea));
  const eps = Math.max(0.3, smoothing * 0.6);
  const out: RegionShape[] = [];
  for (const g of groups) {
    const outer = simplifyRing(g.outer.pts, eps);
    if (outer.length < 6) continue;
    const ringsOut = [outer];
    let area = Math.abs(signedArea(outer));
    for (const hole of g.holes) {
      const hp = simplifyRing(hole.pts, eps);
      if (hp.length < 6) continue;
      ringsOut.push(hp);
      area -= Math.abs(signedArea(hp));
    }
    out.push({ kind: 'region', id: 0, rings: ringsOut, area, bbox: g.outer.bbox });
  }
  return out;
}

function simplifyRing(pts: number[], eps: number): number[] {
  return roundAll(rdpClosed(pts, eps));
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
function roundAll(a: number[]): number[] {
  return a.map(r2);
}

/** Share of the given points (flat x,y) that fall on the detail mask. */
function inDetail(pts: number[], mask: Uint8Array, w: number): number {
  const n = pts.length / 2;
  if (!n) return 0;
  const h = mask.length / w;
  const step = Math.max(1, Math.floor(n / 64));
  let hit = 0, tot = 0;
  for (let i = 0; i < n; i += step) {
    const x = Math.round(pts[2 * i]), y = Math.round(pts[2 * i + 1]);
    tot++;
    if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) hit++;
  }
  return tot ? hit / tot : 0;
}

/** A few representative points of a shape (flat x,y), for the detail mask test. */
function shapePoints(sh: Shape): number[] {
  if (sh.kind === 'stroke') return sampleSegs(sh.segs, 2);
  if (sh.kind === 'region') return sh.rings[0] ?? [];
  return sampleFourier(sh, 32);
}
