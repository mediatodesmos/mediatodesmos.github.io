/**
 * In Color (BETA): k-means colour quantisation in CIE Lab, plus helpers to
 * colour traced shapes.
 *
 * Fill mode traces "stacked" layers: colours are ordered by area, layer 0 is a
 * full background rectangle, and layer i covers every pixel whose colour ranks
 * i or later. Each layer sits on top of the previous one, so neighbouring
 * colours never leave hairline gaps between them.
 */

import type { RgbaImage } from './types';

export type RGB = [number, number, number];

export interface Palette {
  /** Palette colours (sRGB 0..255), ordered by area, largest first. */
  colors: RGB[];
  /** Palette index per pixel (into `colors`). */
  labels: Uint8Array;
  /** Pixel count per colour. */
  areas: number[];
}

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) LIN[i] = srgbToLinear(i);

function labOf(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  let x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  let y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  let z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  out[o] = 116 * y - 16;
  out[o + 1] = 500 * (x - y);
  out[o + 2] = 200 * (y - z);
}

/** Pixel colour composited over white (transparent PNGs read as paper). */
function pixel(img: RgbaImage, i: number): RGB {
  const d = img.data, p = i * 4;
  const a = d[p + 3] / 255;
  return [Math.round(d[p] * a + 255 * (1 - a)), Math.round(d[p + 1] * a + 255 * (1 - a)), Math.round(d[p + 2] * a + 255 * (1 - a))];
}

/** Deterministic pseudo-random numbers (so the same image always gives the same palette). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function quantize(img: RgbaImage, k: number): Palette {
  const n = img.width * img.height;
  k = Math.max(2, Math.min(16, Math.round(k)));
  const rand = rng(1234567);
  // Sample pixels for the k-means fit.
  const S = Math.min(n, 6000);
  const sample = new Float32Array(S * 3);
  const sampleRgb: RGB[] = [];
  for (let s = 0; s < S; s++) {
    const i = S === n ? s : Math.floor(rand() * n);
    const c = pixel(img, i);
    sampleRgb.push(c);
    labOf(c[0], c[1], c[2], sample, s * 3);
  }
  // k-means++ initialisation.
  const centers = new Float32Array(k * 3);
  const first = Math.floor(rand() * S);
  centers.set(sample.subarray(first * 3, first * 3 + 3), 0);
  const dist = new Float32Array(S).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let s = 0; s < S; s++) {
      const d = d2(sample, s * 3, centers, (c - 1) * 3);
      if (d < dist[s]) dist[s] = d;
      total += dist[s];
    }
    let target = rand() * total;
    let pick = 0;
    for (let s = 0; s < S; s++) {
      target -= dist[s];
      if (target <= 0) {
        pick = s;
        break;
      }
    }
    centers.set(sample.subarray(pick * 3, pick * 3 + 3), c * 3);
  }
  // Lloyd iterations.
  const assign = new Uint8Array(S);
  for (let it = 0; it < 14; it++) {
    for (let s = 0; s < S; s++) assign[s] = nearest(sample, s * 3, centers, k);
    const sum = new Float64Array(k * 3);
    const cnt = new Float64Array(k);
    for (let s = 0; s < S; s++) {
      const c = assign[s];
      sum[c * 3] += sample[s * 3];
      sum[c * 3 + 1] += sample[s * 3 + 1];
      sum[c * 3 + 2] += sample[s * 3 + 2];
      cnt[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (!cnt[c]) continue;
      centers[c * 3] = sum[c * 3] / cnt[c];
      centers[c * 3 + 1] = sum[c * 3 + 1] / cnt[c];
      centers[c * 3 + 2] = sum[c * 3 + 2] / cnt[c];
    }
  }
  // Representative sRGB colour per cluster: mean of its sampled pixels.
  const rgbSum = new Float64Array(k * 3);
  const rgbCnt = new Float64Array(k);
  for (let s = 0; s < S; s++) {
    const c = nearest(sample, s * 3, centers, k);
    rgbSum[c * 3] += sampleRgb[s][0];
    rgbSum[c * 3 + 1] += sampleRgb[s][1];
    rgbSum[c * 3 + 2] += sampleRgb[s][2];
    rgbCnt[c]++;
  }
  // Label every pixel.
  const labels = new Uint8Array(n);
  const areas = new Array<number>(k).fill(0);
  const lab = new Float32Array(3);
  const cache = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = pixel(img, i);
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    let l = cache.get(key);
    if (l === undefined) {
      labOf(c[0], c[1], c[2], lab, 0);
      l = nearest(lab, 0, centers, k);
      if (cache.size < 200000) cache.set(key, l);
    }
    labels[i] = l;
    areas[l]++;
  }
  // Order by area (largest first) and drop empty clusters.
  const order = Array.from({ length: k }, (_, i) => i)
    .filter((i) => areas[i] > 0)
    .sort((a, b) => areas[b] - areas[a]);
  const remap = new Uint8Array(k);
  order.forEach((old, idx) => (remap[old] = idx));
  for (let i = 0; i < n; i++) labels[i] = remap[labels[i]];
  const colors: RGB[] = order.map((c) =>
    rgbCnt[c]
      ? [Math.round(rgbSum[c * 3] / rgbCnt[c]), Math.round(rgbSum[c * 3 + 1] / rgbCnt[c]), Math.round(rgbSum[c * 3 + 2] / rgbCnt[c])]
      : labToRgbApprox(centers, c * 3),
  );
  return { colors, labels, areas: order.map((c) => areas[c]) };
}

function d2(a: Float32Array, ao: number, b: Float32Array, bo: number): number {
  const x = a[ao] - b[bo], y = a[ao + 1] - b[bo + 1], z = a[ao + 2] - b[bo + 2];
  return x * x + y * y + z * z;
}

function nearest(a: Float32Array, ao: number, centers: Float32Array, k: number): number {
  let best = 0, bd = Infinity;
  for (let c = 0; c < k; c++) {
    const d = d2(a, ao, centers, c * 3);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Fallback for a cluster that ended up with no samples (rare): grey from its lightness. */
function labToRgbApprox(centers: Float32Array, o: number): RGB {
  const v = Math.round(Math.max(0, Math.min(100, centers[o])) * 2.55);
  return [v, v, v];
}

export function hex(c: RGB): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** Mask (0 or 255) of pixels whose palette rank is at least `layer` (the stacked layer). */
export function stackedLayerField(p: Palette, layer: number): Float32Array {
  const out = new Float32Array(p.labels.length);
  for (let i = 0; i < out.length; i++) out[i] = p.labels[i] >= layer ? 255 : 0;
  return out;
}

/** Average colour of the image at the given points (flat x,y list), snapped to the nearest palette colour. */
export function colorAt(img: RgbaImage, pts: number[], palette: RGB[]): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const x = Math.round(pts[i]), y = Math.round(pts[i + 1]);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const c = pixel(img, y * img.width + x);
    r += c[0];
    g += c[1];
    b += c[2];
    n++;
  }
  if (!n) return hex(palette[0] ?? [0, 0, 0]);
  const avg: RGB = [r / n, g / n, b / n];
  let best = palette[0], bd = Infinity;
  for (const c of palette) {
    const d = (c[0] - avg[0]) ** 2 + (c[1] - avg[1]) ** 2 + (c[2] - avg[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return hex(best);
}
