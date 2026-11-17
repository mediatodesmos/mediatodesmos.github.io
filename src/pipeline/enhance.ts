/**
 * Clean-up filters before tracing.
 *  - Super Enhanced (BETA): contrast stretch, gentle denoise and an unsharp
 *    mask, for detailed high-resolution traces.
 *  - Line-art cleanup (BETA): a median filter that removes manga screentone
 *    dots, and gap closing on the ink map so broken lines join up.
 */

import { gaussianBlur } from './image';

/** Stretch luminance so the 1st..99th percentiles span the full 0..255 range. */
export function stretchContrast(gray: Float32Array): Float32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
  const lowCount = gray.length * 0.01, highCount = gray.length * 0.99;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lowCount) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= highCount) {
      hi = v;
      break;
    }
  }
  if (hi - lo < 16) return gray;
  const out = new Float32Array(gray.length);
  const k = 255 / (hi - lo);
  for (let i = 0; i < gray.length; i++) out[i] = Math.max(0, Math.min(255, (gray[i] - lo) * k));
  return out;
}

/** 3x3 median filter (clamped edges). */
export function median3(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(gray.length);
  const win = new Float32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          win[n++] = gray[yy * w + xx];
        }
      }
      // Partial insertion sort is plenty for 9 values.
      for (let i = 1; i < 9; i++) {
        const v = win[i];
        let j = i - 1;
        while (j >= 0 && win[j] > v) {
          win[j + 1] = win[j];
          j--;
        }
        win[j + 1] = v;
      }
      out[y * w + x] = win[4];
    }
  }
  return out;
}

/** Unsharp mask: gray + amount * (gray - blur(gray)). */
export function unsharp(gray: Float32Array, w: number, h: number, sigma: number, amount: number): Float32Array {
  const blur = gaussianBlur(gray, w, h, sigma);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = Math.max(0, Math.min(255, gray[i] + amount * (gray[i] - blur[i])));
  return out;
}

/** Super Enhanced preprocessing for high-resolution traces. */
export function enhanceGray(gray: Float32Array, w: number, h: number): Float32Array {
  return unsharp(median3(stretchContrast(gray), w, h), w, h, 1.0, 0.6);
}

/** Morphological closing (dilate then erode, square radius r) on a 0/1 mask. */
export function closeGaps(mask: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  const dil = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -r; dy <= r && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && mask[yy * w + xx]) {
            on = 1;
            break;
          }
        }
      }
      dil[y * w + x] = on;
    }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          if (!dil[yy * w + xx]) {
            all = 0;
            break;
          }
        }
      }
      out[y * w + x] = all;
    }
  return out;
}
