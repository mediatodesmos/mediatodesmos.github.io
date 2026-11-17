/**
 * Home-page art.
 *  - Hero cards: traced renders of the Waguri showcase (public/showcase/, made
 *    by tools/showcase.html from local files; no original pixels are hosted).
 *    Falls back to tracing the built-in procedural sample.
 *  - "See the difference": before/after pairs drawn from our own procedural
 *    samples, so both sides can be shown.
 */

import { getPool } from '../pipeline/pool';
import { DEFAULT_SETTINGS, type RgbaImage, type TraceSettings } from '../pipeline/types';
import { rasterize } from '../media/raster';
import { drawSampleImage, SampleVideo } from '../media/samples';
import { resultToSvg } from '../render/shapes';
import { svgEl, prefersReducedMotion } from '../ui/dom';

type PreviewMode = 'outline' | 'fill' | 'fourier' | 'video';

const BASE = import.meta.env.BASE_URL + 'showcase/';
const INK = '#111111';

const SETTINGS: Record<PreviewMode, Partial<TraceSettings>> = {
  outline: { mode: 'outline', lineSource: 'ink', edgeDetail: 55, smoothing: 1, budget: 1500 },
  fill: { mode: 'fill', lineSource: 'contours', smoothing: 0.8, budget: 4000, blur: 0.6 },
  fourier: { mode: 'fourier', lineSource: 'contours', fourierTerms: 28, budget: 600, blur: 0.8 },
  video: { mode: 'outline', lineSource: 'contours', smoothing: 1, budget: 800, blur: 0.8 },
};

const svgCache = new Map<string, Promise<SVGSVGElement | null>>();

async function fetchSvg(url: string): Promise<SVGSVGElement | null> {
  const r = await fetch(url);
  if (!r.ok) return null;
  const doc = new DOMParser().parseFromString(await r.text(), 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') return null;
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

interface ClipData {
  w: number;
  h: number;
  fps: number;
  frames: (string | number)[];
}
let clipData: Promise<ClipData | null> | null = null;

/** The traced clip as an SVG whose path steps through the frames. */
async function animatedClip(): Promise<SVGSVGElement | null> {
  clipData ??= fetch(BASE + 'waguri-video.json')
    .then((r) => (r.ok ? (r.json() as Promise<ClipData>) : null))
    .catch(() => null);
  const data = await clipData;
  if (!data || !data.frames.length) return null;
  // Repeated frames are stored as the index of the frame they repeat.
  const frames: string[] = [];
  for (const f of data.frames) frames.push(typeof f === 'number' ? frames[f] ?? '' : f);
  const path = svgEl('path', { d: frames[0], fill: 'none', stroke: INK, 'stroke-width': 1.1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const svg = svgEl(
    'svg',
    { viewBox: `0 0 ${data.w} ${data.h}`, class: 'sample-svg', xmlns: 'http://www.w3.org/2000/svg', attrs: { role: 'img', 'aria-label': 'Traced video clip, playing frame by frame' } },
    path,
  );
  if (!prefersReducedMotion()) {
    let i = 0;
    let started = false;
    const timer = setInterval(() => {
      if (!svg.isConnected) {
        if (started) clearInterval(timer);
        return;
      }
      started = true;
      i = (i + 1) % frames.length;
      path.setAttribute('d', frames[i]);
    }, 1000 / data.fps);
  }
  return svg;
}

async function procedural(mode: PreviewMode): Promise<SVGSVGElement | null> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  const img =
    mode === 'video' ? rasterize(new SampleVideo().drawFrame(1.3, 640, 360), 320) : rasterize(drawSampleImage(960, 640), 360);
  const res = await getPool().run(img, { ...DEFAULT_SETTINGS, ...SETTINGS[mode], resolution: img.width });
  return resultToSvg(res, { ink: INK, strokeWidth: mode === 'fill' ? 0 : 1.3, className: 'sample-svg' });
}

export function samplePreview(mode: PreviewMode): Promise<SVGSVGElement | null> {
  if (mode === 'video') return animatedClip().then((s) => s ?? procedural('video'));
  let p = svgCache.get(mode);
  if (!p) {
    p = fetchSvg(BASE + `waguri-${mode}.svg`)
      .catch(() => null)
      .then((s) => s ?? procedural(mode));
    svgCache.set(mode, p);
  }
  return p.then((svg) => (svg ? (svg.cloneNode(true) as SVGSVGElement) : null));
}

// ------------------------------------------------------------------ before / after

export interface CompareExample {
  title: string;
  body: string;
  before: HTMLCanvasElement;
  after: SVGSVGElement;
  aspect: number;
}

function toCanvas(img: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export async function compareExamples(): Promise<CompareExample[]> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  const pool = getPool();
  const still = rasterize(drawSampleImage(960, 640), 420);
  const frame = rasterize(new SampleVideo().drawFrame(2.1, 640, 360), 420);
  const [outline, fill, video] = await Promise.all([
    pool.run(still, { ...DEFAULT_SETTINGS, mode: 'outline', lineSource: 'ink', edgeDetail: 55, resolution: still.width }),
    pool.run(still, { ...DEFAULT_SETTINGS, mode: 'fill', smoothing: 0.8, resolution: still.width }),
    pool.run(frame, { ...DEFAULT_SETTINGS, mode: 'outline', lineSource: 'edges', smoothing: 1.2, resolution: frame.width }),
  ]);
  return [
    {
      title: 'Outline',
      body: 'Ink lines become cubic Bezier curves, one short equation per stroke.',
      before: toCanvas(still),
      after: resultToSvg(outline, { ink: INK, strokeWidth: 1.4, paper: '#fff' }),
      aspect: still.width / still.height,
    },
    {
      title: 'Fill',
      body: 'Dark areas become solid polygons, with real holes for the light parts.',
      before: toCanvas(still),
      after: resultToSvg(fill, { ink: INK, paper: '#fff' }),
      aspect: still.width / still.height,
    },
    {
      title: 'Video frame',
      body: 'Every frame of a clip is traced the same way and stepped through by a slider.',
      before: toCanvas(frame),
      after: resultToSvg(video, { ink: INK, strokeWidth: 1.4, paper: '#fff' }),
      aspect: frame.width / frame.height,
    },
  ];
}
