/**
 * Auto Enhance (BETA): search the trace settings for the result closest to
 * the original picture.
 *
 *  - "optimize": the best accuracy that still draws quickly in Desmos (an
 *    estimated draw time and equation size are penalised past a target).
 *  - "max": the best accuracy within the hard limits, whatever the size.
 *
 * One step at a time, most influential first, each step fixing its best value
 * before the next starts:
 *   1. Resolution  (walks up and stops once it stops helping)
 *   2. Smoothing   (blur, then curve tolerance, then specks)
 *   3. Detail      (line source, edge sensitivity, Fourier circles)
 *   4. Budget      (the size / quality trade-off, last)
 * then a quick re-check of the neighbouring resolutions when smoothing moved a
 * lot. In Color with Auto Color keeps the colour count Auto Color picks.
 *
 * Every candidate is traced (on the worker pool in the app) and scored against
 * reference maps of the picture (metrics.ts): edge distances for lines,
 * overlap for fills, a blurred colour difference for In Color, each multiplied
 * by a cleanliness factor so smooth areas and joined lines beat speckle.
 * Videos are scored as the mean over several frames.
 */

import type { RgbaImage, TraceResult, TraceSettings } from './types';
import { cleanliness, colorAccuracy, estimateBytes, reference, score, type Reference } from './metrics';

export type EnhanceMode = 'optimize' | 'max';

export interface EnhanceProgress {
  /** 1-based step number and the number of steps. */
  step: number;
  steps: number;
  label: string;
  /** Candidate settings tried so far (each traced once per sample frame). */
  tried: number;
}

export interface EnhanceOptions {
  mode: EnhanceMode;
  /** Trace one candidate (the worker pool in the app, trace() in tests). */
  run: (img: RgbaImage, s: TraceSettings) => Promise<TraceResult>;
  /** The picture at a given working resolution (and, for videos, sample frame 0..frames-1). */
  imageAt: (resolution: number, frame: number) => Promise<RgbaImage>;
  /** Number of sample frames to score on (videos); 1 for pictures. */
  frames?: number;
  /** Largest resolution and budget allowed. */
  maxResolution: number;
  maxBudget: number;
  /** Optimize mode: estimated Desmos draw time (ms) and size (characters) per frame to stay under. */
  targetMs?: number;
  targetBytes?: number;
  onProgress?: (p: EnhanceProgress) => void;
  /** Return true to stop early (the best result so far is kept). */
  cancelled?: () => boolean;
}

export interface EnhanceStep {
  label: string;
  /** What this step changed, e.g. ["Resolution 960"]; empty when it kept the settings. */
  changes: string[];
}

export interface EnhanceResult {
  settings: TraceSettings;
  /** Accuracy (0..1) of the starting settings and of the best ones found. */
  before: number;
  after: number;
  tried: number;
  /** The best candidate's trace (first frame, at its own resolution). */
  result: TraceResult;
  steps: EnhanceStep[];
}

