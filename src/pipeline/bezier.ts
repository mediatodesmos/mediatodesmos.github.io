/**
 * Least-squares cubic Bezier fitting (P. J. Schneider, "An Algorithm for
 * Automatically Fitting Digitized Curves", Graphics Gems, 1990), with corner
 * detection so sharp turns stay sharp.
 *
 * Output: flat segments, 8 numbers each: x0 y0 x1 y1 x2 y2 x3 y3.
 */

import { dedupe, rdpIndices } from './simplify';

type V = [number, number];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const norm = (a: V): V => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};

function bezierAt(b: V[], t: number): V {
  const mt = 1 - t;
  const a = mt * mt * mt, c = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
  return [a * b[0][0] + c * b[1][0] + d * b[2][0] + e * b[3][0], a * b[0][1] + c * b[1][1] + d * b[2][1] + e * b[3][1]];
}

function bezierD1(b: V[], t: number): V {
  const mt = 1 - t;
  const a = 3 * mt * mt, c = 6 * mt * t, d = 3 * t * t;
  return [
    a * (b[1][0] - b[0][0]) + c * (b[2][0] - b[1][0]) + d * (b[3][0] - b[2][0]),
    a * (b[1][1] - b[0][1]) + c * (b[2][1] - b[1][1]) + d * (b[3][1] - b[2][1]),
  ];
}

function bezierD2(b: V[], t: number): V {
  const mt = 1 - t;
  return [
    6 * mt * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]),
    6 * mt * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1]),
  ];
}

function chordParams(P: V[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(P[i], P[i - 1])));
  const total = u[u.length - 1];
  return total > 0 ? u.map((x) => x / total) : u.map((_, i) => i / Math.max(1, u.length - 1));
}

