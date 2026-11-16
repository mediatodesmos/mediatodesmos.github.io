/** Draw traced shapes as SVG paths or onto a canvas (previews, overlays, thumbnails). */

import type { Shape, TraceResult } from '../pipeline/types';
import { sampleFourier } from '../pipeline/fourier';
import { svgEl } from '../ui/dom';

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function shapePath(sh: Shape): string {
  if (sh.kind === 'stroke') {
    const s = sh.segs;
    if (!s.length) return '';
    let d = `M${f1(s[0])} ${f1(s[1])}`;
    for (let o = 0; o < s.length; o += 8) {
      const jump = o > 0 && (Math.abs(s[o] - s[o - 2]) > 0.01 || Math.abs(s[o + 1] - s[o - 1]) > 0.01);
      if (jump) d += `M${f1(s[o])} ${f1(s[o + 1])}`;
      d += `C${f1(s[o + 2])} ${f1(s[o + 3])} ${f1(s[o + 4])} ${f1(s[o + 5])} ${f1(s[o + 6])} ${f1(s[o + 7])}`;
    }
    return d + (sh.closed ? 'Z' : '');
  }
  if (sh.kind === 'region') {
    return sh.rings
      .map((r) => {
        let d = `M${f1(r[0])} ${f1(r[1])}`;
        for (let i = 2; i < r.length; i += 2) d += `L${f1(r[i])} ${f1(r[i + 1])}`;
        return d + 'Z';
      })
      .join('');
  }
  const pts = sampleFourier(sh, Math.min(600, Math.max(60, sh.freq.length * 12)));
  let d = `M${f1(pts[0])} ${f1(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${f1(pts[i])} ${f1(pts[i + 1])}`;
  return d + 'Z';
}

export interface SvgOptions {
  ink?: string;
  paper?: string | null;
  strokeWidth?: number;
  className?: string;
}

/** A self-contained SVG of a trace result (viewBox = working pixels). */
export function resultToSvg(res: TraceResult, opts: SvgOptions = {}): SVGSVGElement {
  const ink = opts.ink ?? '#000';
  const sw = opts.strokeWidth ?? Math.max(1, Math.max(res.width, res.height) / 300);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${res.width} ${res.height}`,
    xmlns: 'http://www.w3.org/2000/svg',
    class: opts.className ?? '',
    attrs: { role: 'img', 'aria-label': `Traced ${res.mode} preview, ${res.shapes.length} shapes` },
  });
  if (opts.paper) svg.appendChild(svgEl('rect', { x: 0, y: 0, width: res.width, height: res.height, fill: opts.paper }));
  for (const sh of res.shapes) {
    const d = shapePath(sh);
    if (!d) continue;
    if (sh.kind === 'region') svg.appendChild(svgEl('path', { d, fill: ink, 'fill-rule': 'evenodd' }));
    else svg.appendChild(svgEl('path', { d, fill: 'none', stroke: ink, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  return svg;
}

export function resultToSvgString(res: TraceResult, opts: SvgOptions = {}): string {
  return new XMLSerializer().serializeToString(resultToSvg(res, opts));
}

export interface CanvasDrawOptions {
  ink?: string;
  strokeWidth?: number;
  highlight?: Set<number> | null;
  highlightColor?: string;
  /** Dim everything that is not highlighted. */
  dimOthers?: boolean;
}

const pathCache = new WeakMap<Shape, Path2D>();
function path2d(sh: Shape): Path2D {
  let p = pathCache.get(sh);
  if (!p) {
    p = new Path2D(shapePath(sh));
    pathCache.set(sh, p);
  }
  return p;
}

/** Draw shapes onto a 2D context that is already scaled to working-pixel space. */
export function drawShapes(g: CanvasRenderingContext2D, shapes: Shape[], opts: CanvasDrawOptions = {}): void {
  const ink = opts.ink ?? '#000';
  const hl = opts.highlight;
  const hc = opts.highlightColor ?? '#3b82f6';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = opts.strokeWidth ?? 1.5;
  for (const sh of shapes) {
    const on = hl?.has(sh.id) ?? false;
    g.globalAlpha = hl && hl.size && opts.dimOthers && !on ? 0.25 : 1;
    const color = on ? hc : ink;
    const p = path2d(sh);
    if (sh.kind === 'region') {
      g.fillStyle = color;
      g.fill(p, 'evenodd');
    } else {
      g.strokeStyle = color;
      g.lineWidth = (opts.strokeWidth ?? 1.5) * (on ? 2 : 1);
      g.stroke(p);
    }
  }
  g.globalAlpha = 1;
}
