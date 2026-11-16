/** Settings model for the convert workspace. */

import { DEFAULT_SETTINGS, type Mode, type TraceSettings } from '../../pipeline/types';

export interface UiSettings extends TraceSettings {
  strokeWidth: number;
  /** Add a text note per shape in the exported Desmos list. */
  notes: boolean;
  /** Dark (inverted) graph preview. */
  dark: boolean;
  /** Fourier mode: rotating-circle animation for the largest shape. */
  epicycles: boolean;
  /** Remembered budget per mode. */
  budgets: Record<Mode, number>;
}

export interface VideoSettings {
  fps: number;
  start: number;
  end: number;
  maxFrames: number;
}

export const IMAGE_BUDGETS: Record<Mode, number> = { outline: 2500, fill: 6000, fourier: 900 };
export const VIDEO_BUDGETS: Record<Mode, number> = { outline: 350, fill: 1200, fourier: 300 };

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
    budgets: { ...IMAGE_BUDGETS },
  };
}

export function defaultVideoSettings(): UiSettings {
  return {
    ...defaultImageSettings(),
    resolution: 240,
    smoothing: 1.5,
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
  };
}
