import { describe, expect, it } from 'vitest';
import { distanceTo, rasterizeShapes, score, type Reference } from '../src/pipeline/metrics';
import type { Shape, TraceResult } from '../src/pipeline/types';

const W = 40, H = 30;

function refWithHLine(y: number): Reference {
  const edges = new Uint8Array(W * H);
  for (let x = 5; x < 35; x++) edges[y * W + x] = 1;
  return { width: W, height: H, edges, edgeDist: distanceTo(edges, W, H), bitmap: new Uint8Array(W * H) };
}

const straight = (y: number): Shape => ({ kind: 'stroke', id: 1, closed: false, segs: [5, y, 15, y, 25, y, 34, y], length: 29, bbox: [5, y, 34, y] });

const result = (shapes: Shape[], mode: TraceResult['mode'] = 'outline'): TraceResult => ({
  width: W,
  height: H,
  mode,
  shapes,
  stats: { shapes: shapes.length, dropped: 0, segments: 1, points: 0, terms: 0, threshold: 128, ms: 0 },
});

describe('metrics', () => {
  it('measures distances to the nearest on pixel', () => {
    const m = new Uint8Array(W * H);
    m[10 * W + 10] = 1;
    const d = distanceTo(m, W, H);
    expect(d[10 * W + 10]).toBe(0);
    expect(d[10 * W + 13]).toBe(3);
    expect(d[13 * W + 13]).toBeCloseTo(3 * Math.SQRT2, 5);
  });

  it('rasterizes strokes and fills regions', () => {
    const line = rasterizeShapes([straight(12)], W, H);
    expect(line[12 * W + 20]).toBe(1);
    expect(line[13 * W + 20]).toBe(0);
    const sq = rasterizeShapes([{ kind: 'region', id: 2, rings: [[10, 10, 20, 10, 20, 20, 10, 20]], area: 100, bbox: [10, 10, 20, 20] }], W, H);
    let n = 0;
    for (const v of sq) n += v;
    expect(n).toBe(100);
  });

  it('scores an exact trace better than an offset one', () => {
    const ref = refWithHLine(12);
    const exact = score(result([straight(12)]), ref);
    const off = score(result([straight(18)]), ref);
    expect(exact.precision).toBeLessThan(0.1);
    expect(exact.accuracy).toBeGreaterThan(off.accuracy);
    expect(off.precision).toBeCloseTo(6, 0);
    expect(exact.drawMs).toBeGreaterThan(0);
  });

  it('scores fill by overlap', () => {
    const ref = refWithHLine(1);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) ref.bitmap[y * W + x] = 1;
    const s = score(result([{ kind: 'region', id: 2, rings: [[10, 10, 20, 10, 20, 20, 10, 20]], area: 100, bbox: [10, 10, 20, 20] }], 'fill'), ref);
    expect(s.iou).toBe(1);
  });
});
