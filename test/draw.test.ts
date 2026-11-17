import { describe, expect, it } from 'vitest';
import { floodFill, smoothPath } from '../src/screens/convert/draw/ops';

const imageData = (w: number, h: number, at: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = at(x, y);
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
};

describe('drawing tools', () => {
  it('fill bucket fills the enclosed area it starts in, and nothing past the outline', () => {
    // A white page with a black square outline from (5,5) to (14,14).
    const look = imageData(20, 20, (x, y) => ((x === 5 || x === 14) && y >= 5 && y <= 14) || ((y === 5 || y === 14) && x >= 5 && x <= 14) ? 0 : 255);
    const target = imageData(20, 20, () => 0);
    target.data.fill(0);
    floodFill(look, target, 9, 9, '#ff0000', 10);
    const at = (x: number, y: number) => [target.data[(y * 20 + x) * 4], target.data[(y * 20 + x) * 4 + 3]];
    expect(at(9, 9)).toEqual([255, 255]); // inside: red, opaque
    expect(at(6, 6)).toEqual([255, 255]);
    expect(at(2, 2)[1]).toBe(0); // outside stays empty
    expect(at(5, 9)[1]).toBe(255); // grown one pixel under the outline (no hairline gap)
    expect(at(4, 9)[1]).toBe(0);
  });

  it('smooths freehand strokes but keeps their ends', () => {
    const jagged = [0, 0, 1, 1, 2, 0, 3, 1, 4, 0];
    const s = smoothPath(jagged, 1);
    expect(s.slice(0, 2)).toEqual([0, 0]);
    expect(s.slice(-2)).toEqual([4, 0]);
    expect(Math.abs(s[3] - 0.5)).toBeLessThan(Math.abs(jagged[3] - 0.5));
  });
});
