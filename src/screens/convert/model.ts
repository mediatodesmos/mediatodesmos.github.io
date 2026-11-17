/** Settings model for the convert workspace. */

import { DEFAULT_SETTINGS, type Mode, type TraceSettings } from '../../pipeline/types';
import { isBetaEnabled } from '../../account/beta';

export interface UiSettings extends TraceSettings {
  strokeWidth: number;
  /** Add a text note per shape in the exported Desmos list. */
  notes: boolean;
  /** Dark (inverted) graph preview. */
  dark: boolean;
  /** Fourier mode: rotating-circle animation for the largest shape. */
  epicycles: boolean;
  /** Outline: fold very short strokes into one "small details" equation. */
  mergeSmall: boolean;
  /** Quality preset the sliders were last set from. */
  quality: Quality;
  /** Show axes, grid and numbers on the preview. */
  axes: boolean;
  /** BETA In Color. */
  color: boolean;
  colors: number;
  /** BETA Auto Color: pick the colour count (and a saturation boost) automatically. */
  autoColor: boolean;
  /** Colour output: saturation multiplier (1 = as traced). */
  saturation: number;
  /** Colour output: brightness shift, -0.5..0.5. */
  brightness: number;
  /** Colour output: per-colour replacements, palette index -> #rrggbb. */
  colorOverrides: Record<number, string>;
  /** Sharpen & denoise before tracing (no longer BETA). */
  enhance: boolean;
  /** Background remover. */
  bgRemove: boolean;
  /** "auto" (MODNet model) or "plain" (flood fill a flat background). */
  bgMethod: 'auto' | 'plain';
  /** Plain method: colour tolerance 0..100. */
  bgTolerance: number;
  /** Edge softening, px. */
  bgFeather: number;
  /** BETA Line-art cleanup. */
  lineCleanup: boolean;
  /** BETA Crop and resize. */
  cropOn: boolean;
  crop: Crop | null;
  cropAspect: CropAspect;
  /** Remembered budget per mode. */
  budgets: Record<Mode, number>;
}

export type Quality = 'balanced' | 'max';

/** A crop rectangle in fractions of the source (0..1). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type CropAspect = 'free' | '1:1' | '4:3' | '16:9' | '9:16';

/** Highest working resolution for still images: 1920 px (1080p). */
export const ENHANCED_MAX_RES = 1920;
/** Largest working resolution for video frames. */
export const VIDEO_MAX_RES = 960;
/** Largest equation budget for still images. */
export const HIGH_BUDGET_MAX = 40000;

/** Slider values each preset applies (Balanced keeps Desmos fast; Max detail is for stills). */
export function presetValues(q: Quality, video: boolean): Partial<UiSettings> {
  if (q === 'max') {
    return video
      ? { resolution: 480, smoothing: 1.0, minSize: 4, edgeDetail: 60 }
      : { resolution: 960, smoothing: 0.7, minSize: 4, edgeDetail: 65, mergeSmall: false, budgets: { outline: 9000, fill: 9000, fourier: 4000 } };
  }
  return video
    ? { resolution: 320, smoothing: 1.4, minSize: 6, edgeDetail: 45 }
    : { resolution: 480, smoothing: 1.2, minSize: 8, edgeDetail: 55, mergeSmall: true, budgets: { ...IMAGE_BUDGETS } };
}

export interface VideoSettings {
  fps: number;
  start: number;
  end: number;
  maxFrames: number;
}

export const IMAGE_BUDGETS: Record<Mode, number> = { outline: 2500, fill: 6000, fourier: 900 };
export const VIDEO_BUDGETS: Record<Mode, number> = { outline: 330, fill: 1200, fourier: 300 };

export const BUDGET_RANGE: Record<Mode, { min: number; max: number; step: number; unit: string; units: string }> = {
  outline: { min: 50, max: 9000, step: 50, unit: 'segment', units: 'segments' },
  fill: { min: 100, max: 9000, step: 100, unit: 'vertex', units: 'vertices' },
  fourier: { min: 20, max: 4000, step: 20, unit: 'term', units: 'terms' },
};

export function defaultImageSettings(): UiSettings {
  return {
    ...DEFAULT_SETTINGS,
    budget: IMAGE_BUDGETS.outline,
    strokeWidth: 2,
    notes: false,
    dark: true,
    epicycles: false,
    mergeSmall: true,
    quality: 'balanced',
    axes: true,
    color: false,
    colors: 8,
    autoColor: false,
    saturation: 1,
    brightness: 0,
    colorOverrides: {},
    enhance: false,
    bgRemove: false,
    bgMethod: 'auto',
    bgTolerance: 18,
    bgFeather: 1,
    lineCleanup: false,
    cropOn: false,
    crop: null,
    cropAspect: 'free',
    budgets: { ...IMAGE_BUDGETS },
  };
}

export function defaultVideoSettings(): UiSettings {
  return {
    ...defaultImageSettings(),
    resolution: 320,
    smoothing: 1.4,
    minSize: 6,
    edgeDetail: 45,
    budget: VIDEO_BUDGETS.outline,
    budgets: { ...VIDEO_BUDGETS },
  };
}

export const MODE_INFO: Record<Mode, { label: string; blurb: string }> = {
  outline: {
    label: 'Outline',
    blurb: 'Edges become cubic Bezier curves, the classic "line drawing in Desmos" look.',
  },
  fill: {
    label: 'Fill',
    blurb: 'Dark areas become solid polygons with real holes, like a silhouette or stencil.',
  },
  fourier: {
    label: 'Fourier',
    blurb: 'Each outline becomes one equation: a sum of spinning circles. Fewer equations, softer curves.',
  },
};

export function traceSettingsOf(s: UiSettings): TraceSettings {
  const beta = isBetaEnabled();
  return {
    mode: s.mode,
    lineSource: s.mode === 'fill' ? 'contours' : s.lineSource,
    resolution: s.resolution,
    threshold: s.threshold,
    invert: s.invert,
    blur: s.blur,
    edgeDetail: s.edgeDetail,
    minSize: s.minSize,
    smoothing: s.smoothing,
    budget: s.budgets[s.mode],
    fourierTerms: s.fourierTerms,
    // BETA settings only apply for signed-in people (a saved project may carry them).
    color: beta && s.color,
    colors: s.colors,
    autoColor: beta && s.color && s.autoColor,
    enhance: s.enhance,
    lineCleanup: beta && s.lineCleanup,
  };
}

/** The crop to apply, or null (crop is a BETA feature). */
export function cropOf(s: UiSettings): Crop | null {
  return isBetaEnabled() && s.cropOn && s.crop ? s.crop : null;
}
