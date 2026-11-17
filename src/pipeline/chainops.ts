/**
 * Clean-up passes on traced pixel chains:
 *  - pruneSpurs: drop short whiskers that thinning leaves on lines;
 *  - joinChains: merge chains whose ends meet and continue in the same
 *    direction (across junctions and small gaps), so one curve is one shape.
 * Fewer, longer chains mean fewer Desmos expressions and smoother fits.
 */

import type { Chain } from './chains';
import { pathLength } from './chains';

interface End {
  chain: number;
  atStart: boolean;
  x: number;
  y: number;
  /** Unit vector pointing out of the chain at this end. */
  dx: number;
  dy: number;
}

function endOf(c: Chain, idx: number, atStart: boolean): End {
  const p = c.pts;
  const m = p.length / 2;
  const look = Math.min(m - 1, 6);
  const i0 = atStart ? 0 : m - 1;
  const i1 = atStart ? look : m - 1 - look;
  const x = p[2 * i0], y = p[2 * i0 + 1];
  let dx = x - p[2 * i1], dy = y - p[2 * i1 + 1];
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  return { chain: idx, atStart, x, y, dx, dy };
}

/** Short open chains that hang off another chain at one end (or both ends free and tiny). */
export function pruneSpurs(chains: Chain[], spurLength: number): Chain[] {
  if (spurLength <= 0 || chains.length < 2) return chains;
  // Index every chain end on a coarse grid to find "touching" ends quickly.
  const near = (x: number, y: number, skip: number) => {
    for (let j = 0; j < chains.length; j++) {
      if (j === skip) continue;
      const p = chains[j].pts;
      for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) <= 1.5 && Math.abs(p[k + 1] - y) <= 1.5) return true;
    }
    return false;
  };
  const out: Chain[] = [];
  chains.forEach((c, i) => {
    if (c.closed) return out.push(c);
    const len = pathLength(c.pts, false);
    if (len >= spurLength) return out.push(c);
    const m = c.pts.length / 2;
    const a = near(c.pts[0], c.pts[1], i);
    const b = near(c.pts[2 * m - 2], c.pts[2 * m - 1], i);
    // A spur touches the network at exactly one end.
    if (a !== b) return;
    out.push(c);
  });
  return out;
}

export interface JoinOptions {
  /** Max distance between ends to join (px). */
  gap: number;
  /** Min |cos| of the turn when continuing (0.5 = up to 60 degrees). */
  minAlign: number;
}

export function joinChains(input: Chain[], o: JoinOptions = { gap: 2.9, minAlign: 0.55 }): Chain[] {
  let chains = input.map((c) => ({ pts: c.pts.slice(), closed: c.closed }));
  for (let pass = 0; pass < 6; pass++) {
    const ends: End[] = [];
    chains.forEach((c, i) => {
      if (c.closed || c.pts.length < 4) return;
      ends.push(endOf(c, i, true), endOf(c, i, false));
    });
    // Candidate pairs scored by alignment (continuing direction) and distance.
    const cell = Math.max(2, o.gap);
    const grid = new Map<string, number[]>();
    ends.forEach((e, k) => {
      const key = `${Math.floor(e.x / cell)},${Math.floor(e.y / cell)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
    });
    const pairs: [number, number, number][] = [];
    ends.forEach((a, ka) => {
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++)
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const kb of grid.get(`${gx},${gy}`) ?? []) {
            if (kb <= ka) continue;
            const b = ends[kb];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > o.gap) continue;
            // Smooth continuation: the two outward directions point at each other.
            const align = -(a.dx * b.dx + a.dy * b.dy);
            if (align < o.minAlign) continue;
            if (a.chain === b.chain) {
              // Closing a loop: only for chains long enough to be a real loop.
              if (pathLength(chains[a.chain].pts, false) < 12) continue;
            }
            pairs.push([align - d * 0.05, ka, kb]);
          }
        }
    });
    if (!pairs.length) break;
    pairs.sort((p, q) => q[0] - p[0]);
    const usedEnd = new Set<number>();
    const usedChain = new Set<number>();
    const merged: { pts: number[]; closed: boolean }[] = [];
    for (const [, ka, kb] of pairs) {
      if (usedEnd.has(ka) || usedEnd.has(kb)) continue;
      const a = ends[ka], b = ends[kb];
      if (usedChain.has(a.chain) || usedChain.has(b.chain)) continue;
      usedEnd.add(ka);
      usedEnd.add(kb);
      if (a.chain === b.chain) {
        usedChain.add(a.chain);
        merged.push({ pts: chains[a.chain].pts, closed: true });
        continue;
      }
      usedChain.add(a.chain);
      usedChain.add(b.chain);
      // Orient: A must end at its joining end, B must start at its joining end.
      const pa = a.atStart ? reverse(chains[a.chain].pts) : chains[a.chain].pts;
      const pb = b.atStart ? chains[b.chain].pts : reverse(chains[b.chain].pts);
      merged.push({ pts: pa.concat(pb), closed: false });
    }
    chains = chains.filter((_, i) => !usedChain.has(i)).concat(merged);
  }
  return chains;
}

function reverse(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}
