/** Polyline utilities: smoothing, Ramer-Douglas-Peucker, resampling. Points are flat [x0,y0,x1,y1,...]. */

/** Indices (point indices, not array offsets) kept by RDP on an open polyline. */
export function rdpIndices(pts: number[], eps: number, first = 0, last = pts.length / 2 - 1): number[] {
  const m = last - first + 1;
  if (m <= 2) return m === 2 ? [first, last] : [first];
  const keep = new Uint8Array(m);
  keep[0] = 1;
  keep[m - 1] = 1;
  const stack: [number, number][] = [[first, last]];
  const eps2 = eps * eps;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[2 * a], ay = pts[2 * a + 1];
    const bx = pts[2 * b], by = pts[2 * b + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const cross = px * dy - py * dx;
        d2 = (cross * cross) / len2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > eps2) {
      keep[idx - first] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < m; i++) if (keep[i]) out.push(first + i);
  return out;
}

export function rdp(pts: number[], eps: number): number[] {
  const idx = rdpIndices(pts, eps);
  const out: number[] = [];
  for (const i of idx) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** RDP for a closed ring: split at the point farthest from point 0. */
export function rdpClosed(pts: number[], eps: number): number[] {
  const m = pts.length / 2;
  if (m <= 4) return pts.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < m; i++) {
    const d = (pts[2 * i] - pts[0]) ** 2 + (pts[2 * i + 1] - pts[1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const closedPts = pts.concat(pts[0], pts[1]); // index m == point 0
  const a = rdpIndices(closedPts, eps, 0, far);
  const b = rdpIndices(closedPts, eps, far, m);
  const idx = a.concat(b.slice(1, -1));
  const out: number[] = [];
  for (const i of idx) out.push(closedPts[2 * i], closedPts[2 * i + 1]);
  return out;
}

/** Binomial [1 2 1]/4 smoothing; endpoints of open lines stay fixed. */
export function smooth(pts: number[], closed: boolean, iterations: number): number[] {
  let cur = pts;
  const m = pts.length / 2;
  if (m < 3) return pts.slice();
  for (let it = 0; it < iterations; it++) {
    const out = new Array<number>(cur.length);
    for (let i = 0; i < m; i++) {
      if (!closed && (i === 0 || i === m - 1)) {
        out[2 * i] = cur[2 * i];
        out[2 * i + 1] = cur[2 * i + 1];
        continue;
      }
      const p = (i - 1 + m) % m;
      const q = (i + 1) % m;
      out[2 * i] = 0.25 * cur[2 * p] + 0.5 * cur[2 * i] + 0.25 * cur[2 * q];
      out[2 * i + 1] = 0.25 * cur[2 * p + 1] + 0.5 * cur[2 * i + 1] + 0.25 * cur[2 * q + 1];
    }
    cur = out;
  }
  return cur;
}

/** Remove consecutive duplicate points (and the closing duplicate for rings). */
export function dedupe(pts: number[], closed: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - pts[i]) < 1e-9 && Math.abs(out[n - 1] - pts[i + 1]) < 1e-9) continue;
    out.push(pts[i], pts[i + 1]);
  }
  if (closed && out.length >= 4) {
    const n = out.length;
    if (Math.abs(out[0] - out[n - 2]) < 1e-9 && Math.abs(out[1] - out[n - 1]) < 1e-9) out.length -= 2;
  }
  return out;
}

/** Resample to exactly `count` points evenly spaced by arc length. */
export function resample(pts: number[], closed: boolean, count: number): number[] {
  const m = pts.length / 2;
  const src = closed ? pts.concat(pts[0], pts[1]) : pts;
  const sm = src.length / 2;
  const cum = new Float64Array(sm);
  for (let i = 1; i < sm; i++) cum[i] = cum[i - 1] + Math.hypot(src[2 * i] - src[2 * i - 2], src[2 * i + 1] - src[2 * i - 1]);
  const total = cum[sm - 1];
  const out: number[] = [];
  if (total === 0 || m === 0) {
    for (let k = 0; k < count; k++) out.push(pts[0] ?? 0, pts[1] ?? 0);
    return out;
  }
  const steps = closed ? count : count - 1;
  let seg = 1;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / Math.max(1, steps);
    while (seg < sm - 1 && cum[seg] < target) seg++;
    const t0 = cum[seg - 1], t1 = cum[seg];
    const t = t1 > t0 ? (target - t0) / (t1 - t0) : 0;
    out.push(src[2 * seg - 2] + (src[2 * seg] - src[2 * seg - 2]) * t, src[2 * seg - 1] + (src[2 * seg + 1] - src[2 * seg - 1]) * t);
  }
  return out;
}
