/**
 * Link the pixels of a thin binary image (edge map or skeleton) into
 * polylines ("chains"). Chains stop at junctions and endpoints. Closed
 * loops come back as closed chains.
 */

export interface Chain {
  /** Flat pixel-centre coordinates [x0, y0, x1, y1, ...]. */
  pts: number[];
  closed: boolean;
}

// 8-neighbour offsets: 4-neighbours first so walks prefer straight steps.
const DX = [1, 0, -1, 0, 1, -1, -1, 1];
const DY = [0, 1, 0, -1, 1, 1, -1, -1];
// Clockwise ring for crossing-number: N, NE, E, SE, S, SW, W, NW
const RX = [0, 1, 1, 1, 0, -1, -1, -1];
const RY = [-1, -1, 0, 1, 1, 1, 0, -1];

export function traceChains(bin: Uint8Array, w: number, h: number, minLength: number): Chain[] {
  const n = w * h;
  const visited = new Uint8Array(n);
  const isSet = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] === 1;

  const degree = (x: number, y: number) => {
    let d = 0;
    for (let k = 0; k < 8; k++) if (isSet(x + DX[k], y + DY[k])) d++;
    return d;
  };
  // Number of 0->1 transitions around the pixel; >= 3 means a real junction.
  const crossings = (x: number, y: number) => {
    let c = 0;
    for (let k = 0; k < 8; k++) {
      const a = isSet(x + RX[k], y + RY[k]);
      const b = isSet(x + RX[(k + 1) % 8], y + RY[(k + 1) % 8]);
      if (!a && b) c++;
    }
    return c;
  };

  const isJunction = (x: number, y: number) => crossings(x, y) >= 3;

  const chains: Chain[] = [];

  const step = (x: number, y: number): number => {
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (isSet(xx, yy) && !visited[yy * w + xx]) return yy * w + xx;
    }
    return -1;
  };

  /** Walk from (x,y) along unvisited pixels; returns visited indices (excluding start). */
  const walk = (startIdx: number, chainStart: number, avoid: Set<number>): number[] => {
    const out: number[] = [];
    let cur = startIdx;
    for (;;) {
      const cx = cur % w, cy = (cur - cx) / w;
      const next = step(cx, cy);
      if (next === -1) {
        // Attach to an already visited neighbour (junction or loop start) to avoid gaps.
        let attach = -1;
        for (let k = 0; k < 8; k++) {
          const xx = cx + DX[k], yy = cy + DY[k];
          if (!isSet(xx, yy)) continue;
          const q = yy * w + xx;
          if (avoid.has(q)) continue;
          if (q === chainStart && out.length < 2) continue;
          attach = q;
          if (q === chainStart) break; // prefer closing the loop
        }
        if (attach !== -1) out.push(attach);
        break;
      }
      visited[next] = 1;
      out.push(next);
      avoid.add(next);
      cur = next;
      const nx = next % w, ny = (next - nx) / w;
      if (isJunction(nx, ny)) break;
    }
    return out;
  };

  const build = (start: number) => {
    visited[start] = 1;
    const sx = start % w, sy = (start - sx) / w;
    const avoid = new Set<number>([start]);
    const fwd = walk(start, start, avoid);
    let closed = fwd.length > 2 && fwd[fwd.length - 1] === start;
    let idxs: number[];
    if (closed) {
      idxs = [start, ...fwd];
    } else {
      const startIsEnd = degree(sx, sy) <= 1 || isJunction(sx, sy);
      if (startIsEnd) {
        idxs = [start, ...fwd];
      } else {
        // Started mid-line: also walk the other way.
        const back = walk(start, start, avoid);
        idxs = [...back.reverse(), start, ...fwd];
        closed = false;
      }
    }
    if (idxs.length < 2) return;
    const pts: number[] = [];
    for (const i of idxs) {
      const x = i % w;
      pts.push(x, (i - x) / w);
    }
    if (closed) {
      // Drop the repeated start point; the chain is implicitly closed.
      pts.length -= 2;
    }
    if (pathLength(pts, closed) >= minLength) chains.push({ pts, closed });
  };

  // Pass 1: endpoints (so open lines are traced end to end).
  for (let i = 0; i < n; i++) {
    if (!bin[i] || visited[i]) continue;
    const x = i % w, y = (i - x) / w;
    if (degree(x, y) === 1) build(i);
  }
  // Pass 2: junction pixels, then everything left (closed loops).
  for (let i = 0; i < n; i++) {
    if (!bin[i] || visited[i]) continue;
    const x = i % w, y = (i - x) / w;
    if (isJunction(x, y)) build(i);
  }
  for (let i = 0; i < n; i++) {
    if (bin[i] && !visited[i]) build(i);
  }
  return chains;
}

export function pathLength(pts: number[], closed: boolean): number {
  let len = 0;
  const m = pts.length / 2;
  for (let i = 1; i < m; i++) len += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  if (closed && m > 2) len += Math.hypot(pts[0] - pts[2 * m - 2], pts[1] - pts[2 * m - 1]);
  return len;
}
