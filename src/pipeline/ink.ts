/**
 * Ink-line extraction for drawings, comics and anime: a pixel is "ink" when it
 * is clearly darker than its surroundings (adaptive mean threshold over a
 * square window, using an integral image). Large flat dark areas (hair, shadows)
 * are not ink inside, only along their borders, so the result is thin line art
 * that thins to single centre lines instead of Canny's double edges.
 */

/** Mean of each pixel's (2r+1)^2 neighbourhood, clamped at the borders. */
export function boxMean(gray: Float32Array, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * W + (x + 1)] = integral[y * W + (x + 1)] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

export interface InkOptions {
  /** Window radius in px (scale with resolution). */
  radius: number;
  /** 0..100: higher keeps fainter lines. */
  detail: number;
  /** Treat light lines on dark paper as ink. */
  invert: boolean;
}

export function inkMap(gray: Float32Array, w: number, h: number, o: InkOptions): Uint8Array {
  const mean = boxMean(gray, w, h, Math.max(2, Math.round(o.radius)));
  // How much darker than the surroundings a pixel must be: 34 levels at detail 0, 5 at detail 100.
  const offset = 34 - (Math.min(100, Math.max(0, o.detail)) / 100) * 29;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const d = o.invert ? gray[i] - mean[i] : mean[i] - gray[i];
    out[i] = d > offset ? 1 : 0;
  }
  return out;
}

/** Remove 8-connected components smaller than minArea pixels (in place). Returns the mask. */
export function removeSmallComponents(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  if (minArea <= 1) return mask;
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  const members: number[] = [];
  let next = 1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    members.length = 0;
    stack.push(i);
    label[i] = next;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      const px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !label[q]) {
            label[q] = next;
            stack.push(q);
          }
        }
      }
    }
    if (members.length < minArea) for (const p of members) mask[p] = 0;
    next++;
  }
  return mask;
}
