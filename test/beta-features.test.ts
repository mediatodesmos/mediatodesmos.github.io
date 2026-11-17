import { describe, expect, it } from 'vitest';
import { adjustColor, adjustPalette, autoColors, hex, parseHex, quantize } from '../src/pipeline/color';
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
  it('quantizes a three-colour picture into its three colours, light to dark', () => {
    const img = colorImage(90, 60, scene);
    const p = quantize(img, 3);
    expect(p.colors.length).toBe(3);
    const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 12);
    // Stacked layers go light to dark: yellow, red, blue.
    expect(close(p.colors[0], YELLOW)).toBe(true);
    expect(close(p.colors[1], RED)).toBe(true);
    expect(close(p.colors[2], BLUE)).toBe(true);
    expect(hex([255, 0, 16])).toBe('#ff0010');
  });

  it('folds colours that cover almost nothing into a neighbour', () => {
    // A 2-pixel green speck on a red/blue picture: asking for 3 colours keeps only 2.
    const img = colorImage(90, 60, (x, y) => (x === 5 && y < 2 ? [20, 200, 40] : x < 45 ? RED : BLUE));
    const p = quantize(img, 3);
    expect(p.colors.length).toBe(2);
  });

  it('Auto Color picks about as many colours as the picture has', () => {
    const three = autoColors(colorImage(90, 60, scene));
    expect(three.k).toBe(3);
    const six = autoColors(
      colorImage(120, 60, (x) => [[230, 30, 30], [30, 160, 40], [30, 60, 220], [240, 220, 40], [250, 250, 250], [20, 20, 20]][Math.floor(x / 20)] as [number, number, number]),
    );
    expect(six.k).toBe(6);
    expect(three.saturation).toBeGreaterThanOrEqual(1);
    expect(three.saturation).toBeLessThanOrEqual(1.6);
  });

  it('adjusts saturation and brightness without moving the hue', () => {
    expect(adjustColor('#c04040', { saturation: 1, brightness: 0 })).toBe('#c04040');
    const grey = parseHex(adjustColor('#c04040', { saturation: 0, brightness: 0 }));
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThanOrEqual(1);
    const vivid = parseHex(adjustColor('#c06060', { saturation: 1.8, brightness: 0 }));
    expect(vivid[0]).toBeGreaterThan(vivid[1] + 100); // still red, and redder
    const light = parseHex(adjustColor('#404040', { saturation: 1, brightness: 0.6 }));
    expect(light[0]).toBeGreaterThan(0x40 + 40);
    // Out-of-gamut boosts are pulled back, never clipped to a different hue.
    const pure = parseHex(adjustColor('#ff0000', { saturation: 2, brightness: 0 }));
    expect(pure[0]).toBeGreaterThan(200);
    expect(pure[1]).toBeLessThan(40);
    expect(adjustPalette(['#102030', '#ffffff'], { saturation: 1, brightness: 0 }, { 1: '#123456' })).toEqual(['#102030', '#123456']);
  });

  it('detail brush keeps what it covers when the budget is tight', () => {
    // A big disk and a small one; the budget only has room for one of them.
    const img = colorImage(120, 60, (x, y) => (Math.hypot(x - 35, y - 30) < 20 || Math.hypot(x - 95, y - 30) < 9 ? [0, 0, 0] : [255, 255, 255]));
    const base = settings({ mode: 'outline', lineSource: 'contours', blur: 0.6, minSize: 2 });
    const all = trace(img, { ...base, budget: 1000 });
    const strokes = all.shapes.filter((s) => s.kind === 'stroke');
    expect(strokes.length).toBe(2);
    const big = Math.max(...strokes.map((s) => (s.kind === 'stroke' ? s.segs.length / 8 : 0)));
    const plain = trace(img, { ...base, budget: big });
    const cx = (r: typeof plain) => r.shapes.map((s) => (s.bbox[0] + s.bbox[2]) / 2);
    expect(cx(plain).every((x) => x < 60)).toBe(true); // the big disk wins on its own
    const detail = new Uint8Array(120 * 60);
    for (let y = 0; y < 60; y++) for (let x = 80; x < 120; x++) detail[y * 120 + x] = 1;
    const painted = trace(img, { ...base, budget: big, detail });
    expect(cx(painted).some((x) => x > 60)).toBe(true); // the painted small disk is kept
  });

  it('records the palette and each shape’s palette index', () => {
    const img = colorImage(90, 60, scene);
    const res = trace(img, settings({ mode: 'fill', color: true, colors: 3, blur: 0 }));
    expect(res.palette?.length).toBe(3);
    for (const sh of res.shapes) if (sh.kind === 'region') expect(res.palette![sh.paletteIndex!]).toBe(sh.color);
    const auto = trace(img, settings({ mode: 'fill', color: true, colors: 12, autoColor: true, blur: 0 }));
    expect(auto.autoColor?.k).toBe(3);
    expect(auto.palette?.length).toBe(3);
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

describe('Sharpen & denoise and Line-art cleanup', () => {
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
