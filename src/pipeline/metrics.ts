/**
 * How close is a trace to the original picture, and how heavy is it for Desmos?
 *
 * Used by the bench (tools/) and by Auto Enhance. Everything here is pure
 * TypeScript (no canvas), so it runs in the trace worker and in tests.
 *
 *  - Outline / Fourier: chamfer distances between the traced lines and the
 *    picture's edge map, both ways. `precision` is how far traced ink sits from
 *    a real edge, `recall` how far real edges sit from traced ink (px, lower is
 *    better, each capped at 20 px).
 *  - Fill: intersection over union of the filled area and the threshold bitmap.
 *  - Cost: estimated Desmos draw time and the equation size.
 */

import type { RgbaImage, Shape, TraceResult } from './types';
import { binarize, gaussianBlur, histogram, otsu, toGray } from './image';
import { canny } from './canny';
import { thin } from './thin';

/** Measured in round 1: Desmos draw time per parametric curve segment, and per polygon vertex. */
export const MS_PER_SEGMENT = 0.75;
export const MS_PER_VERTEX = 0.02;
export const MS_PER_TERM = 0.35;
const CAP = 20;

/** Two-pass chamfer distance transform (1 and sqrt 2 weights) to the nearest "on" pixel. */
export function distanceTo(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + Math.SQRT2);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + Math.SQRT2);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + Math.SQRT2);
        if (x > 0) v = Math.min(v, d[i + w - 1] + Math.SQRT2);
      }
      d[i] = v;
    }
  return d;
}

function plot(mask: Uint8Array, w: number, h: number, x: number, y: number): void {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi >= 0 && yi >= 0 && xi < w && yi < h) mask[yi * w + xi] = 1;
}

function line(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) plot(mask, w, h, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
}

/** Even-odd scanline fill of a set of rings. */
function fillRings(mask: Uint8Array, w: number, h: number, rings: number[][]): void {
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (let k = 1; k < r.length; k += 2) (minY = Math.min(minY, r[k])), (maxY = Math.max(maxY, r[k]));
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const r of rings) {
      const m = r.length / 2;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const ay = r[2 * j + 1], by = r[2 * i + 1];
        if (ay > sy !== by > sy) {
          const ax = r[2 * j], bx = r[2 * i];
          xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) mask[y * w + x] = 1;
    }
  }
}

/** Rasterize traced shapes to a 0/1 mask: strokes and Fourier curves as 1 px lines, regions filled. */
export function rasterizeShapes(shapes: Shape[], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (const sh of shapes) {
    if (sh.kind === 'stroke') {
      const s = sh.segs;
      for (let o = 0; o + 7 < s.length; o += 8) {
        const len = Math.hypot(s[o + 2] - s[o], s[o + 3] - s[o + 1]) + Math.hypot(s[o + 4] - s[o + 2], s[o + 5] - s[o + 3]) + Math.hypot(s[o + 6] - s[o + 4], s[o + 7] - s[o + 5]);
        const n = Math.max(2, Math.ceil(len / 1.5));
        let px = s[o], py = s[o + 1];
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          const a = u * u * u, b = 3 * t * u * u, c = 3 * t * t * u, d = t * t * t;
          const x = a * s[o] + b * s[o + 2] + c * s[o + 4] + d * s[o + 6];
          const y = a * s[o + 1] + b * s[o + 3] + c * s[o + 5] + d * s[o + 7];
          line(mask, w, h, px, py, x, y);
          px = x;
          py = y;
        }
      }
    } else if (sh.kind === 'region') {
      fillRings(mask, w, h, sh.rings);
    } else {
      const n = Math.max(32, Math.ceil(sh.length / 1.5));
      let px = 0, py = 0;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        let x = 0, y = 0;
        for (let j = 0; j < sh.freq.length; j++) {
          const a = 2 * Math.PI * sh.freq[j] * t, c = Math.cos(a), s = Math.sin(a);
          x += sh.re[j] * c - sh.im[j] * s;
          y += sh.re[j] * s + sh.im[j] * c;
        }
        if (i > 0) line(mask, w, h, px, py, x, y);
        px = x;
        py = y;
      }
    }
  }
  return mask;
}

/** Reference maps of a picture: thin edge map (with its distance field) and the threshold bitmap. */
export interface Reference {
  width: number;
  height: number;
  edges: Uint8Array;
  edgeDist: Float32Array;
  bitmap: Uint8Array;
}

export function reference(img: RgbaImage): Reference {
  const { width: w, height: h } = img;
  const gray = toGray(img);
  const edges = thin(canny(gray, w, h, { sigma: 1.0, detail: 60 }).edges, w, h);
  const bl = gaussianBlur(gray, w, h, 0.5);
  const bitmap = binarize(bl, otsu(histogram(bl)), false);
  return { width: w, height: h, edges, edgeDist: distanceTo(edges, w, h), bitmap };
}

