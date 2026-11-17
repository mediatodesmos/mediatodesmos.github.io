/** Shared types for the tracing pipeline. Pure data, no DOM. */

export type Mode = 'outline' | 'fill' | 'fourier';

/** Where outline / Fourier curves come from. */
export type LineSource = 'edges' | 'ink' | 'centerline' | 'contours';

export interface TraceSettings {
  mode: Mode;
  lineSource: LineSource;
  /** Working resolution: the image is scaled so its long side is this many pixels (done before tracing). */
  resolution: number;
  /** Luminance threshold 0..255 for bitmap modes; -1 means automatic (Otsu). */
  threshold: number;
  /** false: dark pixels are the foreground. true: light pixels are. */
  invert: boolean;
  /** Gaussian blur sigma in px applied before tracing (0 = none). */
  blur: number;
  /** 0..100 edge sensitivity for Canny (higher = more edges). */
  edgeDetail: number;
  /** Speckle filter: strokes shorter than this (px), or regions smaller than this squared (px^2), are dropped. */
  minSize: number;
  /** Curve-fit tolerance in px (bigger = smoother, fewer equations). */
  smoothing: number;
  /** Hard cap on total output size: Bezier segments (outline), polygon vertices (fill) or Fourier terms. */
  budget: number;
  /** Maximum Fourier terms per shape. */
  fourierTerms: number;
  /** BETA In Color: trace colour layers (fill) or colour each shape (outline, Fourier). */
  color: boolean;
  /** BETA In Color: palette size (2..16). */
  colors: number;
  /** BETA Super Enhanced: contrast stretch, denoise and sharpen before tracing. */
  enhance: boolean;
  /** BETA Line-art cleanup: remove screentone and close small gaps in ink lines. */
  lineCleanup: boolean;
}

export const DEFAULT_SETTINGS: TraceSettings = {
  mode: 'outline',
  lineSource: 'edges',
  resolution: 480,
  threshold: -1,
  invert: false,
  blur: 0.7,
  edgeDetail: 55,
  minSize: 8,
  smoothing: 1.2,
  budget: 2500,
  fourierTerms: 40,
  color: false,
  colors: 8,
  enhance: false,
  lineCleanup: false,
};

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type BBox = [minX: number, minY: number, maxX: number, maxY: number];

/** A chain of cubic Bezier segments. Coordinates are image pixels (x right, y down). */
export interface StrokeShape {
  kind: 'stroke';
  id: number;
  closed: boolean;
  /** Flat control points, 8 numbers per segment: x0 y0 x1 y1 x2 y2 x3 y3. */
  segs: number[];
  length: number;
  bbox: BBox;
  /** In Color: the stroke's colour (#rrggbb). Black when absent. */
  color?: string;
}

/** A filled region: outer ring plus holes. Rings are flat [x0,y0,x1,y1,...] without a repeated closing point. */
export interface RegionShape {
  kind: 'region';
  id: number;
  rings: number[][];
  /** Net area in px^2 (outer minus holes). */
  area: number;
  bbox: BBox;
  /** In Color: the region's colour (#rrggbb). Black when absent. */
  color?: string;
  /** In Color: stacking layer (0 = background, drawn first). */
  layer?: number;
}

/**
 * A closed curve as a truncated Fourier series:
 *   z(t) = sum_k (re_k + i im_k) e^{2 pi i freq_k t},  t in [0, 1)
 * with z = x + i y in image pixels.
 */
export interface FourierShape {
  kind: 'fourier';
  id: number;
  /** Whether the source curve was closed (open curves are traced out and back). */
  closed: boolean;
  freq: number[];
  re: number[];
  im: number[];
  length: number;
  /** Mean distance between the series and the traced curve, px. */
  error: number;
  bbox: BBox;
  /** In Color: the curve's colour (#rrggbb). Black when absent. */
  color?: string;
}

export type Shape = StrokeShape | RegionShape | FourierShape;

export interface TraceStats {
  shapes: number;
  dropped: number;
  segments: number;
  points: number;
  terms: number;
  threshold: number;
  ms: number;
}

export interface TraceResult {
  width: number;
  height: number;
  mode: Mode;
  shapes: Shape[];
  stats: TraceStats;
  /** Optional analysis view (bitmap or edge map), width*height, 0 or 255. */
  preview?: Uint8Array;
  /** Optional 256-bin luminance histogram. */
  histogram?: number[];
}

/** Cost of a shape in "budget units" for its mode. */
export function shapeCost(s: Shape): number {
  switch (s.kind) {
    case 'stroke':
      return s.segs.length / 8;
    case 'region':
      return s.rings.reduce((n, r) => n + r.length / 2, 0);
    case 'fourier':
      return s.freq.length;
  }
}
