/**
 * The tracing pipeline: RGBA pixels + settings -> shapes.
 *
 *   outline/edges      : Canny -> thin -> chains -> smooth -> cubic Beziers
 *   outline/centerline : threshold -> thin -> chains -> smooth -> cubic Beziers
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
  const gray = toGray(img);
  const hist = histogram(gray);
  const autoThr = otsu(hist);
  const thr = s.threshold >= 0 ? s.threshold + 0.5 : autoThr;
  let preview: Uint8Array | undefined;

  let shapes: Shape[] = [];

  const needsContours = s.mode === 'fill' || s.lineSource === 'contours';

  if (needsContours) {
    const field = s.blur > 0.05 ? gaussianBlur(gray, w, h, s.blur) : gray;
    if (opts.preview) preview = toPreview(binarize(field, thr, s.invert));
    // Foreground is dark (value < thr) unless inverted.
    const rings = marchingSquares(field, w, h, thr, s.invert);
    const minArea = s.minSize * s.minSize * 0.5;
    if (s.mode === 'fill') {
      shapes = regionsFromRings(rings, minArea, s.smoothing);
    } else {
      const lines: Polyline[] = rings
        .filter((r) => Math.abs(r.area) >= minArea)
        .map((r) => ({ pts: r.pts, closed: true }));
      shapes = s.mode === 'fourier' ? fourierShapes(lines, s) : strokeShapes(lines, s, 0);
    }
  } else {
    let thinMap: Uint8Array;
    if (s.lineSource === 'centerline') {
      const field = s.blur > 0.05 ? gaussianBlur(gray, w, h, s.blur) : gray;
      thinMap = thin(binarize(field, thr, s.invert), w, h);
    } else {
      // Edge detection always needs some smoothing on top of the user's blur.
      const { edges } = canny(gray, w, h, { sigma: 0.6 + s.blur, detail: s.edgeDetail });
      thinMap = thin(edges, w, h);
    }
    if (opts.preview) preview = toPreview(thinMap);
    const chains = traceChains(thinMap, w, h, s.minSize);
    const lines = chains.map((c: Chain) => ({ pts: c.pts, closed: c.closed }));
    shapes = s.mode === 'fourier' ? fourierShapes(lines, s) : strokeShapes(lines, s, 1);
  }

  // Budget: keep the most important shapes that fit.
  const importance = (sh: Shape) =>
    sh.kind === 'region' ? Math.abs(sh.area) + 1 : sh.length;
  const sorted = shapes.slice().sort((a, b) => importance(b) - importance(a));
  const kept: Shape[] = [];
  let used = 0;
  let dropped = 0;
  for (const sh of sorted) {
    const c = shapeCost(sh);
    if (used + c <= s.budget) {
      kept.push(sh);
      used += c;
    } else dropped++;
  }
  kept.forEach((sh, i) => (sh.id = i + 1));

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
    const terms = Math.max(3, Math.min(s.fourierTerms, Math.ceil(length / 10)));
    const fit = fourierFit(line.pts, line.closed, terms);
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
