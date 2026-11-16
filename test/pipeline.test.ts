import { describe, expect, it } from 'vitest';
import { histogram, otsu, toGray } from '../src/pipeline/image';
import { groupRings, marchingSquares, signedArea } from '../src/pipeline/contours';
import { fitBeziers, evalSeg } from '../src/pipeline/bezier';
import { fourierFit, fourierAt } from '../src/pipeline/fourier';
import { canny } from '../src/pipeline/canny';
import { thin } from '../src/pipeline/thin';
import { traceChains } from '../src/pipeline/chains';
import { trace } from '../src/pipeline/trace';
import { DEFAULT_SETTINGS, shapeCost, type TraceSettings } from '../src/pipeline/types';
import { disk, paint, rect, ring, union } from './helpers';

const settings = (o: Partial<TraceSettings>): TraceSettings => ({ ...DEFAULT_SETTINGS, ...o });

describe('threshold', () => {
  it('Otsu splits a bimodal histogram between the modes', () => {
    const hist = new Array(256).fill(0);
    hist[40] = 500;
    hist[210] = 700;
    const t = otsu(hist);
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThan(210);
  });

  it('composites transparent pixels over white', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) };
    expect(toGray(img)[0]).toBeCloseTo(255, 3);
  });
});

describe('marching squares', () => {
  it('traces one outer ring around a disk with the right area and orientation', () => {
    const img = paint(60, 60, disk(30, 30, 18));
    const gray = toGray(img);
    const rings = marchingSquares(gray, 60, 60, 127.5, false);
    expect(rings.length).toBe(1);
    expect(rings[0].area).toBeLessThan(0); // outer = negative in y-down coords
    expect(Math.abs(rings[0].area)).toBeGreaterThan(Math.PI * 18 * 18 * 0.93);
    expect(Math.abs(rings[0].area)).toBeLessThan(Math.PI * 18 * 18 * 1.07);
  });

  it('gives holes the opposite orientation and groups them with their outer ring', () => {
    const img = paint(80, 80, ring(40, 40, 12, 30));
    const rings = marchingSquares(toGray(img), 80, 80, 127.5, false);
    expect(rings.length).toBe(2);
    const outer = rings.find((r) => r.area < 0)!;
    const hole = rings.find((r) => r.area > 0)!;
    expect(outer).toBeTruthy();
    expect(hole).toBeTruthy();
    const groups = groupRings(rings);
    expect(groups.length).toBe(1);
    expect(groups[0].holes.length).toBe(1);
  });

  it('closes contours that touch the image border', () => {
    const img = paint(20, 20, rect(0, 0, 9, 19));
    const rings = marchingSquares(toGray(img), 20, 20, 127.5, false);
    expect(rings.length).toBe(1);
    expect(Math.abs(rings[0].area)).toBeCloseTo(10 * 20, -1);
  });

  it('handles saddles without crossing contours (checkerboard)', () => {
    const img = paint(8, 8, (x, y) => (x + y) % 2 === 0);
    const rings = marchingSquares(toGray(img), 8, 8, 127.5, false);
    for (const r of rings) expect(Math.abs(signedArea(r.pts))).toBeGreaterThan(0);
  });
});

describe('bezier fitting', () => {
  it('fits a sampled circle within tolerance', () => {
    const pts: number[] = [];
    const R = 40;
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      pts.push(50 + R * Math.cos(a), 50 + R * Math.sin(a));
    }
    const segs = fitBeziers(pts, true, { tolerance: 0.5 });
    const n = segs.length / 8;
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(20);
    for (let s = 0; s < n; s++) {
      for (let k = 0; k <= 10; k++) {
        const [x, y] = evalSeg(segs, s, k / 10);
        expect(Math.abs(Math.hypot(x - 50, y - 50) - R)).toBeLessThan(1.5);
      }
    }
    // Chain is continuous and closed.
    for (let s = 1; s < n; s++) {
      expect(segs[s * 8]).toBeCloseTo(segs[s * 8 - 2], 6);
      expect(segs[s * 8 + 1]).toBeCloseTo(segs[s * 8 - 1], 6);
    }
    expect(segs[segs.length - 2]).toBeCloseTo(segs[0], 6);
    expect(segs[segs.length - 1]).toBeCloseTo(segs[1], 6);
  });

  it('keeps a sharp corner as a segment boundary', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 30; i++) pts.push(i, 0);
    for (let i = 1; i <= 30; i++) pts.push(30, i);
    const segs = fitBeziers(pts, false, { tolerance: 0.5 });
    const ends: [number, number][] = [];
    for (let s = 0; s < segs.length / 8; s++) ends.push([segs[s * 8 + 6], segs[s * 8 + 7]]);
    expect(ends.some(([x, y]) => Math.abs(x - 30) < 1e-6 && Math.abs(y) < 1e-6)).toBe(true);
  });
});

