import type { RgbaImage } from '../src/pipeline/types';

/** Make a white RGBA image and paint black where `ink(x, y)` is true (pixel centres). */
export function paint(w: number, h: number, ink: (x: number, y: number) => boolean): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const v = ink(x, y) ? 0 : 255;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

export const ring = (cx: number, cy: number, r1: number, r2: number) => (x: number, y: number) => {
  const d2 = (x - cx) ** 2 + (y - cy) ** 2;
  return d2 <= r2 * r2 && d2 >= r1 * r1;
};

export const rect = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;

export const union = (...fs: ((x: number, y: number) => boolean)[]) => (x: number, y: number) => fs.some((f) => f(x, y));
