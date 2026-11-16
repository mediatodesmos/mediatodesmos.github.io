import { describe, expect, it } from 'vitest';
import { bezierLatex, list, num, polygonLatex, UNDEF } from '../src/desmos/latex';
import { bridgedPath, buildImageGraph, fourierColumns, positionWords } from '../src/desmos/build';
import { buildVideoGraph, CHUNK_CAP } from '../src/desmos/video';
import { trace } from '../src/pipeline/trace';
import { fourierAt } from '../src/pipeline/fourier';
import { DEFAULT_SETTINGS, type FourierShape, type TraceResult, type TraceSettings } from '../src/pipeline/types';
import { disk, paint, rect, ring, union } from './helpers';

const settings = (o: Partial<TraceSettings>): TraceSettings => ({ ...DEFAULT_SETTINGS, ...o });

/** Shoelace area with the nonzero rule approximated by signed area sum (bridges cancel). */
function signedArea(pts: number[]): number {
  let a = 0;
  const m = pts.length / 2;
  for (let i = 0, j = m - 1; i < m; j = i++) a += pts[2 * j] * pts[2 * i + 1] - pts[2 * i] * pts[2 * j + 1];
  return a / 2;
}

describe('latex helpers', () => {
  it('formats numbers compactly', () => {
    expect(num(12)).toBe('12');
    expect(num(12.345)).toBe('12.3');
    expect(num(-0.04)).toBe('0');
    expect(num(NaN)).toBe(UNDEF);
    expect(num(1.23456, 3)).toBe('1.235');
  });

  it('never writes a list literal directly after an expression (Desmos would index it)', () => {
    const l = list([1, 2]);
    const latex = bezierLatex(l, l, l, l, l, l, l, l);
    // every list literal must be preceded by \cdot
    const idx = [...latex.matchAll(/\\left\[/g)].map((m) => m.index!);
    for (const i of idx) expect(latex.slice(0, i).trimEnd().endsWith('\\cdot')).toBe(true);
    expect(polygonLatex('X', 'Y')).toBe('\\operatorname{polygon}\\left(\\left(X,Y\\right)\\right)');
  });

  it('never glues \\cdot to a letter (Desmos reads "\\cdotX" as an unknown command)', () => {
    const v = bezierLatex('X_{a1}', 'X_{b1}', 'X_{c1}', 'X_{d1}', 'Y_{a1}', 'Y_{b1}', 'Y_{c1}', 'Y_{d1}');
    expect(v).not.toMatch(/\\cdot[A-Za-z]/);
    expect(v).toContain('\\cdot X_{a1}');
  });
});

describe('bridged polygons', () => {
  it('keeps the net area of outer minus holes (bridges add nothing)', () => {
    const outer = [0, 0, 10, 0, 10, 10, 0, 10];
    const hole = [3, 3, 7, 3, 7, 7, 3, 7]; // given ccw, must be flipped to cw
    const path = bridgedPath([
      { pts: outer, hole: false },
      { pts: hole, hole: true },
    ]);
    expect(signedArea(path)).toBeCloseTo(100 - 16, 6);
  });

  it('handles islands inside holes and several regions', () => {
    const path = bridgedPath([
      { pts: [0, 0, 10, 0, 10, 10, 0, 10], hole: false },
      { pts: [3, 3, 3, 7, 7, 7, 7, 3], hole: true },
      { pts: [4, 4, 6, 4, 6, 6, 4, 6], hole: false },
      { pts: [20, 0, 25, 0, 25, 5, 20, 5], hole: false },
    ]);
    expect(signedArea(path)).toBeCloseTo(100 - 16 + 4 + 25, 6);
  });
});

describe('image graph', () => {
  it('builds one expression per shape with valid styling', () => {
    const img = paint(80, 60, union(disk(20, 30, 10), ring(55, 30, 6, 14)));
    const res = trace(img, settings({ mode: 'fill', blur: 0 }));
    const g = buildImageGraph(res, { strokeWidth: 2, notes: true, name: 'Test' });
    const exprs = g.state.expressions.list.filter((e) => e.type === 'expression');
    expect(exprs.length).toBe(res.shapes.length);
    expect(g.entries.length).toBe(res.shapes.length);
    for (const e of exprs) {
      if (e.type !== 'expression') continue;
      expect(e.latex.startsWith('\\operatorname{polygon}')).toBe(true);
      expect(e.fillOpacity).toBe('1');
      expect(e.color).toBe('#000000');
    }
    expect(g.state.version).toBe(11);
    expect(g.state.graph.showGrid).toBe(false);
    expect(g.bytes).toBeGreaterThan(100);
    // notes on: a text item per shape plus the header
    expect(g.state.expressions.list.filter((e) => e.type === 'text').length).toBe(res.shapes.length + 1);
  });

  it('outline graph uses broadcast Bezier expressions', () => {
    const img = paint(60, 60, rect(10, 10, 49, 49));
    const res = trace(img, settings({ mode: 'outline', lineSource: 'contours', blur: 0.8 }));
    const g = buildImageGraph(res, { strokeWidth: 2, notes: false });
    const e = g.state.expressions.list.find((x) => x.type === 'expression');
    expect(e && e.type === 'expression' && e.latex.includes('\\left(1-t\\right)^{3}\\cdot \\left[')).toBe(true);
    expect(g.entries[0].explain.length).toBeGreaterThan(50);
  });

  it('flips Fourier coefficients into Desmos coordinates', () => {
    const sh: FourierShape = { kind: 'fourier', id: 1, closed: true, freq: [0, 1], re: [10, 5], im: [20, 0], length: 1, error: 0, bbox: [0, 0, 1, 1] };
    const H = 100;
    const c = fourierColumns(sh, H);
    for (const t of [0, 0.1, 0.37, 0.8]) {
      const [x, y] = fourierAt(sh, t);
      const [X, Y] = fourierAt({ freq: c.k, re: c.re, im: c.im }, t);
      expect(X).toBeCloseTo(x, 9);
      expect(Y).toBeCloseTo(H - y, 9);
    }
  });

  it('describes positions in words', () => {
    expect(positionWords([0, 0, 10, 10], 100, 100)).toBe('top-left');
    expect(positionWords([45, 45, 55, 55], 100, 100)).toBe('centre');
    expect(positionWords([80, 40, 95, 60], 100, 100)).toBe('right side');
  });
});

describe('video graph', () => {
  const frame = (shapesCount: number, segsPer: number, mode: 'outline' | 'fill' = 'outline'): TraceResult => ({
    width: 100,
    height: 50,
    mode,
    shapes: Array.from({ length: shapesCount }, (_, i) => ({
      kind: 'stroke' as const,
      id: i + 1,
      closed: false,
      segs: Array.from({ length: segsPer * 8 }, (_, k) => (k % 8) + i),
      length: 10,
      bbox: [0, 0, 1, 1] as [number, number, number, number],
    })),
    stats: { shapes: shapesCount, dropped: 0, segments: shapesCount * segsPer, points: 0, terms: 0, threshold: 128, ms: 1 },
  });

  it('packs frames into chunks under the 10,000 item list limit', () => {
    const frames = Array.from({ length: 30 }, () => frame(10, 100)); // 1000 segments per frame
    const v = buildVideoGraph(frames, { fps: 12, strokeWidth: 2 });
    expect(v.frames).toBe(30);
    expect(v.chunks.length).toBe(4); // 9 frames (9000 segments) per chunk: 9 + 9 + 9 + 3
    for (const item of v.state.expressions.list) {
      if (item.type !== 'expression' || !/^[XYP]_/.test(item.latex)) continue;
      const count = item.latex.split(',').length;
      expect(count).toBeLessThanOrEqual(CHUNK_CAP + 1);
    }
    const t = v.state.expressions.ticker!;
    expect(t.handlerLatex).toContain('\\operatorname{mod}\\left(F,30\\right)+1');
    expect(t.minStepLatex).toBe('83');
  });

  it('index lists point every frame to its own range, others to the placeholder', () => {
    const frames = [frame(1, 2), frame(0, 0), frame(2, 1)];
    const v = buildVideoGraph(frames, { fps: 10, strokeWidth: 2 });
    const U = v.state.expressions.list.find((e) => e.id === 'u1');
    const V = v.state.expressions.list.find((e) => e.id === 'v1');
    expect(U && U.type === 'expression' && U.latex).toBe('U_{1}=\\left[2,1,4\\right]');
    expect(V && V.type === 'expression' && V.latex).toBe('V_{1}=\\left[3,1,5\\right]');
    const xa = v.state.expressions.list.find((e) => e.type === 'expression' && e.latex.startsWith('X_{a1}='));
    expect(xa && xa.type === 'expression' && xa.latex.startsWith(`X_{a1}=\\left[${UNDEF},`)).toBe(true);
  });

  it('fill video uses one bridged polygon per frame', () => {
    const img = paint(60, 40, union(disk(15, 20, 8), ring(42, 20, 4, 10)));
    const fr = trace(img, settings({ mode: 'fill', blur: 0 }));
    const v = buildVideoGraph([fr, fr], { fps: 5, strokeWidth: 2 });
    expect(v.kind).toBe('fill');
    const draw = v.state.expressions.list.find((e) => e.id === 'd1');
    expect(draw && draw.type === 'expression' && draw.latex.startsWith('\\operatorname{polygon}')).toBe(true);
  });
});
