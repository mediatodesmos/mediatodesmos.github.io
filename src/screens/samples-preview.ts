/** Real traced output of the built-in samples, for the home page card stack. */

import { getPool } from '../pipeline/pool';
import { DEFAULT_SETTINGS, type TraceSettings } from '../pipeline/types';
import { rasterize } from '../media/raster';
import { drawSampleImage, SampleVideo } from '../media/samples';
import { resultToSvg } from '../render/shapes';

type PreviewMode = 'outline' | 'fill' | 'fourier' | 'video';

const cache = new Map<PreviewMode, Promise<SVGSVGElement | null>>();

const SETTINGS: Record<PreviewMode, Partial<TraceSettings>> = {
  outline: { mode: 'outline', lineSource: 'edges', edgeDetail: 50, smoothing: 1, budget: 1500, blur: 1 },
  fill: { mode: 'fill', lineSource: 'contours', smoothing: 0.8, budget: 4000, blur: 0.6 },
  fourier: { mode: 'fourier', lineSource: 'contours', fourierTerms: 28, budget: 600, blur: 0.8 },
  video: { mode: 'outline', lineSource: 'contours', smoothing: 1, budget: 800, blur: 0.8 },
};

export function samplePreview(mode: PreviewMode): Promise<SVGSVGElement | null> {
  let p = cache.get(mode);
  if (!p) {
    p = make(mode).catch(() => null);
    cache.set(mode, p);
  }
  // Clone so the same preview can be shown in several places.
  return p.then((svg) => (svg ? (svg.cloneNode(true) as SVGSVGElement) : null));
}

async function make(mode: PreviewMode): Promise<SVGSVGElement | null> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  const img =
    mode === 'video'
      ? rasterize(new SampleVideo().drawFrame(1.3, 640, 360), 320)
      : rasterize(drawSampleImage(960, 640), 360);
  const res = await getPool().run(img, { ...DEFAULT_SETTINGS, ...SETTINGS[mode], resolution: img.width });
  return resultToSvg(res, { ink: '#111111', strokeWidth: mode === 'fill' ? 0 : 1.3, className: 'sample-svg' });
}