describe('fourier', () => {
  it('represents a circle with one dominant term', () => {
    const pts: number[] = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(10 + 25 * Math.cos(a), -5 + 25 * Math.sin(a));
    }
    const f = fourierFit(pts, true, 5);
    const k0 = f.freq.indexOf(0);
    expect(f.re[k0]).toBeCloseTo(10, 1);
    expect(f.im[k0]).toBeCloseTo(-5, 1);
    const mags = f.freq.map((_, j) => Math.hypot(f.re[j], f.im[j]));
    const k1 = f.freq.findIndex((k) => Math.abs(k) === 1);
    expect(mags[k1]).toBeCloseTo(25, 0);
    expect(f.error).toBeLessThan(0.5);
    const [x, y] = fourierAt(f, 0.25);
    expect(Math.hypot(x - 10, y + 5)).toBeCloseTo(25, 0);
  });
});

describe('edges and chains', () => {
  it('finds a closed edge loop around a filled square', () => {
    const img = paint(50, 50, rect(15, 15, 34, 34));
    const { edges } = canny(toGray(img), 50, 50, { sigma: 1, detail: 50 });
    const t = thin(edges, 50, 50);
    const chains = traceChains(t, 50, 50, 5);
    expect(chains.length).toBeGreaterThanOrEqual(1);
    const total = chains.reduce((n, c) => n + c.pts.length / 2, 0);
    expect(total).toBeGreaterThan(60); // perimeter is ~76 px
  });

  it('chains a straight line end to end', () => {
    const w = 40, h = 10;
    const bin = new Uint8Array(w * h);
    for (let x = 5; x < 35; x++) bin[5 * w + x] = 1;
    const chains = traceChains(bin, w, h, 2);
    expect(chains.length).toBe(1);
    expect(chains[0].closed).toBe(false);
    expect(chains[0].pts.length / 2).toBe(30);
  });
});

describe('trace()', () => {
  it('fill mode returns one region with a hole for an annulus', () => {
    const img = paint(100, 100, ring(50, 50, 15, 35));
    const res = trace(img, settings({ mode: 'fill', blur: 0, smoothing: 0.5, minSize: 2 }));
    expect(res.shapes.length).toBe(1);
    const sh = res.shapes[0];
    expect(sh.kind).toBe('region');
    if (sh.kind === 'region') {
      expect(sh.rings.length).toBe(2);
      const expected = Math.PI * (35 * 35 - 15 * 15);
      expect(sh.area).toBeGreaterThan(expected * 0.92);
      expect(sh.area).toBeLessThan(expected * 1.08);
    }
  });

  it('outline/edges mode traces a square into Bezier strokes near its boundary', () => {
    const img = paint(60, 60, rect(15, 15, 44, 44));
    const res = trace(img, settings({ mode: 'outline', lineSource: 'edges', blur: 1, minSize: 4 }));
    expect(res.stats.segments).toBeGreaterThan(0);
    for (const sh of res.shapes) {
      if (sh.kind !== 'stroke') continue;
      for (let s = 0; s < sh.segs.length / 8; s++) {
        const x = sh.segs[s * 8], y = sh.segs[s * 8 + 1];
        const dEdge = Math.min(Math.abs(x - 14.5), Math.abs(x - 44.5), Math.abs(y - 14.5), Math.abs(y - 44.5));
        expect(dEdge).toBeLessThan(3);
      }
    }
  });

  it('centerline mode follows the middle of a thick stroke', () => {
    const img = paint(80, 30, rect(10, 12, 70, 18));
    const res = trace(img, settings({ mode: 'outline', lineSource: 'centerline', blur: 0, minSize: 5 }));
    expect(res.shapes.length).toBeGreaterThanOrEqual(1);
    const sh = res.shapes[0];
    if (sh.kind === 'stroke') {
      for (let s = 0; s < sh.segs.length / 8; s++) expect(Math.abs(sh.segs[s * 8 + 1] - 15)).toBeLessThan(3);
    }
  });

  it('fourier mode makes one series per contour', () => {
    const img = paint(80, 80, union(disk(25, 40, 12), rect(50, 25, 70, 55)));
    const res = trace(img, settings({ mode: 'fourier', lineSource: 'contours', blur: 0.5, fourierTerms: 20 }));
    expect(res.shapes.length).toBe(2);
    for (const sh of res.shapes) {
      expect(sh.kind).toBe('fourier');
      if (sh.kind === 'fourier') {
        expect(sh.freq.length).toBeLessThanOrEqual(20);
        expect(sh.error).toBeLessThan(2.5);
      }
    }
  });

  it('respects the budget', () => {
    const shapesInk = (x: number, y: number) => ((x >> 3) + (y >> 3)) % 2 === 0;
    const img = paint(96, 96, shapesInk);
    const budget = 60;
    const res = trace(img, settings({ mode: 'fill', blur: 0, budget, minSize: 1 }));
    const used = res.shapes.reduce((n, sh) => n + shapeCost(sh), 0);
    expect(used).toBeLessThanOrEqual(budget);
    expect(res.stats.dropped).toBeGreaterThan(0);
  });

  it('auto threshold lands between ink and paper', () => {
    const img = paint(40, 40, disk(20, 20, 10));
    const res = trace(img, settings({ mode: 'fill' }));
    expect(res.stats.threshold).toBeGreaterThan(0);
    expect(res.stats.threshold).toBeLessThan(255);
  });

  it('histogram helper counts every pixel', () => {
    const img = paint(10, 10, disk(5, 5, 3));
    const hist = histogram(toGray(img));
    expect(hist.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
