/**
 * Background remover. Two methods, both on the device:
 *
 *  - "auto": MODNet (Apache 2.0, about 7 MB quantized) run with transformers.js
 *    (Apache 2.0), WebGPU when available, otherwise WebAssembly. Downloads once
 *    on first use from the Hugging Face hub; the browser caches it. Good on
 *    people, photos and anime characters.
 *  - "plain": flood fill from the picture's edges through pixels close to the
 *    edge colour. Instant, no download; made for drawings on a flat background.
 *
 * Both give a mask (0..255, 255 = keep). The touch-up brushes then paint on it.
 * (Tested and left out: BiRefNet lite crashes on WebGPU, and ormbg erases pale
 * skin on illustrations.)
 */

import type { RgbaImage } from './types';

export type BgMethod = 'auto' | 'plain';

export const BG_MODEL = { id: 'Xenova/modnet', dtype: 'q8', size: 'about 7 MB', maxSide: 1024 } as const;

export interface BgMask {
  width: number;
  height: number;
  /** 0..255 per pixel, 255 = foreground. */
  alpha: Uint8ClampedArray;
}

export interface BgProgress {
  /** 0..1 while downloading, then 1. */
  loaded: number;
  stage: 'download' | 'run';
}

type Segmenter = (input: unknown) => Promise<{ data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number }>;

let segmenter: Promise<Segmenter> | null = null;

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function loadSegmenter(onProgress?: (p: BgProgress) => void): Promise<Segmenter> {
  if (!segmenter) {
    segmenter = (async () => {
      const tf = await import('@huggingface/transformers');
      tf.env.allowLocalModels = false; // GitHub Pages has no /models folder: always use the hub
      const files = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== 'progress' || !e.file || !e.total) return;
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
        let l = 0, t = 0;
        for (const f of files.values()) {
          l += f.loaded;
          t += f.total;
        }
        onProgress?.({ loaded: t ? l / t : 0, stage: 'download' });
      };
      const make = (device: 'webgpu' | 'wasm') =>
        tf.pipeline('background-removal', BG_MODEL.id, { device, dtype: BG_MODEL.dtype, progress_callback }) as unknown as Promise<Segmenter>;
      if (await hasWebGpu()) {
        try {
          return await make('webgpu');
        } catch {
          // Some GPUs reject a kernel: WebAssembly always works.
        }
      }
      return make('wasm');
    })();
    segmenter.catch(() => (segmenter = null));
  }
  return segmenter;
}

/** Run the model on a canvas (scaled to the model's working size) and return the foreground mask. */
export async function segment(canvas: HTMLCanvasElement, onProgress?: (p: BgProgress) => void): Promise<BgMask> {
  const seg = await loadSegmenter(onProgress);
  onProgress?.({ loaded: 1, stage: 'run' });
  const tf = await import('@huggingface/transformers');
  let input = canvas;
  if (Math.max(canvas.width, canvas.height) > BG_MODEL.maxSide) {
    const s = BG_MODEL.maxSide / Math.max(canvas.width, canvas.height);
    input = document.createElement('canvas');
    input.width = Math.round(canvas.width * s);
    input.height = Math.round(canvas.height * s);
    input.getContext('2d')!.drawImage(canvas, 0, 0, input.width, input.height);
  }
  const out = await seg(tf.RawImage.fromCanvas(input));
  const n = out.width * out.height;
  const alpha = new Uint8ClampedArray(n);
  if (out.channels === 4) for (let i = 0; i < n; i++) alpha[i] = out.data[i * 4 + 3];
  else for (let i = 0; i < n; i++) alpha[i] = out.data[i * out.channels];
  return { width: out.width, height: out.height, alpha };
}

/**
 * Plain-background removal: flood fill from every edge pixel through pixels
 * whose colour is within `tolerance` (0..100) of the background colour (the
 * most common edge colour). Everything reached is background.
 */
export function plainBackground(img: RgbaImage, tolerance = 18): BgMask {
  const { width: w, height: h, data } = img;
  const n = w * h;
  // Background colour: the most common quantised colour around the border.
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const visitEdge = (i: number) => {
    const p = i * 4;
    const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += data[p];
    c.g += data[p + 1];
    c.b += data[p + 2];
    counts.set(key, c);
  };
  for (let x = 0; x < w; x++) visitEdge(x), visitEdge((h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) visitEdge(y * w), visitEdge(y * w + w - 1);
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  const br = best.r / best.n, bgc = best.g / best.n, bb = best.b / best.n;
  const lim = (tolerance / 100) * 255 * Math.sqrt(3);
  const lim2 = lim * lim;
  const near = (i: number) => {
    const p = i * 4;
    if (data[p + 3] < 16) return true; // already transparent
    const dr = data[p] - br, dg = data[p + 1] - bgc, db = data[p + 2] - bb;
    return dr * dr + dg * dg + db * db <= lim2;
  };
  const alpha = new Uint8ClampedArray(n).fill(255);
  const stack: number[] = [];
  const push = (i: number) => {
    if (alpha[i] === 0 || !near(i)) return;
    alpha[i] = 0;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return { width: w, height: h, alpha };
}

/** A mask as a canvas whose alpha channel is the mask (white pixels), ready for destination-in compositing. */
export function maskToCanvas(mask: BgMask): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const id = new ImageData(mask.width, mask.height);
  for (let i = 0; i < mask.alpha.length; i++) {
    const p = i * 4;
    id.data[p] = 255;
    id.data[p + 1] = 255;
    id.data[p + 2] = 255;
    id.data[p + 3] = mask.alpha[i];
  }
  c.getContext('2d')!.putImageData(id, 0, 0);
  return c;
}
