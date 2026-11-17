import { describe, expect, it } from 'vitest';
import { quantize, hex } from '../src/pipeline/color';
import { closeGaps, median3, stretchContrast } from '../src/pipeline/enhance';
import { trace } from '../src/pipeline/trace';
import { buildImageGraph } from '../src/desmos/build';
import { DEFAULT_SETTINGS, type RgbaImage, type TraceSettings } from '../src/pipeline/types';

const settings = (o: Partial<TraceSettings>): TraceSettings => ({ ...DEFAULT_SETTINGS, ...o });

function colorImage(w: number, h: number, at: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const p = (y * w + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  return { width: w, height: h, data };
}

const BLUE: [number, number, number] = [30, 60, 200];
const RED: [number, number, number] = [220, 30, 30];
const YELLOW: [number, number, number] = [240, 220, 40];
const scene = (x: number, y: number): [number, number, number] =>
  (x - 30) ** 2 + (y - 30) ** 2 < 15 ** 2 ? RED : x > 60 && y > 15 && y < 45 ? YELLOW : BLUE;

describe('In Color (BETA)', () => {
  it('quantizes a three-colour picture into its three colours, largest first', () => {
    const img = colorImage(90, 60, scene);
    const p = quantize(img, 3);
    expect(p.colors.length).toBe(3);
    expect(p.areas[0]).toBeGreaterThanOrEqual(p.areas[1]);
    expect(p.areas[1]).toBeGreaterThanOrEqual(p.areas[2]);
    const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 12);
    expect(close(p.colors[0], BLUE)).toBe(true);
    expect(p.colors.some((c) => close(c, RED))).toBe(true);
    expect(p.colors.some((c) => close(c, YELLOW))).toBe(true);
    expect(hex([255, 0, 16])).toBe('#ff0010');
  });

  it('fill traces stacked colour layers drawn bottom to top', () => {
    const img = colorImage(90, 60, scene);
    const res = trace(img, settings({ mode: 'fill', color: true, colors: 3, blur: 0 }));
    const regions = res.shapes.filter((s) => s.kind === 'region');
    expect(regions.length).toBeGreaterThanOrEqual(3);
    // Background rectangle first, then layers in ascending order.
    expect(regions[0].kind === 'region' && regions[0].layer).toBe(0);
    for (let i = 1; i < regions.length; i++) {
      const a = regions[i - 1], b = regions[i];
      if (a.kind === 'region' && b.kind === 'region') expect(b.layer ?? 0).toBeGreaterThanOrEqual(a.layer ?? 0);
    }
    expect(regions.every((r) => r.kind === 'region' && /^#[0-9a-f]{6}$/.test(r.color ?? ''))).toBe(true);
    // Desmos expressions carry the colours.
    const g = buildImageGraph(res, { strokeWidth: 2, notes: false });
    const colors = new Set(g.state.expressions.list.filter((e) => e.type === 'expression').map((e) => (e.type === 'expression' ? e.color : '')));
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });

  it('outline strokes take the colour under them', () => {
    const img = colorImage(90, 60, scene);
    const res = trace(img, settings({ mode: 'outline', lineSource: 'edges', color: true, colors: 3 }));
    expect(res.shapes.length).toBeGreaterThan(0);
    for (const sh of res.shapes) expect(sh.kind === 'stroke' && /^#[0-9a-f]{6}$/.test(sh.color ?? '')).toBe(true);
  });

  it('is off by default (black ink)', () => {
    const img = colorImage(90, 60, scene);
    const res = trace(img, settings({ mode: 'fill' }));
    expect(res.shapes.every((s) => s.kind !== 'region' || s.color === undefined)).toBe(true);
  });
});

describe('Super Enhanced and Line-art cleanup (BETA)', () => {
  it('stretches a low-contrast picture to the full range', () => {
    const g = new Float32Array(1000);
    for (let i = 0; i < g.length; i++) g[i] = 100 + (i % 50);
    const out = stretchContrast(g);
    expect(Math.min(...out)).toBeLessThan(5);
    expect(Math.max(...out)).toBeGreaterThan(250);
  });

  it('median filter removes isolated screentone dots', () => {
    const w = 20, h = 20;
    const g = new Float32Array(w * h).fill(255);
    g[5 * w + 5] = 0;
    g[12 * w + 9] = 0;
    const out = median3(g, w, h);
    expect(Math.min(...out)).toBe(255);
  });

  it('closes a one-pixel gap in a line', () => {
    const w = 30, h = 9;
    const m = new Uint8Array(w * h);
    for (let x = 2; x < 28; x++) if (x !== 15) m[4 * w + x] = 1;
    const out = closeGaps(m, w, h, 1);
    expect(out[4 * w + 15]).toBe(1);
  });

  it('trace runs with every BETA option on', () => {
    const img = colorImage(80, 60, scene);
    for (const mode of ['outline', 'fill', 'fourier'] as const) {
      const res = trace(img, settings({ mode, lineSource: mode === 'outline' ? 'ink' : 'contours', color: true, colors: 4, enhance: true, lineCleanup: true }));
      expect(res.shapes.length).toBeGreaterThan(0);
    }
  });
});
