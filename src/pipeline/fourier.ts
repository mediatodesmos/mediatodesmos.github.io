/**
 * Fourier series of a closed curve. The curve z(t) = x(t) + i y(t), t in [0,1),
 * is sampled uniformly by arc length and decomposed with a DFT. The largest
 * terms are kept:
 *   z(t) ~ sum_k c_k e^{2 pi i k t}
 * Open curves are traced out and back so they become closed.
 */

import { resample } from './simplify';

export interface FourierFit {
  freq: number[];
  re: number[];
  im: number[];
  error: number;
}

/**
 * @param targetError when set, use the fewest terms (up to maxTerms) whose mean
 *   distance to the traced path is at most this many pixels
 */
export function fourierFit(rawPts: number[], closed: boolean, maxTerms: number, targetError?: number): FourierFit {
  let pts = rawPts;
  if (!closed) {
    // out and back: p0..pn, p(n-1)..p1
    const back: number[] = [];
    for (let i = rawPts.length / 2 - 2; i >= 1; i--) back.push(rawPts[2 * i], rawPts[2 * i + 1]);
    pts = rawPts.concat(back);
  }
  const m = pts.length / 2;
  if (m < 3) {
    return { freq: [0], re: [pts[0] ?? 0], im: [pts[1] ?? 0], error: 0 };
  }
  // Sample count: enough for the requested terms, bounded for speed.
  let perimeter = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    perimeter += Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1]);
  }
  const N = Math.max(64, Math.min(1024, Math.max(maxTerms * 6, Math.ceil(perimeter / 1.5))));
  const s = resample(pts, true, N);

  const K = Math.min(Math.floor(N / 2) - 1, Math.max(maxTerms * 3, 32));
  const cands: { k: number; re: number; im: number; mag: number }[] = [];
  for (let k = -K; k <= K; k++) {
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      const c = Math.cos(w * n), sn = Math.sin(w * n);
      const x = s[2 * n], y = s[2 * n + 1];
      // (x + iy)(c + i sn)
      re += x * c - y * sn;
      im += x * sn + y * c;
    }
    re /= N;
    im /= N;
    cands.push({ k, re, im, mag: Math.hypot(re, im) });
  }
  // Always keep k = 0 (the centre), then the biggest circles.
  const zero = cands.find((c) => c.k === 0)!;
  const rest = cands.filter((c) => c.k !== 0).sort((a, b) => b.mag - a.mag);

  const build = (terms: number): FourierFit => {
    const kept = [zero, ...rest.slice(0, Math.max(0, terms - 1))];
    // Sort by |k| so the epicycle chain grows from slow to fast.
    kept.sort((a, b) => Math.abs(a.k) - Math.abs(b.k) || a.k - b.k);
    const fit: FourierFit = { freq: kept.map((c) => c.k), re: kept.map((c) => c.re), im: kept.map((c) => c.im), error: 0 };
    let err = 0;
    for (let n = 0; n < N; n++) {
      const [x, y] = fourierAt(fit, n / N);
      err += Math.hypot(x - s[2 * n], y - s[2 * n + 1]);
    }
    fit.error = err / N;
    return fit;
  };

  if (!(targetError && targetError > 0)) return build(maxTerms);
  // Fewest circles whose mean error meets the target (error falls as terms grow).
  let best = build(maxTerms);
  if (best.error > targetError) return best;
  let lo = 2, hi = maxTerms;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const f = build(mid);
    if (f.error <= targetError) {
      hi = mid;
      best = f;
    } else lo = mid + 1;
  }
  return best.freq.length === lo ? best : build(lo);
}

export function fourierAt(f: { freq: number[]; re: number[]; im: number[] }, t: number): [number, number] {
  let x = 0, y = 0;
  for (let j = 0; j < f.freq.length; j++) {
    const a = 2 * Math.PI * f.freq[j] * t;
    const c = Math.cos(a), s = Math.sin(a);
    x += f.re[j] * c - f.im[j] * s;
    y += f.re[j] * s + f.im[j] * c;
  }
  return [x, y];
}

export function sampleFourier(f: { freq: number[]; re: number[]; im: number[] }, count: number): number[] {
  const out: number[] = [];
  for (let n = 0; n <= count; n++) {
    const [x, y] = fourierAt(f, n / count);
    out.push(x, y);
  }
  return out;
}
