/**
 * Auto Enhance (BETA): search the trace settings for the result closest to
 * the original picture.
 *
 *  - "optimize": the best accuracy that still draws quickly in Desmos (an
 *    estimated draw time and equation size are penalised past a target).
 *  - "max": the best accuracy within the hard limits, whatever the size.
 *
 * Coordinate descent: starting from the current settings, try each
 * parameter's candidate values one at a time and keep the best, then a second,
 * finer pass. Every candidate is traced (on the worker pool when given one)
 * and scored against reference maps of the picture (see metrics.ts): edge
 * distances for lines, overlap for fills, colour difference for In Color.
 */

import type { RgbaImage, TraceResult, TraceSettings } from './types';
import { colorAccuracy, estimateBytes, reference, score, type Reference } from './metrics';

export type EnhanceMode = 'optimize' | 'max';

export interface EnhanceOptions {
  mode: EnhanceMode;
  /** Trace one candidate (the worker pool in the app, trace() in tests). */
  run: (img: RgbaImage, s: TraceSettings) => Promise<TraceResult>;
  /** The picture at a given working resolution. */
  imageAt: (resolution: number) => Promise<RgbaImage>;
  /** Largest resolution and budget allowed. */
  maxResolution: number;
  maxBudget: number;
  /** Optimize mode: estimated Desmos draw time (ms) and size (characters) to stay under. */
  targetMs?: number;
  targetBytes?: number;
  onProgress?: (done: number, total: number) => void;
  /** Return true to stop early (the best result so far is kept). */
  cancelled?: () => boolean;
}

export interface EnhanceResult {
  settings: TraceSettings;
  /** Accuracy (0..1) of the starting settings and of the best ones found. */
  before: number;
  after: number;
  tried: number;
  /** The best candidate's trace (at its own resolution). */
  result: TraceResult;
}

type Param = { key: keyof TraceSettings; values: (s: TraceSettings) => unknown[] };

const uniq = <T>(xs: T[]) => [...new Set(xs.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as T);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Which settings to search, per mode. Candidates are built around the current value. */
function params(base: TraceSettings, o: EnhanceOptions): Param[] {
  const res = (s: TraceSettings) => {
    const r = [320, 480, 640, 800, 960, 1280, 1600, 1920].filter((v) => v <= o.maxResolution);
    // Optimize mode rarely benefits from the top resolutions (cost grows faster than accuracy).
    return o.mode === 'optimize' ? r.filter((v) => v <= Math.max(960, s.resolution)) : r;
  };
  const smoothing = (s: TraceSettings) => uniq([0.5, 0.8, 1.1, 1.5, 2].map((v) => v).concat([s.smoothing]));
  const budget = (s: TraceSettings) =>
    o.mode === 'max' ? [o.maxBudget] : uniq([0.5, 0.75, 1, 1.5, 2].map((f) => Math.round(clamp(s.budget * f, 100, o.maxBudget))));
  const list: Param[] = [];
  if (base.mode !== 'fill') list.push({ key: 'lineSource', values: () => (base.color ? ['edges', 'ink'] : ['edges', 'ink', 'contours']) });
  list.push({ key: 'resolution', values: res });
  list.push({ key: 'smoothing', values: smoothing });
  if (base.mode !== 'fill') list.push({ key: 'edgeDetail', values: (s) => uniq([35, 50, 65, 80, s.edgeDetail]) });
  list.push({ key: 'minSize', values: (s) => uniq([2, 4, 6, 10, s.minSize]) });
  if (base.mode === 'fill' || base.lineSource === 'contours') list.push({ key: 'blur', values: (s) => uniq([0, 0.6, 1.2, 2, s.blur]) });
  if (base.mode === 'fourier') list.push({ key: 'fourierTerms', values: (s) => uniq([40, 80, 120, 200, s.fourierTerms]) });
  list.push({ key: 'budget', values: budget });
  return list;
}

export async function autoEnhance(img0: TraceSettings, o: EnhanceOptions): Promise<EnhanceResult> {
  const base: TraceSettings = { ...img0, budget: o.mode === 'max' ? o.maxBudget : img0.budget };
  // Score everything against one reference size, so different resolutions compare fairly.
  const evalRes = Math.min(640, o.maxResolution);
  const refImg = await o.imageAt(evalRes);
  const ref: Reference = reference(refImg);
  const targetMs = o.targetMs ?? 400;
  const targetBytes = o.targetBytes ?? 160_000;
  const imgCache = new Map<number, RgbaImage>([[evalRes, refImg]]);
  const imageAt = async (r: number) => {
    let im = imgCache.get(r);
    if (!im) {
      im = await o.imageAt(r);
      imgCache.set(r, im);
    }
    return im;
  };

  const seen = new Map<string, { acc: number; obj: number; res: TraceResult }>();
  let tried = 0;
  const evaluate = async (s: TraceSettings) => {
    const key = JSON.stringify({ ...s, detail: undefined });
    const hit = seen.get(key);
    if (hit) return hit;
    const res = await o.run(await imageAt(s.resolution), s);
    tried++;
    const acc = s.color && s.mode === 'fill' ? colorAccuracy(res, refImg) : score(res, ref).accuracy;
    let obj = acc;
    if (o.mode === 'optimize') {
      const ms = score(res, ref).drawMs;
      const bytes = estimateBytes(res);
      obj -= 0.25 * Math.max(0, ms / targetMs - 1) + 0.15 * Math.max(0, bytes / targetBytes - 1);
    }
    const out = { acc, obj, res };
    seen.set(key, out);
    return out;
  };

  const plist = params(base, o);
  // Two passes over every parameter.
  const total = plist.reduce((n, p) => n + p.values(base).length, 0) * 2 + 1;
  const start = await evaluate(base);
  let best = { s: base, ...start };
  o.onProgress?.(tried, total);
  for (let pass = 0; pass < 2; pass++) {
    for (const p of plist) {
      if (o.cancelled?.()) break;
      const cands = p.values(best.s);
      // Trace the candidates of one parameter in parallel (the pool spreads them over workers).
      const results = await Promise.all(
        cands.map(async (v) => {
          const s = { ...best.s, [p.key]: v } as TraceSettings;
          return { s, ...(await evaluate(s)) };
        }),
      );
      for (const r of results) if (r.obj > best.obj + 1e-4) best = r;
      o.onProgress?.(Math.min(tried, total), total);
    }
  }
  return { settings: best.s, before: start.acc, after: best.acc, tried, result: best.res };
}