export interface Score {
  /** Mean px distance traced -> reference edges (lines only, lower is better). */
  precision: number;
  /** Mean px distance reference edges -> traced (lines only, lower is better). */
  recall: number;
  /** Fill only: overlap with the threshold bitmap, 0..1. */
  iou: number;
  /** Combined accuracy, 0..1, higher is better (comparable within one mode). */
  accuracy: number;
  /** Estimated Desmos draw time, ms. */
  drawMs: number;
}

/** Estimated Desmos draw cost of a trace, ms. */
export function drawCost(res: Pick<TraceResult, 'stats'>): number {
  return res.stats.segments * MS_PER_SEGMENT + res.stats.points * MS_PER_VERTEX + res.stats.terms * MS_PER_TERM;
}

/**
 * Score a trace against a reference made at the same size. If the trace was
 * made at another resolution its coordinates are scaled to the reference.
 */
export function score(res: TraceResult, ref: Reference): Score {
  const w = ref.width, h = ref.height;
  const shapes = res.width === w && res.height === h ? res.shapes : scaleShapes(res.shapes, w / res.width, h / res.height);
  const mask = rasterizeShapes(shapes, w, h);
  const drawMs = drawCost(res);
  if (res.mode === 'fill') {
    let inter = 0, uni = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && ref.bitmap[i]) inter++;
      if (mask[i] || ref.bitmap[i]) uni++;
    }
    const iou = uni ? inter / uni : 1;
    return { precision: 0, recall: 0, iou, accuracy: iou, drawMs };
  }
  const dTrace = distanceTo(mask, w, h);
  let p = 0, r = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      p += Math.min(CAP, ref.edgeDist[i]);
      n1++;
    }
    if (ref.edges[i]) {
      r += Math.min(CAP, dTrace[i]);
      n2++;
    }
  }
  const precision = n1 ? p / n1 : CAP;
  const recall = n2 ? r / n2 : CAP;
  // Recall matters a little more: missing lines are more visible than slightly misplaced ones.
  const err = 0.4 * precision + 0.6 * recall;
  return { precision, recall, iou: 0, accuracy: 1 / (1 + err), drawMs };
}

/**
 * Colour accuracy of an In Color trace: paint the shapes (regions filled in
 * layer order on white; strokes and curves as 1 px lines) and compare with the
 * picture, pixel by pixel, in a perceptual colour space. 1 = identical; the
 * mean colour difference is mapped so that a typical good result scores about
 * 0.8-0.9.
 */
export function colorAccuracy(res: TraceResult, img: RgbaImage): number {
  const w = img.width, h = img.height;
  const shapes = res.width === w && res.height === h ? res.shapes : scaleShapes(res.shapes, w / res.width, h / res.height);
  const out = new Uint8ClampedArray(w * h * 3).fill(255);
  const paint = (mask: Uint8Array, hex: string) => {
    const v = parseInt(hex.replace('#', ''), 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    for (let i = 0; i < mask.length; i++) if (mask[i]) (out[i * 3] = r), (out[i * 3 + 1] = g), (out[i * 3 + 2] = b);
  };
  const ordered = shapes.slice().sort((a, b) => (a.kind === 'region' ? a.layer ?? 0 : 1e9) - (b.kind === 'region' ? b.layer ?? 0 : 1e9));
  for (const sh of ordered) paint(rasterizeShapes([sh], w, h), sh.color ?? '#000000');
  let sum = 0;
  const d = img.data;
  const step = Math.max(1, Math.floor((w * h) / 60000));
  let n = 0;
  for (let i = 0; i < w * h; i += step) {
    const a = d[i * 4 + 3] / 255;
    const sr = d[i * 4] * a + 255 * (1 - a), sg = d[i * 4 + 1] * a + 255 * (1 - a), sb = d[i * 4 + 2] * a + 255 * (1 - a);
    sum += colorDistance(sr, sg, sb, out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    n++;
  }
  const mean = n ? sum / n : 0;
  return 1 / (1 + mean / 12);
}

/** A cheap perceptual colour difference ("redmean"), roughly delta-E sized. */
function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3;
}

/** Rough size of the finished Desmos equations for a trace, in characters. */
export function estimateBytes(res: Pick<TraceResult, 'stats' | 'mode'>): number {
  return res.stats.segments * 24 + res.stats.points * 9 + res.stats.terms * 15 + res.stats.shapes * 30;
}

export function scaleShapes(shapes: Shape[], sx: number, sy: number): Shape[] {
  return shapes.map((sh): Shape => {
    if (sh.kind === 'stroke') return { ...sh, segs: sh.segs.map((v, i) => (i % 2 ? v * sy : v * sx)) };
    if (sh.kind === 'region') return { ...sh, rings: sh.rings.map((r) => r.map((v, i) => (i % 2 ? v * sy : v * sx))) };
    // A complex series only scales uniformly; traces keep the aspect ratio, so sx and sy agree.
    const s = (sx + sy) / 2;
    return { ...sh, re: sh.re.map((v) => v * s), im: sh.im.map((v) => v * s) };
  });
}
