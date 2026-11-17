/** Pixel-level helpers: grayscale, blur, histogram, threshold. Pure functions on typed arrays. */

import type { RgbaImage } from './types';

/**
 * Luminance (0..255) per pixel, alpha-composited over white so transparent
 * PNG backgrounds read as "paper".
 */
export function toGray(img: RgbaImage): Float32Array {
  const { data, width, height } = img;
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = data[p + 3] / 255;
    const lum = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    out[i] = a * lum + (1 - a) * 255;
  }
  return out;
}

/** Separable Gaussian blur with clamped edges. sigma <= 0 returns a copy. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (!(sigma > 0.05)) return src.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let xx = x + k;
        if (xx < 0) xx = 0;
        else if (xx >= w) xx = w - 1;
        acc += src[row + xx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let yy = y + k;
        if (yy < 0) yy = 0;
        else if (yy >= h) yy = h - 1;
        acc += tmp[yy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

export function histogram(gray: Float32Array): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    let v = Math.round(gray[i]);
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    hist[v]++;
  }
  return hist;
}

/** Otsu's method: the threshold that maximises between-class variance. */
export function otsu(hist: number[]): number {
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  if (total === 0) return 128;
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let lo = 127;
  let hi = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    sumB += t * hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best * (1 + 1e-9)) {
      best = between;
      lo = hi = t;
    } else if (between >= best * (1 - 1e-9)) {
      hi = t; // plateau: same split for a range of t (e.g. pure black-and-white art)
    }
  }
  // The split sits between t and t+1; on a plateau take its middle.
  return (lo + hi) / 2 + 0.5;
}

/** 1 where the pixel is foreground (dark unless inverted). */
export function binarize(gray: Float32Array, threshold: number, invert: boolean): Uint8Array {
  const out = new Uint8Array(gray.length);
  if (invert) {
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] > threshold ? 1 : 0;
  } else {
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] < threshold ? 1 : 0;
  }
  return out;
}

/** Fraction of pixels that are foreground. */
export function coverage(bin: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bin.length; i++) n += bin[i];
  return bin.length ? n / bin.length : 0;
}

export function toPreview(bin: Uint8Array): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin[i] ? 255 : 0;
  return out;
}

/** Share of pixels whose tone matches their 5x5 neighbourhood: high for drawings/anime, low for photos. */
export function flatness(img: RgbaImage): number {
  const g = toGray(img);
  const { width: w, height: h } = img;
  // 5x5 box mean via running sums (kept local to avoid a module cycle with ink.ts).
  const r = 2;
  let flat = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += g[yy * w + xx];
          n++;
        }
      }
      if (Math.abs(g[y * w + x] - s / n) < 2.5) flat++;
    }
  }
  return flat / (w * h);
}

/** True when the picture looks like a drawing, comic or anime frame rather than a photo. */
export function looksLikeDrawing(img: RgbaImage): boolean {
  if (flatness(img) <= 0.4) return false;
  // Drawings sit on light paper; full-colour anime scenes and photos mostly do not.
  const g = toGray(img);
  let bright = 0;
  for (let i = 0; i < g.length; i++) if (g[i] > 215) bright++;
  return bright / g.length > 0.25;
}

/** A tiny 32x18 luminance thumbnail, for spotting repeated (held) video frames. */
export function frameSignature(img: RgbaImage): Float32Array {
  const SW = 32, SH = 18;
  const out = new Float32Array(SW * SH);
  const cnt = new Float32Array(SW * SH);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(SH - 1, Math.floor((y * SH) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(SW - 1, Math.floor((x * SW) / w));
      const p = (y * w + x) * 4;
      out[sy * SW + sx] += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
      cnt[sy * SW + sx]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= cnt[i] || 1;
  return out;
}

/** Mean absolute difference between two signatures (0..255). */
export function signatureDiff(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

/** Otsu threshold of an RGBA image (for steadying video thresholds frame to frame). */
export function imageOtsu(img: RgbaImage): number {
  return otsu(histogram(toGray(img)));
}
