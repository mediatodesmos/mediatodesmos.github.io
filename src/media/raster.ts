/** Decode images and draw any image-like source into an RGBA buffer at a working resolution. */

import type { RgbaImage } from '../pipeline/types';

export type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas;

export function sourceSize(src: Drawable): { width: number; height: number } {
  if (src instanceof HTMLVideoElement) return { width: src.videoWidth, height: src.videoHeight };
  if (src instanceof HTMLImageElement) return { width: src.naturalWidth, height: src.naturalHeight };
  return { width: src.width, height: src.height };
}

/** Scale so the long side is `longSide` (never upscale beyond 2x). */
export function fitSize(w: number, h: number, longSide: number): { width: number; height: number } {
  const s = Math.min(longSide / Math.max(w, h), 2);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

let scratch: HTMLCanvasElement | null = null;

export function rasterize(src: Drawable, longSide: number): RgbaImage {
  const { width: sw, height: sh } = sourceSize(src);
  const { width, height } = fitSize(sw, sh, longSide);
  if (!scratch) scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const g = scratch.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, width, height);
  g.drawImage(src as CanvasImageSource, 0, 0, width, height);
  const id = g.getImageData(0, 0, width, height);
  return { width, height, data: id.data };
}

/** Decode an image file. Falls back to <img> for formats createImageBitmap rejects (e.g. SVG). */
export async function decodeImage(file: Blob): Promise<Drawable> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      if (!img.naturalWidth) throw new Error('empty');
      // Copy into a canvas so the object URL can be released.
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 800;
      c.height = img.naturalHeight || 600;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      return c;
    } catch {
      throw new Error('This file could not be decoded as an image.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Draw a drawable into a canvas element (for previews). */
export function drawInto(canvas: HTMLCanvasElement, src: Drawable | RgbaImage, maxSide = 640): void {
  if ('data' in src && !(src instanceof HTMLCanvasElement)) {
    canvas.width = src.width;
    canvas.height = src.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), 0, 0);
    return;
  }
  const { width: sw, height: sh } = sourceSize(src as Drawable);
  const { width, height } = fitSize(sw, sh, maxSide);
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, width, height);
}

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name);
}

export function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || /\.(mp4|m4v|webm|mov|ogv|mkv)$/i.test(f.name);
}

export function isJsonFile(f: File): boolean {
  return f.type === 'application/json' || /\.json$/i.test(f.name);
}
