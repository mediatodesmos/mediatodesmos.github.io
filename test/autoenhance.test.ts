import { describe, expect, it } from 'vitest';
import { autoEnhance } from '../src/pipeline/autoenhance';
import { trace } from '../src/pipeline/trace';
import { DEFAULT_SETTINGS, type RgbaImage, type TraceSettings } from '../src/pipeline/types';
import { cleanliness, reference } from '../src/pipeline/metrics';

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

  it('runs one step at a time: resolution, smoothing, detail, budget', async () => {
    const start = { ...DEFAULT_SETTINGS, mode: 'outline' as const, lineSource: 'edges' as const, resolution: 160 };
    const order: string[] = [];
    const out = await autoEnhance(start, {
      mode: 'max',
      run: async (img, s) => trace(img, s),
      imageAt: async (r) => picture(r),
      maxResolution: 640,
      maxBudget: 2000,
      onProgress: (p) => {
        if (order[order.length - 1] !== p.label) order.push(p.label);
      },
    });
    expect(order).toEqual(['Resolution', 'Smoothing', 'Detail', 'Budget']);
    expect(out.steps.map((s) => s.label)).toEqual(order);
    for (const st of out.steps) for (const c of st.changes) expect(c).toMatch(/^[A-Z][a-z ]+ \S+/);
  }, 60000);

  it('stops walking up the resolutions once they stop helping', async () => {
    const seen: number[] = [];
    // A trace that ignores resolution: the score is flat, so the walk stops after two flat steps.
    await autoEnhance({ ...DEFAULT_SETTINGS, mode: 'outline' as const, lineSource: 'edges' as const, resolution: 320 }, {
      mode: 'max',
      run: async (_img, s: TraceSettings) => {
        seen.push(s.resolution);
        return trace(picture(320), { ...s, resolution: 320 });
      },
      imageAt: async () => picture(320),
      maxResolution: 1920,
      maxBudget: 2000,
    });
    expect(seen).not.toContain(1920);
    expect(seen).not.toContain(1600);
  }, 60000);

  it('scores videos as the mean over several frames', async () => {
    const asked = new Set<number>();
    let runs = 0;
    const out = await autoEnhance({ ...DEFAULT_SETTINGS, mode: 'outline' as const, lineSource: 'edges' as const, resolution: 160, budget: 400 }, {
      mode: 'optimize',
      frames: 3,
      run: async (img, s) => {
        runs++;
        return trace(img, s);
      },
      imageAt: async (r, f) => {
        asked.add(f);
        return picture(r);
      },
      maxResolution: 320,
      maxBudget: 1000,
    });
    expect([...asked].sort()).toEqual([0, 1, 2]);
    // Each candidate is traced once per frame; `tried` counts candidates.
    expect(runs).toBe(out.tried * 3);
  }, 60000);
});

describe('cleanliness', () => {
  it('prefers a smooth fill over a speckled one', () => {
    const img = picture(200);
    const ref = reference(img);
    const smooth = trace(img, { ...DEFAULT_SETTINGS, mode: 'fill', resolution: 200, minSize: 4 });
    const speckled = { ...smooth, shapes: [...smooth.shapes] };
    for (let i = 0; i < 300; i++) {
      const x = (i * 37) % 190, y = (i * 53) % 110;
      speckled.shapes.push({ kind: 'region', id: 1000 + i, rings: [[x, y, x + 2, y, x + 2, y + 2, x, y + 2]], area: 4, bbox: [x, y, x + 2, y + 2] });
    }
    expect(cleanliness(smooth, ref)).toBeGreaterThan(cleanliness(speckled, ref));
  });
});
