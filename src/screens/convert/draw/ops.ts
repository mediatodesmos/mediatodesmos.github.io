/**
 * Drawing operations, stored in source fractions (0..1 of the picture's width
 * and height; sizes as a fraction of the long side), so they survive crop and
 * resolution changes and replay identically at any size.
 */

export type Pt = [number, number];

export type DrawOp =
  /** Freehand pen or eraser stroke (eraser removes earlier drawing, never the picture). */
  | { t: 'path'; pts: number[]; color: string; width: number; erase?: boolean }
  /** Straight line, rectangle or ellipse, outlined or filled. */
  | { t: 'line' | 'rect' | 'ellipse'; a: Pt; b: Pt; color: string; width: number; fill?: boolean }
  /** Fill bucket: flood fills the area under (x, y) as it looks at that point. */
  | { t: 'fill'; x: number; y: number; color: string; tolerance: number }
  /** Text in a loaded font. */
  | { t: 'text'; x: number; y: number; text: string; size: number; color: string; font: string };

/** A stroke of the region detail brush (more detail where painted). */
export interface DetailStroke {
  pts: number[];
  /** Brush radius as a fraction of the long side. */
  r: number;
}

/** The fonts available to the text tool: built in, or imported by the user this session. */
export const BUILTIN_FONTS = ['Geist', 'Newsreader', 'Geist Mono'];

/** Smooth a freehand path with a moving average (keeps the ends). */
export function smoothPath(pts: number[], strength = 2): number[] {
  const n = pts.length / 2;
  if (n < 3 || strength <= 0) return pts.slice();
  const out = pts.slice();
  for (let i = 1; i < n - 1; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let k = -strength; k <= strength; k++) {
      const j = Math.max(0, Math.min(n - 1, i + k));
      sx += pts[2 * j];
      sy += pts[2 * j + 1];
      c++;
    }
    out[2 * i] = sx / c;
    out[2 * i + 1] = sy / c;
  }
  return out;
}

function rgbOf(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Flood fill at (x, y) px: every connected pixel whose colour is within
 * `tolerance` (0..100) of the start colour, judged on `look` (what the user
 * sees); the result is painted into `target` (the drawing layer).
 */
export function floodFill(look: ImageData, target: ImageData, x: number, y: number, color: string, tolerance: number): void {
  const { width: w, height: h } = look;
  const sx = Math.round(x), sy = Math.round(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
  const L = look.data, T = target.data;
  const s = (sy * w + sx) * 4;
  const r0 = L[s], g0 = L[s + 1], b0 = L[s + 2];
  const lim = (tolerance / 100) * 255 * Math.sqrt(3);
  const lim2 = lim * lim;
  const [r, g, b] = rgbOf(color);
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const p = i * 4;
    T[p] = r;
    T[p + 1] = g;
    T[p + 2] = b;
    T[p + 3] = 255;
    const px = i % w, py = (i - px) / w;
    const tryAt = (j: number) => {
      if (seen[j]) return;
      const q = j * 4;
      const dr = L[q] - r0, dg = L[q + 1] - g0, db = L[q + 2] - b0;
      if (dr * dr + dg * dg + db * db > lim2) return;
      seen[j] = 1;
      stack.push(j);
    };
    if (px > 0) tryAt(i - 1);
    if (px < w - 1) tryAt(i + 1);
    if (py > 0) tryAt(i - w);
    if (py < h - 1) tryAt(i + w);
  }
  // Grow one pixel so filled areas tuck under antialiased outlines (no hairline gaps).
  const grown = new Uint8Array(seen);
  for (let i = 0; i < seen.length; i++) {
    if (seen[i]) continue;
    const px = i % w;
    if ((px > 0 && seen[i - 1]) || (px < w - 1 && seen[i + 1]) || (i >= w && seen[i - w]) || (i + w < seen.length && seen[i + w])) grown[i] = 1;
  }
  for (let i = 0; i < grown.length; i++) {
    if (!grown[i] || seen[i]) continue;
    const p = i * 4;
    T[p] = r;
    T[p + 1] = g;
    T[p + 2] = b;
    T[p + 3] = 255;
  }
}

/**
 * Replay drawing operations onto `layer` (the drawing layer, transparent),
 * sized W x H. `under` is the picture underneath, needed by the fill bucket
 * to see what the user sees.
 */
export function renderOps(layer: CanvasRenderingContext2D, ops: DrawOp[], W: number, H: number, under?: CanvasImageSource): void {
  const L = Math.max(W, H);
  const g = layer;
  for (const op of ops) {
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (op.t === 'path') {
      g.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
      g.strokeStyle = op.erase ? '#000' : op.color;
      g.fillStyle = g.strokeStyle;
      g.lineWidth = Math.max(0.5, op.width * L);
      const p = op.pts;
      if (p.length === 2) {
        g.beginPath();
        g.arc(p[0] * W, p[1] * H, g.lineWidth / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.beginPath();
        g.moveTo(p[0] * W, p[1] * H);
        for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * W, p[i + 1] * H);
        g.stroke();
      }
    } else if (op.t === 'line' || op.t === 'rect' || op.t === 'ellipse') {
      g.strokeStyle = op.color;
      g.fillStyle = op.color;
      g.lineWidth = Math.max(0.5, op.width * L);
      const ax = op.a[0] * W, ay = op.a[1] * H, bx = op.b[0] * W, by = op.b[1] * H;
      g.beginPath();
      if (op.t === 'line') {
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      } else {
        if (op.t === 'rect') g.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
        else g.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
        if (op.fill) g.fill();
        else g.stroke();
      }
    } else if (op.t === 'text') {
      g.fillStyle = op.color;
      g.textBaseline = 'alphabetic';
      g.font = `${Math.max(4, op.size * L)}px "${op.font}", sans-serif`;
      const lines = op.text.split('\n');
      const lh = Math.max(4, op.size * L) * 1.2;
      lines.forEach((line, i) => g.fillText(line, op.x * W, op.y * H + i * lh));
    } else if (op.t === 'fill') {
      // Look at the picture plus the drawing so far, paint into the drawing layer.
      const look = document.createElement('canvas');
      look.width = W;
      look.height = H;
      const lg = look.getContext('2d', { willReadFrequently: true })!;
      lg.fillStyle = '#fff';
      lg.fillRect(0, 0, W, H);
      if (under) lg.drawImage(under, 0, 0, W, H);
      lg.drawImage(layer.canvas, 0, 0);
      const target = g.getImageData(0, 0, W, H);
      floodFill(lg.getImageData(0, 0, W, H), target, op.x * W, op.y * H, op.color, op.tolerance);
      g.putImageData(target, 0, 0);
    }
    g.restore();
  }
}
