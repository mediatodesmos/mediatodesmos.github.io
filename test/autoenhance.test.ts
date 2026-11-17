import { describe, expect, it } from 'vitest';
import { autoEnhance } from '../src/pipeline/autoenhance';
import { trace } from '../src/pipeline/trace';
import { DEFAULT_SETTINGS, type RgbaImage } from '../src/pipeline/types';

/** A test picture at any resolution: two rings and a bar, black on white. */
function picture(longSide: number): RgbaImage {
  const w = longSide, h = Math.round(longSide * 0.6);
  const data = new Uint8ClampedArray(w * h * 4);
  const s = w / 100;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x / s, Y = y / s;
      const d1 = Math.hypot(X - 30, Y - 30), d2 = Math.hypot(X - 70, Y - 30);
      const ink = (d1 > 12 && d1 < 15) || (d2 > 6 && d2 < 8) || (Y > 50 && Y < 53 && X > 10 && X < 90);
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = ink ? 0 : 255;
      data[p + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('Auto Enhance', () => {
  it('finds settings at least as accurate as the starting ones, and respects the limits', async () => {
    // Start from deliberately poor settings: very coarse and over-smoothed.
    const start = { ...DEFAULT_SETTINGS, mode: 'outline' as const, lineSource: 'edges' as const, resolution: 120, smoothing: 2.5, minSize: 12, budget: 60 };
    let steps = 0;
    const out = await autoEnhance(start, {
      mode: 'max',
      run: async (img, s) => trace(img, s),
      imageAt: async (r) => picture(r),
      maxResolution: 480,
      maxBudget: 2000,
      onProgress: () => steps++,
    });
    expect(out.after).toBeGreaterThan(out.before);
    expect(out.settings.resolution).toBeLessThanOrEqual(480);
    expect(out.settings.budget).toBeLessThanOrEqual(2000);
    expect(out.tried).toBeGreaterThan(5);
    expect(steps).toBeGreaterThan(1);
  }, 60000);

  it('optimize mode stops short of very heavy graphs and can be cancelled', async () => {
    const start = { ...DEFAULT_SETTINGS, mode: 'outline' as const, lineSource: 'edges' as const, resolution: 160, budget: 300 };
    let calls = 0;
    const out = await autoEnhance(start, {
      mode: 'optimize',
      run: async (img, s) => {
        calls++;
        return trace(img, s);
      },
      imageAt: async (r) => picture(r),
      maxResolution: 480,
      maxBudget: 4000,
      targetMs: 30,
      cancelled: () => calls > 6,
    });
    expect(out.after).toBeGreaterThan(0);
    expect(calls).toBeLessThan(20);
  }, 60000);
});