const RESOLUTIONS = [320, 480, 640, 800, 960, 1280, 1600, 1920];
const uniq = <T>(xs: T[]) => [...new Set(xs.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as T);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const NAMES: Partial<Record<keyof TraceSettings, string>> = {
  resolution: 'Resolution',
  blur: 'Blur',
  smoothing: 'Curve tolerance',
  minSize: 'Specks under',
  lineSource: 'Lines from',
  edgeDetail: 'Edge sensitivity',
  fourierTerms: 'Circles',
  budget: 'Budget',
};

type Cand = { s: TraceSettings; acc: number; obj: number; res: TraceResult };

export async function autoEnhance(img0: TraceSettings, o: EnhanceOptions): Promise<EnhanceResult> {
  const frames = Math.max(1, o.frames ?? 1);
  const base: TraceSettings = { ...img0, budget: o.mode === 'max' ? o.maxBudget : img0.budget };
  // Score everything against one reference size, so different resolutions compare fairly.
  const evalRes = Math.min(640, o.maxResolution);
  const refs: { img: RgbaImage; ref: Reference }[] = [];
  for (let f = 0; f < frames; f++) {
    const img = await o.imageAt(evalRes, f);
    refs.push({ img, ref: reference(img) });
  }
  const targetMs = o.targetMs ?? 400;
  const targetBytes = o.targetBytes ?? 160_000;
  const imgCache = new Map<string, Promise<RgbaImage>>();
  refs.forEach((r, f) => imgCache.set(`${evalRes}|${f}`, Promise.resolve(r.img)));
  const imageAt = (r: number, f: number) => {
    const key = `${r}|${f}`;
    let im = imgCache.get(key);
    if (!im) imgCache.set(key, (im = o.imageAt(r, f)));
    return im;
  };

  const seen = new Map<string, Promise<Omit<Cand, 's'>>>();
  let tried = 0;
  const scoreOne = (res: TraceResult, s: TraceSettings, f: number) => {
    const { img, ref } = refs[f];
    const raw = s.color && s.mode === 'fill' ? colorAccuracy(res, img, { blur: true }) : score(res, ref).accuracy;
    const acc = raw * cleanliness(res, ref);
    let obj = acc;
    if (o.mode === 'optimize') {
      const ms = score(res, ref).drawMs;
      const bytes = estimateBytes(res);
      obj -= 0.25 * Math.max(0, ms / targetMs - 1) + 0.15 * Math.max(0, bytes / targetBytes - 1);
    }
    return { acc, obj };
  };
  const evaluate = (s: TraceSettings): Promise<Omit<Cand, 's'>> => {
    const key = JSON.stringify({ ...s, detail: undefined });
    let hit = seen.get(key);
    if (!hit) {
      tried++;
      hit = (async () => {
        const per = await Promise.all(
          refs.map(async (_, f) => {
            const res = await o.run(await imageAt(s.resolution, f), s);
            return { res, ...scoreOne(res, s, f) };
          }),
        );
        const acc = per.reduce((n, p) => n + p.acc, 0) / frames;
        const obj = per.reduce((n, p) => n + p.obj, 0) / frames;
        return { acc, obj, res: per[0].res };
      })();
      seen.set(key, hit);
    }
    return hit;
  };

  const start = await evaluate(base);
  let best: Cand = { s: base, ...start };
  const better = (c: Cand, margin = 1e-4) => c.obj > best.obj + margin;

  // Try values of one setting (in parallel) and keep the best.
  const lineSearch = async (key: keyof TraceSettings, values: unknown[]) => {
    if (o.cancelled?.()) return;
    const cands = await Promise.all(
      uniq(values).map(async (v) => {
        const s = { ...best.s, [key]: v } as TraceSettings;
        return { s, ...(await evaluate(s)) };
      }),
    );
    for (const c of cands) if (better(c)) best = c;
  };

  const resList = RESOLUTIONS.filter((v) => v <= o.maxResolution);
  const steps: { label: string; run: () => Promise<void>; keys: (keyof TraceSettings)[] }[] = [];

  steps.push({
    label: 'Resolution',
    keys: ['resolution'],
    run: async () => {
      // Walk up; stop after two resolutions in a row that add under half a percent.
      let flat = 0;
      for (const r of resList) {
        if (o.cancelled?.()) return;
        const s = { ...best.s, resolution: r };
        const c = { s, ...(await evaluate(s)) };
        if (better(c, 0.005)) {
          best = c;
          flat = 0;
        } else {
          if (better(c)) best = c;
          if (r > best.s.resolution && ++flat >= 2) return;
        }
        report();
      }
    },
  });

  steps.push({
    label: 'Smoothing',
    keys: ['blur', 'smoothing', 'minSize'],
    run: async () => {
      await lineSearch('blur', [0, 0.6, 1.2, 2, best.s.blur]);
      report();
      await lineSearch('smoothing', [0.5, 0.8, 1.1, 1.5, 2, best.s.smoothing]);
      report();
      await lineSearch('minSize', [2, 4, 6, 10, best.s.minSize]);
    },
  });

  if (base.mode !== 'fill') {
    steps.push({
      label: 'Detail',
      keys: ['lineSource', 'edgeDetail', 'fourierTerms'],
      run: async () => {
        await lineSearch('lineSource', base.color ? ['edges', 'ink'] : ['edges', 'ink', 'contours']);
        report();
        await lineSearch('edgeDetail', [35, 50, 65, 80, best.s.edgeDetail]);
        if (base.mode === 'fourier') {
          report();
          await lineSearch('fourierTerms', [40, 80, 120, 200, best.s.fourierTerms]);
        }
      },
    });
  }

  steps.push({
    label: 'Budget',
    keys: ['budget'],
    run: async () => {
      if (o.mode === 'max') await lineSearch('budget', [o.maxBudget]);
      else await lineSearch('budget', [0.5, 0.75, 1, 1.5, 2].map((f) => Math.round(clamp(best.s.budget * f, 100, o.maxBudget))));
    },
  });

  let current = 0;
  const report = () => o.onProgress?.({ step: current + 1, steps: steps.length, label: steps[current].label, tried });
  const done: EnhanceStep[] = [];
  const describe = (k: keyof TraceSettings, v: unknown) =>
    `${NAMES[k] ?? String(k)} ${k === 'lineSource' ? v : typeof v === 'number' ? Math.round(v * 100) / 100 : v}`;

  for (current = 0; current < steps.length; current++) {
    if (o.cancelled?.()) break;
    report();
    const before = { ...best.s };
    await steps[current].run();
    done.push({ label: steps[current].label, changes: steps[current].keys.filter((k) => best.s[k] !== before[k]).map((k) => describe(k, best.s[k])) });
    // Smoothing that moved a lot can shift the best resolution: check its neighbours once.
    if (steps[current].label === 'Smoothing' && !o.cancelled?.()) {
      const moved = Math.abs(best.s.smoothing - before.smoothing) > 0.35 || Math.abs(best.s.blur - before.blur) > 0.7;
      if (moved) {
        const i = resList.indexOf(best.s.resolution);
        const near = [resList[i - 1], resList[i + 1]].filter((v): v is number => v !== undefined);
        const r0 = best.s.resolution;
        await lineSearch('resolution', near);
        if (best.s.resolution !== r0) done[done.length - 1].changes.push(describe('resolution', best.s.resolution));
      }
    }
  }
  return { settings: best.s, before: start.acc, after: best.acc, tried, result: best.res, steps: done };
}
