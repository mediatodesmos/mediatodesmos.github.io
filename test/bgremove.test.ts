import { describe, expect, it } from 'vitest';
import { plainBackground } from '../src/pipeline/bgremove';
import type { RgbaImage } from '../src/pipeline/types';

function img(w: number, h: number, at: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      [data[p], data[p + 1], data[p + 2]] = at(x, y);
      data[p + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('plain background removal', () => {
  it('removes a flat background reached from the edges and keeps the subject', () => {
    // Off-white background with slight noise, a dark ring with a white inside (the hole is not reachable from the edge).
    const im = img(60, 40, (x, y) => {
      const d = Math.hypot(x - 30, y - 20);
      if (d < 12 && d > 6) return [30, 30, 40];
      if (d <= 6) return [250, 250, 250];
      return [245 + ((x * 7 + y) % 5), 243, 240];
    });
    const m = plainBackground(im, 15);
    expect(m.alpha[0]).toBe(0);
    expect(m.alpha[59]).toBe(0);
    expect(m.alpha[20 * 60 + 30 - 9]).toBe(255); // on the ring
    expect(m.alpha[20 * 60 + 30]).toBe(255); // inside the ring: enclosed, kept
  });

  it('keeps everything when the edges are not one colour within tolerance', () => {
    const im = img(20, 20, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255]));
    const m = plainBackground(im, 5);
    const kept = m.alpha.filter((v) => v === 255).length;
    expect(kept).toBeGreaterThan(150); // only one colour's half is removed
    expect(kept).toBeLessThan(400);
  });
});
