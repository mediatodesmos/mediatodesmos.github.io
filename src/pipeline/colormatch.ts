/**
 * Render-matched colours (In Color). Lives apart from color.ts so the main
 * page, which only adjusts colours, does not load the painter from metrics.ts;
 * this runs in the trace worker.
 */

import type { RgbaImage, Shape } from './types';
import { paintIndex } from './metrics';
import { CHROMA_W, oklabToRgb, pixel, toOklab, type RGB } from './color';

/**
 * Match the finished colours to the picture (a per-colour "LUT" from the
 * difference between the render and the original). Paints the trace the way
 * Desmos shows it, then sets each palette colour to the typical colour of the
 * original pixels it actually covers: the OKLab mean of the closest 70% (so a
 * colour spanning two hues takes the dominant one instead of a muddy average).
 * Colours that cover almost nothing keep their value.
 */
export function matchPalette(shapes: Shape[], colors: RGB[], img: RgbaImage): RGB[] {
  const { width: w, height: h } = img;
  const k = colors.length;
  const idx = paintIndex(shapes, w, h, (sh) => (sh.paletteIndex !== undefined ? sh.paletteIndex : -1));
  const n = w * h;
  const step = Math.max(1, Math.floor(n / 200000));
  const lists: number[][] = Array.from({ length: k }, () => []);
  const cache = new Map<number, [number, number, number]>();
  for (let i = 0; i < n; i += step) {
    const c = idx[i];
    if (c < 0 || c >= k) continue;
    const px = pixel(img, i);
    const key = (px[0] << 16) | (px[1] << 8) | px[2];
    let o = cache.get(key);
    if (!o) {
      o = toOklab(px);
      if (cache.size < 100000) cache.set(key, o);
    }
    lists[c].push(o[0], o[1], o[2]);
  }
  return colors.map((col, c) => {
    const L = lists[c];
    const m = L.length / 3;
    if (m < 4) return col;
    let sl = 0, sa = 0, sb = 0;
    for (let j = 0; j < m; j++) (sl += L[j * 3]), (sa += L[j * 3 + 1]), (sb += L[j * 3 + 2]);
    sl /= m;
    sa /= m;
    sb /= m;
    const dist = new Float32Array(m);
    for (let j = 0; j < m; j++) dist[j] = (L[j * 3] - sl) ** 2 + ((L[j * 3 + 1] - sa) ** 2 + (L[j * 3 + 2] - sb) ** 2) * CHROMA_W * CHROMA_W;
    const cut = Float32Array.from(dist).sort()[Math.floor(m * 0.7)];
    let tl = 0, ta = 0, tb = 0, tn = 0;
    for (let j = 0; j < m; j++)
      if (dist[j] <= cut) {
        tl += L[j * 3];
        ta += L[j * 3 + 1];
        tb += L[j * 3 + 2];
        tn++;
      }
    return oklabToRgb(tl / tn, ta / tn, tb / tn);
  });
}
