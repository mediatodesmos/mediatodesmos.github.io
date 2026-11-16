/**
 * Canny edge detection: Gaussian blur -> Sobel gradient -> non-maximum
 * suppression -> hysteresis. Returns a thin binary edge map (1 = edge).
 */

import { gaussianBlur } from './image';

export interface CannyOptions {
  /** Gaussian sigma (px). */
  sigma: number;
  /** 0..100: higher keeps more (weaker) edges. */
  detail: number;
}

export interface CannyResult {
  edges: Uint8Array;
  high: number;
  low: number;
}

export function canny(gray: Float32Array, w: number, h: number, opts: CannyOptions): CannyResult {
  const n = w * h;
  const blurred = gaussianBlur(gray, w, h, Math.max(0.6, opts.sigma));
  const mag = new Float32Array(n);
  const dir = new Uint8Array(n); // 0: horizontal grad (vertical edge), 1: 45deg, 2: vertical grad, 3: 135deg

  const TAN22 = 0.41421356; // tan(22.5deg)
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w;
    const y0 = y * w;
    const yp = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const a = blurred[ym + xm], b = blurred[ym + x], c = blurred[ym + xp];
      const d = blurred[y0 + xm], f = blurred[y0 + xp];
      const g = blurred[yp + xm], hh = blurred[yp + x], k = blurred[yp + xp];
      const gx = c + 2 * f + k - (a + 2 * d + g);
      const gy = g + 2 * hh + k - (a + 2 * b + c);
      const i = y0 + x;
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      const ax = gx < 0 ? -gx : gx, ay = gy < 0 ? -gy : gy;
      if (ay <= ax * TAN22) dir[i] = 0;
      else if (ax <= ay * TAN22) dir[i] = 2;
      else dir[i] = gx * gy > 0 ? 1 : 3;
    }
  }

  // Non-maximum suppression.
  const nms = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m === 0) continue;
      let m1: number, m2: number;
      switch (dir[i]) {
        case 0:
          m1 = mag[i - 1];
          m2 = mag[i + 1];
          break;
        case 2:
          m1 = mag[i - w];
          m2 = mag[i + w];
          break;
        case 1: // gradient along +x+y (y down): neighbours down-right and up-left
          m1 = mag[i - w - 1];
          m2 = mag[i + w + 1];
          break;
        default:
          m1 = mag[i - w + 1];
          m2 = mag[i + w - 1];
      }
      // Strict on one side so plateaus keep a single pixel.
      if (m > m1 && m >= m2) nms[i] = m;
    }
  }

  // Thresholds relative to a robust maximum edge strength (99th percentile of
  // candidates), so clean artwork and noisy photos both behave: thin strokes
  // in line art are weaker than big silhouettes but still well above noise.
  const FLOOR = 18; // ignore sensor/JPEG noise (Sobel magnitude on 0..255 data)
  const detail = Math.min(100, Math.max(0, opts.detail)) / 100;
  // Histogram of candidate magnitudes (0..1100 covers Sobel on 0..255 data).
  const BINS = 1100;
  const hist = new Uint32Array(BINS + 1);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const m = nms[i];
    if (m > FLOOR) {
      hist[Math.min(BINS, Math.floor(m))]++;
      count++;
    }
  }
  let high: number;
  if (count === 0) {
    high = Infinity;
  } else {
    let acc = 0;
    let robustMax = BINS;
    const target = count * 0.99;
    for (let b = 0; b <= BINS; b++) {
      acc += hist[b];
      if (acc >= target) {
        robustMax = b;
        break;
      }
    }
    // 60% of the robust max at detail 0, 5% at detail 100.
    high = Math.max(FLOOR * 1.5, robustMax * (0.6 - detail * 0.55));
  }
  const low = Math.max(FLOOR, high * 0.45);

  // Hysteresis: grow strong edges through weak ones (8-connected).
  const edges = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (nms[i] >= high && !edges[i]) {
      edges[i] = 1;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w;
        const py = (p - px) / w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx;
            if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
            const q = yy * w + xx;
            if (!edges[q] && nms[q] >= low) {
              edges[q] = 1;
              stack.push(q);
            }
          }
        }
      }
    }
  }
  return { edges, high, low };
}
