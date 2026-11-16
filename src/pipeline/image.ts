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
