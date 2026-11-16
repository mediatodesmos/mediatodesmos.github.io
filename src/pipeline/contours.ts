/**
 * Marching squares with linear interpolation: sub-pixel contours of a
 * scalar field at a threshold, with consistent orientation and
 * correct saddle handling. Contours are always closed (the field is padded
 * with "outside" values).
 *
 * Orientation (image coordinates, y down): outer boundaries come out with
 * NEGATIVE shoelace area, holes with POSITIVE area.
 */

import type { BBox } from './types';

export interface Ring {
  /** Flat [x0, y0, x1, y1, ...] in pixel-centre coordinates, not closed. */
  pts: number[];
  /** Signed shoelace area (negative = outer boundary, positive = hole). */
  area: number;
  bbox: BBox;
}

/**
 * @param field values per pixel (w*h)
 * @param level contour level
 * @param above true: "inside" means value > level; false: value < level
 */
export function marchingSquares(field: Float32Array, w: number, h: number, level: number, above: boolean): Ring[] {
  // Map to a padded grid where inside <=> g > 0.
  const PW = w + 2;
  const PH = h + 2;
  // Pad with the "paper" extreme so border contours sit half a pixel outside the image.
  const pad = Math.min(-1e-3, above ? -level : level - 255);
  const g = new Float32Array(PW * PH).fill(pad);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = field[y * w + x] - level;
      g[(y + 1) * PW + (x + 1)] = above ? v : -v;
    }
  }
  // Exact zeros cause ambiguous crossings; nudge them outside.
  for (let i = 0; i < g.length; i++) if (g[i] === 0) g[i] = -1e-6;

  const inside = (i: number) => g[i] > 0;
  const next = new Int32Array(PW * PH * 2).fill(-1);
  const H = (i: number, j: number) => 2 * (j * PW + i);
  const V = (i: number, j: number) => 2 * (j * PW + i) + 1;

  for (let j = 0; j < PH - 1; j++) {
    for (let i = 0; i < PW - 1; i++) {
      const tl = j * PW + i, tr = tl + 1, bl = tl + PW, br = bl + 1;
      const cTL = inside(tl), cTR = inside(tr), cBR = inside(br), cBL = inside(bl);
      if (cTL === cTR && cTR === cBR && cBR === cBL) continue;
      // Edges clockwise: top (TL->TR), right (TR->BR), bottom (BR->BL), left (BL->TL)
      const edgeIds = [H(i, j), V(i + 1, j), H(i, j + 1), V(i, j)];
      const starts = [cTL, cTR, cBR, cBL];
      const ends = [cTR, cBR, cBL, cTL];
      const type: number[] = [0, 0, 0, 0]; // 1 = in-crossing, -1 = out-crossing, 0 = none
      let ins = 0;
      for (let k = 0; k < 4; k++) {
        if (starts[k] && !ends[k]) type[k] = -1;
        else if (!starts[k] && ends[k]) {
          type[k] = 1;
          ins++;
        }
      }
      if (ins === 1) {
        const a = type.indexOf(1);
        const b = type.indexOf(-1);
        next[edgeIds[a]] = edgeIds[b];
      } else if (ins === 2) {
        const center = (g[tl] + g[tr] + g[br] + g[bl]) / 4 > 0;
        for (let k = 0; k < 4; k++) {
          if (type[k] !== 1) continue;
          const partner = center ? (k + 3) % 4 : (k + 1) % 4;
          next[edgeIds[k]] = edgeIds[partner];
        }
      }
    }
  }

  // Crossing point on an edge, in unpadded pixel coordinates.
  const point = (e: number, out: number[]) => {
    const cell = e >> 1;
    const i = cell % PW;
    const j = (cell - i) / PW;
    let ax: number, ay: number, bx: number, by: number;
    if ((e & 1) === 0) {
      ax = i; ay = j; bx = i + 1; by = j;
    } else {
      ax = i; ay = j; bx = i; by = j + 1;
    }
    const va = g[ay * PW + ax];
    const vb = g[by * PW + bx];
    const t = va / (va - vb);
    out.push(ax + (bx - ax) * t - 1, ay + (by - ay) * t - 1);
  };

  const rings: Ring[] = [];
  for (let e = 0; e < next.length; e++) {
    if (next[e] < 0) continue;
    const pts: number[] = [];
    let cur = e;
    let guard = 0;
    while (cur >= 0 && guard++ < 10_000_000) {
      point(cur, pts);
      const nx = next[cur];
      next[cur] = -2; // consumed
      if (nx === e || nx < 0) break;
      cur = nx;
    }
    if (pts.length >= 6) rings.push(makeRing(pts));
  }
  return rings;
}

export function makeRing(pts: number[]): Ring {
  return { pts, area: signedArea(pts), bbox: bboxOf(pts) };
}

export function signedArea(pts: number[]): number {
  let a = 0;
  const m = pts.length / 2;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    a += pts[2 * j] * pts[2 * i + 1] - pts[2 * i] * pts[2 * j + 1];
  }
  return a / 2;
}

export function bboxOf(pts: number[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Even-odd point-in-polygon test. */
export function pointInRing(x: number, y: number, pts: number[]): boolean {
  let inside = false;
  const m = pts.length / 2;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const xi = pts[2 * i], yi = pts[2 * i + 1];
    const xj = pts[2 * j], yj = pts[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface RingGroup {
  outer: Ring;
  holes: Ring[];
}

/** Attach every hole to the smallest outer ring that contains it. Orphan holes are discarded. */
export function groupRings(rings: Ring[]): RingGroup[] {
  const outers = rings.filter((r) => r.area < 0).sort((a, b) => a.area - b.area); // largest |area| first
  const holes = rings.filter((r) => r.area > 0);
  const groups: RingGroup[] = outers.map((outer) => ({ outer, holes: [] }));
  for (const hole of holes) {
    const hx = hole.pts[0], hy = hole.pts[1];
    let best: RingGroup | null = null;
    for (const gr of groups) {
      const b = gr.outer.bbox;
      if (hole.bbox[0] < b[0] - 1 || hole.bbox[1] < b[1] - 1 || hole.bbox[2] > b[2] + 1 || hole.bbox[3] > b[3] + 1) continue;
      if (!pointInRing(hx, hy, gr.outer.pts)) continue;
      if (!best || -gr.outer.area < -best.outer.area) best = gr;
    }
    if (best) best.holes.push(hole);
  }
  return groups;
}