function generate(P: V[], first: number, last: number, u: number[], t1: V, t2: V): V[] {
  const p0 = P[first], p3 = P[last];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a0 = mul(t1, b1), a1 = mul(t2, b2);
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const tmp = sub(P[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alphaL = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let alphaR = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const segLen = len(sub(p3, p0));
  const eps = 1e-6 * segLen;
  if (alphaL < eps || alphaR < eps || alphaL > segLen * 2 || alphaR > segLen * 2) {
    alphaL = alphaR = segLen / 3;
  }
  return [p0, add(p0, mul(t1, alphaL)), add(p3, mul(t2, alphaR)), p3];
}

function maxError(P: V[], first: number, last: number, b: V[], u: number[]): [number, number] {
  let max = 0;
  let split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const d = sub(bezierAt(b, u[i - first]), P[i]);
    const e = dot(d, d);
    if (e >= max) {
      max = e;
      split = i;
    }
  }
  return [max, split];
}

function reparam(P: V[], first: number, b: V[], u: number[]): number[] {
  return u.map((t, i) => {
    const q = bezierAt(b, t);
    const q1 = bezierD1(b, t);
    const q2 = bezierD2(b, t);
    const d = sub(q, P[first + i]);
    const num = dot(d, q1);
    const den = dot(q1, q1) + dot(d, q2);
    if (Math.abs(den) < 1e-12) return t;
    const nt = t - num / den;
    return nt < 0 ? 0 : nt > 1 ? 1 : nt;
  });
}

function fitCubic(P: V[], first: number, last: number, t1: V, t2: V, err2: number, out: number[], depth: number): void {
  const nPts = last - first + 1;
  if (nPts === 2 || depth > 40) {
    const dist = len(sub(P[last], P[first])) / 3;
    const b = [P[first], add(P[first], mul(t1, dist)), add(P[last], mul(t2, dist)), P[last]];
    push(out, b);
    return;
  }
  let u = chordParams(P, first, last);
  let b = generate(P, first, last, u, t1, t2);
  let [e, split] = maxError(P, first, last, b, u);
  if (e < err2) {
    push(out, b);
    return;
  }
  if (e < err2 * 9) {
    for (let it = 0; it < 12; it++) {
      const u2 = reparam(P, first, b, u);
      b = generate(P, first, last, u2, t1, t2);
      [e, split] = maxError(P, first, last, b, u2);
      if (e < err2) {
        push(out, b);
        return;
      }
      u = u2;
    }
  }
  if (split <= first) split = first + 1;
  if (split >= last) split = last - 1;
  const tc = norm(sub(P[split - 1], P[split + 1]));
  const tcSafe: V = tc[0] === 0 && tc[1] === 0 ? norm(sub(P[first], P[last])) : tc;
  fitCubic(P, first, split, t1, tcSafe, err2, out, depth + 1);
  fitCubic(P, split, last, mul(tcSafe, -1), t2, err2, out, depth + 1);
}

function push(out: number[], b: V[]): void {
  out.push(b[0][0], b[0][1], b[1][0], b[1][1], b[2][0], b[2][1], b[3][0], b[3][1]);
}

/** Tangent at the start of P[first..] looking a few points ahead (robust to pixel noise). */
function leftTangent(P: V[], first: number, last: number): V {
  const k = Math.min(last, first + 3);
  const t = norm(sub(P[k], P[first]));
  return t[0] === 0 && t[1] === 0 ? norm(sub(P[last], P[first])) : t;
}

function rightTangent(P: V[], first: number, last: number): V {
  const k = Math.max(first, last - 3);
  const t = norm(sub(P[k], P[last]));
  return t[0] === 0 && t[1] === 0 ? norm(sub(P[first], P[last])) : t;
}

/** Find corner indices on a polyline via RDP vertices with a sharp turn. */
function corners(pts: number[], closed: boolean, eps: number, cornerDeg: number): number[] {
  const m = pts.length / 2;
  if (m < 5) return [];
  const work = closed ? pts.concat(pts[0], pts[1]) : pts;
  const idx = rdpIndices(work, eps);
  const cosLimit = Math.cos((cornerDeg * Math.PI) / 180);
  const out: number[] = [];
  const count = idx.length;
  for (let k = 0; k < count; k++) {
    const i = idx[k];
    let prevI: number, nextI: number;
    if (k === 0 || k === count - 1) {
      if (!closed) continue;
      // For rings, idx[0] and idx[last] are the same point (index 0 and m).
      if (k === count - 1) continue;
      prevI = idx[count - 2];
      nextI = idx[1];
    } else {
      prevI = idx[k - 1];
      nextI = idx[k + 1];
    }
    const pi = i % m, pp = prevI % m, pn = nextI % m;
    const a: V = [pts[2 * pi] - pts[2 * pp], pts[2 * pi + 1] - pts[2 * pp + 1]];
    const b: V = [pts[2 * pn] - pts[2 * pi], pts[2 * pn + 1] - pts[2 * pi + 1]];
    if (len(a) < 1e-9 || len(b) < 1e-9) continue;
    const c = dot(norm(a), norm(b)); // cos of turn angle
    if (c < cosLimit) out.push(pi);
  }
  return Array.from(new Set(out)).sort((x, y) => x - y);
}

export interface FitOptions {
  /** Max deviation in px. */
  tolerance: number;
  /** Turn angle (degrees) above which a vertex is a corner. */
  cornerAngle?: number;
}

/** Fit a polyline (open or closed) with a chain of cubic Beziers. */
export function fitBeziers(rawPts: number[], closed: boolean, opts: FitOptions): number[] {
  const pts = dedupe(rawPts, closed);
  const m = pts.length / 2;
  const out: number[] = [];
  if (m < 2) return out;
  const tol = Math.max(0.15, opts.tolerance);
  const err2 = tol * tol;
  const cornerAngle = opts.cornerAngle ?? 65;

  if (m === 2) {
    const P: V[] = [[pts[0], pts[1]], [pts[2], pts[3]]];
    fitCubic(P, 0, 1, norm(sub(P[1], P[0])), norm(sub(P[0], P[1])), err2, out, 0);
    if (closed) fitCubic([P[1], P[0]], 0, 1, norm(sub(P[0], P[1])), norm(sub(P[1], P[0])), err2, out, 0);
    return out;
  }

  const cs = corners(pts, closed, Math.max(0.8, tol), cornerAngle);

  if (!closed) {
    const P: V[] = [];
    for (let i = 0; i < m; i++) P.push([pts[2 * i], pts[2 * i + 1]]);
    const cuts = [0, ...cs.filter((c) => c > 0 && c < m - 1), m - 1];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1];
      fitCubic(P, a, b, leftTangent(P, a, b), rightTangent(P, a, b), err2, out, 0);
    }
    return out;
  }

  // Closed: rotate so the ring starts at a corner (or point 0), append the start to close.
  const start = cs.length ? cs[0] : 0;
  const P: V[] = [];
  for (let k = 0; k <= m; k++) {
    const i = (start + k) % m;
    P.push([pts[2 * i], pts[2 * i + 1]]);
  }
  const cutsRel = cs.map((c) => (c - start + m) % m).filter((c) => c > 0);
  const cuts = [0, ...cutsRel.sort((x, y) => x - y), m];
  if (cs.length === 0) {
    // Smooth ring: matching tangents at the seam.
    const tSeam = norm(sub(P[1], P[m - 1]));
    const t1: V = tSeam[0] === 0 && tSeam[1] === 0 ? leftTangent(P, 0, m) : tSeam;
    fitCubic(P, 0, m, t1, mul(t1, -1), err2, out, 0);
    return out;
  }
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b - a < 1) continue;
    fitCubic(P, a, b, leftTangent(P, a, b), rightTangent(P, a, b), err2, out, 0);
  }
  return out;
}

/** Evaluate segment `s` of a flat segment array at parameter t. */
export function evalSeg(segs: number[], s: number, t: number): [number, number] {
  const o = s * 8;
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return [
    a * segs[o] + b * segs[o + 2] + c * segs[o + 4] + d * segs[o + 6],
    a * segs[o + 1] + b * segs[o + 3] + c * segs[o + 5] + d * segs[o + 7],
  ];
}

/** Sample every segment into a polyline (useful for previews and polygon fills). */
export function sampleSegs(segs: number[], perSeg: number): number[] {
  const out: number[] = [];
  const n = segs.length / 8;
  for (let s = 0; s < n; s++) {
    for (let k = s === 0 ? 0 : 1; k <= perSeg; k++) {
      const [x, y] = evalSeg(segs, s, k / perSeg);
      out.push(x, y);
    }
  }
  return out;
}
