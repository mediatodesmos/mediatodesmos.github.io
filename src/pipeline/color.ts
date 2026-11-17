/**
 * In Color (BETA): k-means colour quantisation in CIE Lab, plus helpers to
 * colour traced shapes.
 *
 * Fill mode traces "stacked" layers: colours are ordered light to dark, layer 0 is a
 * full background rectangle, and layer i covers every pixel whose colour ranks
 * i or later. Each layer sits on top of the previous one, so neighbouring
 * colours never leave hairline gaps between them.
 */

import type { RgbaImage } from './types';

export type RGB = [number, number, number];

export interface Palette {
  /** Palette colours (sRGB 0..255), ordered light to dark. */
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

interface Samples {
  S: number;
  lab: Float32Array;
  rgb: RGB[];
}

function sampleImage(img: RgbaImage): Samples {
  const n = img.width * img.height;
  const rand = rng(7654321);
  const S = Math.min(n, 6000);
  const lab = new Float32Array(S * 3);
  const rgb: RGB[] = [];
  for (let s = 0; s < S; s++) {
    const i = S === n ? s : Math.floor(rand() * n);
    const c = pixel(img, i);
    rgb.push(c);
    labOf(c[0], c[1], c[2], lab, s * 3);
  }
  return { S, lab, rgb };
}

/** Mean colour distance (CIE76 delta E) from each sample to its nearest centre, and each cluster's share. */
function fitError(sm: Samples, centers: Float32Array, k: number): { err: number; shares: number[] } {
  let e = 0;
  const cnt = new Array<number>(k).fill(0);
  for (let s = 0; s < sm.S; s++) {
    const c = nearest(sm.lab, s * 3, centers, k);
    e += Math.sqrt(d2(sm.lab, s * 3, centers, c * 3));
    cnt[c]++;
  }
  return { err: e / sm.S, shares: cnt.map((v) => v / sm.S) };
}

export interface AutoColor {
  /** Number of colours picked. */
  k: number;
  /** Suggested saturation multiplier (cluster averages come out washed out). */
  saturation: number;
}

/**
 * Auto Color (BETA): how many colours does this picture need? Adds colours
 * while each one still lowers the average colour error noticeably and still
 * covers at least 1% of the picture; then suggests a saturation boost that
 * restores the vividness averaging takes away.
 */
export function autoColors(img: RgbaImage): AutoColor {
  const sm = sampleImage(img);
  let best = 2;
  let prev = Infinity;
  let bestCenters = kmeans(sm, 2);
  for (let k = 2; k <= 16; k++) {
    const centers = k === 2 ? bestCenters : kmeans(sm, k);
    const { err, shares } = fitError(sm, centers, k);
    const gain = prev - err;
    if (k > 2 && (gain < Math.max(0.55, prev * 0.06) || Math.min(...shares) < 0.01)) break;
    best = k;
    bestCenters = centers;
    prev = err;
  }
  // Merge near-duplicate colours (delta E under 6).
  let k = best;
  for (let a = 0; a < best; a++)
    for (let b = a + 1; b < best; b++) if (Math.sqrt(d2(bestCenters, a * 3, bestCenters, b * 3)) < 6) k--;
  k = Math.max(2, Math.min(16, k));
  return { k, saturation: saturationBoost(sm, kmeans(sm, k), k) };
}

/** How much more saturated each cluster's typical pixels are than its average colour (area-weighted, 1..1.6). */
function saturationBoost(sm: Samples, centers: Float32Array, k: number): number {
  const chroma: number[][] = Array.from({ length: k }, () => []);
  for (let s = 0; s < sm.S; s++) {
    const c = nearest(sm.lab, s * 3, centers, k);
    chroma[c].push(Math.hypot(sm.lab[s * 3 + 1], sm.lab[s * 3 + 2]));
  }
  let num = 0, den = 0;
  for (let c = 0; c < k; c++) {
    const list = chroma[c];
    if (list.length < 8) continue;
    const mean = Math.hypot(centers[c * 3 + 1], centers[c * 3 + 2]);
    if (mean < 4) continue; // greys stay grey
    list.sort((x, y) => x - y);
    const p75 = list[Math.floor(list.length * 0.75)];
    num += (p75 / mean) * list.length;
    den += list.length;
  }
  const r = den ? num / den : 1;
  return Math.round(Math.max(1, Math.min(1.6, r)) * 100) / 100;
}

/** k-means++ then Lloyd iterations on the samples (deterministic). */
function kmeans(sm: Samples, k: number): Float32Array {
  const { S, lab: sample } = sm;
  const rand = rng(1234567 + k);
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
  return centers;
}

/**
 * Reduce the picture to k colours. Layers are ordered light to dark, so each
 * stacked layer ("this colour or any darker one") is a smooth, nested shape,
 * like contour lines of brightness, and thin dark lines end up on top.
 * Colours covering under 0.3% of the picture are folded into their nearest
 * neighbour (they only add specks and equations).
 */
export function quantize(img: RgbaImage, k: number): Palette {
  const n = img.width * img.height;
  k = Math.max(2, Math.min(16, Math.round(k)));
  const sm = sampleImage(img);
  const { S, lab: sample, rgb: sampleRgb } = sm;
  const centers = kmeans(sm, k);
  // Fold tiny clusters into their nearest neighbour (by sample share).
  {
    const { shares } = fitError(sm, centers, k);
    const alive = shares.map((v) => v >= 0.003);
    if (alive.filter(Boolean).length >= 2) {
      for (let c = 0; c < k; c++) {
        if (alive[c]) continue;
        let best = -1, bd = Infinity;
        for (let o = 0; o < k; o++) {
          if (!alive[o] || o === c) continue;
          const d = d2(centers, c * 3, centers, o * 3);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        if (best >= 0) centers.set(centers.subarray(best * 3, best * 3 + 3), c * 3);
      }
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
  // Order light to dark and drop empty clusters (folded clusters share a centre, so they end up empty).
  const order = Array.from({ length: k }, (_, i) => i)
    .filter((i) => areas[i] > 0)
    .sort((a, b) => centers[b * 3] - centers[a * 3] || areas[b] - areas[a]);
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
  return hex(palette[colorIndexOf(n ? [r / n, g / n, b / n] : null, palette)] ?? [0, 0, 0]);
}

/** Palette index nearest to a colour (0 when there is no colour). */
function colorIndexOf(avg: RGB | null, palette: RGB[]): number {
  if (!avg) return 0;
  let best = 0, bd = Infinity;
  palette.forEach((c, i) => {
    const d = (c[0] - avg[0]) ** 2 + (c[1] - avg[1]) ** 2 + (c[2] - avg[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Like colorAt, but returns the palette index. */
export function colorIndexAt(img: RgbaImage, pts: number[], palette: RGB[]): number {
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
  return colorIndexOf(n ? [r / n, g / n, b / n] : null, palette);
}

/* ------------------------------------------------ saturation and brightness */

// OKLab (Bjorn Ottosson): perceptually even, so chroma and lightness edits look natural.
function toOklab(c: RGB): [number, number, number] {
  const r = LIN[Math.max(0, Math.min(255, Math.round(c[0])))], g = LIN[Math.max(0, Math.min(255, Math.round(c[1])))], b = LIN[Math.max(0, Math.min(255, Math.round(c[2])))];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab to linear sRGB (may be out of gamut). */
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const linearToSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function parseHex(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export interface ColorAdjust {
  /** Chroma multiplier: 0 is grey, 1 unchanged, 2 twice as vivid. */
  saturation: number;
  /** Lightness shift, -1..1 (about a quarter of the range at the ends). */
  brightness: number;
}

/**
 * Change a colour's saturation and brightness in OKLCH. Hue stays put; when a
 * boosted colour falls outside what screens can show, chroma is pulled back
 * until it fits instead of clipping (which would shift the hue).
 */
export function adjustColor(color: string, adj: ColorAdjust): string {
  if (adj.saturation === 1 && adj.brightness === 0) return color;
  const [L0, a0, b0] = toOklab(parseHex(color));
  const L = Math.max(0, Math.min(1, L0 + adj.brightness * 0.25));
  const C0 = Math.hypot(a0, b0);
  const h = Math.atan2(b0, a0);
  let C = C0 * Math.max(0, adj.saturation);
  let lin = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, mid * Math.cos(h), mid * Math.sin(h)))) lo = mid;
      else hi = mid;
    }
    C = lo;
    lin = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  }
  return hex(lin.map((v) => linearToSrgb(Math.max(0, Math.min(1, v)))) as RGB);
}

/** A palette with the global adjustment applied, then per-colour overrides (index -> #rrggbb) on top. */
export function adjustPalette(colors: string[], adj: ColorAdjust, overrides: Record<number, string> = {}): string[] {
  return colors.map((c, i) => overrides[i] ?? adjustColor(c, adj));
}
