/**
 * LaTeX builders for Desmos expressions.
 *
 * Desmos quirk (verified in the spike): a list literal written right after
 * an expression is parsed as list INDEXING, e.g. `t^{3}\left[1,2\right]`
 * means "index t^3 with [1,2]". We always multiply lists in with \cdot.
 */

/** Desmos "undefined": used as a placeholder list item that draws nothing. */
export const UNDEF = '\\frac{0}{0}';

/** Compact number: rounded to `decimals`, no trailing zeros, no "-0". */
export function num(v: number, decimals = 1): string {
  if (!Number.isFinite(v)) return UNDEF;
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  if (r === 0) return '0';
  return String(r);
}

export function list(values: (number | string)[], decimals = 1): string {
  return '\\left[' + values.map((v) => (typeof v === 'number' ? num(v, decimals) : v)).join(',') + '\\right]';
}

/** `name\left[U\left[F\right]...V\left[F\right]\right]`: the slice of a list for the current frame. */
export function slice(name: string, start: string, end: string, frameVar = 'F'): string {
  return `${name}\\left[${start}\\left[${frameVar}\\right]...${end}\\left[${frameVar}\\right]\\right]`;
}

/**
 * Cubic Bezier as a parametric point, broadcast over lists:
 *   ((1-t)^3 X0 + 3t(1-t)^2 X1 + 3t^2(1-t) X2 + t^3 X3, same for Y)
 * Each argument is a list (literal or variable) of equal length.
 */
export function bezierLatex(x0: string, x1: string, x2: string, x3: string, y0: string, y1: string, y2: string, y3: string): string {
  // Note the space after \cdot: "\cdotX" would be read as an unknown command.
  const part = (a: string, b: string, c: string, d: string) =>
    `\\left(1-t\\right)^{3}\\cdot ${a}+3t\\left(1-t\\right)^{2}\\cdot ${b}+3t^{2}\\left(1-t\\right)\\cdot ${c}+t^{3}\\cdot ${d}`;
  return `\\left(${part(x0, x1, x2, x3)},${part(y0, y1, y2, y3)}\\right)`;
}

/** polygon((X, Y)) with list X and list Y: one polygon through all the points. */
export function polygonLatex(xs: string, ys: string): string {
  return `\\operatorname{polygon}\\left(\\left(${xs},${ys}\\right)\\right)`;
}

/**
 * Fourier series parametric curve, t in [0, 1]:
 *   x(t) = total(R cos(2 pi K t) - I sin(2 pi K t))
 *   y(t) = total(R sin(2 pi K t) + I cos(2 pi K t))
 */
export function fourierLatex(k: string, re: string, im: string): string {
  const arg = `2\\pi t\\cdot ${k}`;
  const x = `\\operatorname{total}\\left(${re}\\cdot\\cos\\left(${arg}\\right)-${im}\\cdot\\sin\\left(${arg}\\right)\\right)`;
  const y = `\\operatorname{total}\\left(${re}\\cdot\\sin\\left(${arg}\\right)+${im}\\cdot\\cos\\left(${arg}\\right)\\right)`;
  return `\\left(${x},${y}\\right)`;
}

/** Flip image y (down) to Desmos y (up). */
export const flipY = (y: number, height: number) => height - y;
