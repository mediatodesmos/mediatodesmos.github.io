/**
 * Compact Bezier encoding.
 *
 * Instead of writing every segment's 4 control points inline in every shape
 * expression, the graph defines once:
 *   B(t,a,b,c,d) = (1-t)^3 a + 3t(1-t)^2 b + 3t^2(1-t) c + t^3 d
 *   X_1, Y_1     = lists of points, consecutive segments sharing endpoints
 *                  (a chain of n segments is 3n+1 points, not 4n)
 *   P_1(t,k)     = the Bezier segment whose first point is at index k
 * and each shape is just  P_1(t, [a, a+3 ... b]),  one curve per segment.
 * About 25% fewer numbers and a few dozen characters per shape instead of a
 * full formula. Lists are split into chunks under Desmos' 10,000-item limit.
 */

import { flipY, list, num } from './latex';

export const LIST_CAP = 9998;

/** B(t,a,b,c,d): one cubic Bezier coordinate. */
export const BEZIER_FN_ID = 'm2d-B';
export const BEZIER_FN =
  'B\\left(t,a,b,c,d\\right)=\\left(1-t\\right)^{3}a+3t\\left(1-t\\right)^{2}b+3t^{2}\\left(1-t\\right)c+t^{3}d';

/**
 * Z(t,k,a,b): a Fourier series as a point. k, a, b are lists (frequencies,
 * real and imaginary parts); total() adds every circle's contribution.
 * Defined once so each shape writes its three lists only once.
 */
export const FOURIER_FN_ID = 'm2d-Z';
export const FOURIER_FN =
  'Z\\left(t,k,a,b\\right)=\\left(\\operatorname{total}\\left(a\\cos\\left(2\\pi kt\\right)-b\\sin\\left(2\\pi kt\\right)\\right),' +
  '\\operatorname{total}\\left(a\\sin\\left(2\\pi kt\\right)+b\\cos\\left(2\\pi kt\\right)\\right)\\right)';

/** u = undefined: list filler that draws nothing. */
export const UNDEF_ID = 'm2d-u';
export const UNDEF_VAR = 'u=\\frac{0}{0}';

export const xName = (c: number | string) => `X_{${c}}`;
export const yName = (c: number | string) => `Y_{${c}}`;
export const pName = (c: number | string) => `P_{${c}}`;

/** P_c(t,k) = (B(t,X_c[k],..,X_c[k+3]), B(t,Y_c[k],..,Y_c[k+3])) */
export function pointFn(c: number | string): string {
  const X = xName(c), Y = yName(c);
  const at = (L: string, o: number) => `${L}\\left[k${o ? `+${o}` : ''}\\right]`;
  const b = (L: string) => `B\\left(t,${at(L, 0)},${at(L, 1)},${at(L, 2)},${at(L, 3)}\\right)`;
  return `${pName(c)}\\left(t,k\\right)=\\left(${b(X)},${b(Y)}\\right)`;
}

/** Segment-start indexes a, a+3, ..., b as a Desmos list. */
export function rangeLatex(a: number, b: number): string {
  if (a === b) return `\\left[${a}\\right]`;
  if (b === a + 3) return `\\left[${a},${b}\\right]`;
  return `\\left[${a},${a + 3}...${b}\\right]`;
}

/** Shared-endpoint points of a stroke (3n+1 points), flipped into Desmos y-up. */
export function strokePoints(segs: number[], H: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  const n = segs.length / 8;
  for (let s = 0; s < n; s++) {
    const o = s * 8;
    if (s === 0) {
      xs.push(segs[o]);
      ys.push(flipY(segs[o + 1], H));
    }
    xs.push(segs[o + 2], segs[o + 4], segs[o + 6]);
    ys.push(flipY(segs[o + 3], H), flipY(segs[o + 5], H), flipY(segs[o + 7], H));
  }
  return { xs, ys };
}

/** A numeric list where string items (like "u") are written as-is. */
export function packedList(values: (number | string)[], decimals: number): string {
  return '\\left[' + values.map((v) => (typeof v === 'number' ? num(v, decimals) : v)).join(',') + '\\right]';
}

export { list };
