/**
 * Live webcam mode: grab frames, trace them at low resolution and update a
 * single Desmos expression in place, several times a second.
 */

import { el, mount, fmtInt } from '../ui/dom';
import { button, emptyState, segmented, slider, spinner, stat, toast } from '../ui/components';
import { icon } from '../ui/icons';
import { openInConverter } from '../app';
import { getPool } from '../pipeline/pool';
import { DEFAULT_SETTINGS, type Mode, type TraceSettings } from '../pipeline/types';
import { GraphView } from '../desmos/embed';
import { bridgedPath, INK, regionRings, strokeColumns } from '../desmos/build';
import { bezierLatex, list, polygonLatex } from '../desmos/latex';
import { emptyState as emptyGraph, imageViewport } from '../desmos/state';
import { rasterize } from '../media/raster';

type LiveMode = Exclude<Mode, 'fourier'>;

export function renderLive(main: HTMLElement): () => void {
  let stream: MediaStream | null = null;
  let running = false;
  let graph: GraphView | null = null;
  let mode: LiveMode = 'outline';
  const ts: TraceSettings = { ...DEFAULT_SETTINGS, resolution: 200, budget: 600, smoothing: 1.6, minSize: 6, edgeDetail: 40, blur: 1.4 };
  let size = { w: 0, h: 0 };
  let frames = 0;
  let fpsT0 = performance.now();

  const video = el('video', { class: 'live-video', muted: true, playsInline: true, autoplay: true });
  const camWrap = el('div', { class: 'live-cam' }, video, el('div', { class: 'live-cam-off' }, icon('camera', { size: 28 }), el('p', null, 'Camera is off')));
  const graphHost = el('div', { class: 'ws-graph' });
  const graphStatus = el('div', { class: 'ws-graph-status' }, spinner(20), el('span', null, 'Loading Desmos...'));
  const fpsStat = stat('Updates / s', '0');
  const segStat = stat('Segments', '0');
  let startBtn: HTMLElement = button({ label: 'Start camera', icon: 'camera', variant: 'primary', onClick: () => void toggle() });
  const freezeBtn = button({ label: 'Freeze frame', icon: 'frame', variant: 'outline', disabled: true, onClick: () => void freeze() });

  const modeCtl = segmented<LiveMode>(
    [
      { value: 'outline', label: 'Outline', icon: 'pen' },
      { value: 'fill', label: 'Fill', icon: 'fill' },
    ],
    mode,
    (m) => {
      mode = m;
      ts.mode = m;
      ts.budget = m === 'fill' ? 2000 : 600;
      resetGraph();
    },
    { full: true },
  );

  const controls = el(
    'div',
    { class: 'live-controls' },
    modeCtl.el,
    slider({ label: 'Resolution', min: 96, max: 360, step: 8, value: ts.resolution, format: (v) => `${v} px`, onInput: (v) => (ts.resolution = v) }).el,
    slider({ label: 'Edge sensitivity', min: 0, max: 100, step: 1, value: ts.edgeDetail, format: (v) => `${v}%`, onInput: (v) => (ts.edgeDetail = v) }).el,
    slider({ label: 'Threshold (fill)', min: 0, max: 255, step: 1, value: 0, format: (v) => (v === 0 ? 'auto' : String(v)), onInput: (v) => (ts.threshold = v === 0 ? -1 : v) }).el,
    slider({ label: 'Curve tolerance', min: 0.5, max: 4, step: 0.1, value: ts.smoothing, format: (v) => `${v.toFixed(1)} px`, onInput: (v) => (ts.smoothing = v) }).el,
    slider({ label: 'Max segments / vertices', min: 100, max: 4000, step: 50, value: ts.budget, onInput: (v) => (ts.budget = v) }).el,
  );

  const root = el(
    'div',
    { class: 'live' },
    el(
      'div',
      { class: 'ws-top' },
      el('div', { class: 'ws-file' }, el('span', { class: 'ws-file-icon' }, icon('camera', { size: 16 })), el('div', { class: 'ws-file-text' }, el('span', { class: 'ws-file-name' }, 'Live webcam'), el('span', { class: 'ws-file-meta' }, 'Frames are traced on this device and never leave it'))),
      el('div', { class: 'ws-actions' }, freezeBtn, startBtn),
    ),
    el(
      'div',
      { class: 'live-grid' },
      el('aside', { class: 'panel scroll live-left' }, el('div', { class: 'panel-body' }, camWrap, controls)),
      el('section', { class: 'ws-center' }, el('div', { class: 'ws-graph-wrap' }, graphHost, graphStatus), el('div', { class: 'ws-stats live-stats' }, fpsStat.el, segStat.el)),
    ),
  );
  mount(main, root);

  const resetGraph = () => {
    if (!graph || !size.w) return;
    const st = emptyGraph(imageViewport(size.w, size.h));
    st.expressions.list = [
      mode === 'fill'
        ? { type: 'expression', id: 'live', color: INK, latex: polygonLatex(list([0]), list([0])), fillOpacity: '1', lines: false }
        : { type: 'expression', id: 'live', color: INK, latex: bezierLatex(...(Array(8).fill(list([0])) as [string, string, string, string, string, string, string, string])), lineWidth: '2', lineOpacity: '1' },
    ];
    graph.load(st);
  };

  GraphView.create(graphHost, { dark: true })
    .then((g) => {
      graph = g;
      graphStatus.hidden = true;
    })
    .catch((err) => {
      mount(graphStatus, icon('alert', { size: 18 }), el('span', null, err instanceof Error ? err.message : 'Desmos failed to load.'));
      graphStatus.classList.add('is-error');
    });

  async function toggle(): Promise<void> {
    if (running) return stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (err) {
      toast(err instanceof Error && err.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'No camera is available.', { tone: 'error' });
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    camWrap.classList.add('is-on');
    running = true;
    setBtn('Stop camera', 'stop');
    (freezeBtn as HTMLButtonElement).disabled = false;
    void loop();
  }

  function stop(): void {
    running = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    camWrap.classList.remove('is-on');
    setBtn('Start camera', 'camera');
    (freezeBtn as HTMLButtonElement).disabled = true;
  }

  function setBtn(label: string, ic: 'camera' | 'stop'): void {
    const fresh = button({ label, icon: ic, variant: 'primary', onClick: () => void toggle() });
    startBtn.replaceWith(fresh);
    startBtn = fresh;
  }

  async function loop(): Promise<void> {
    const pool = getPool();
    while (running) {
      const t0 = performance.now();
      if (!video.videoWidth) {
        await sleep(50);
        continue;
      }
      // Mirror like a selfie camera.
      const img = rasterize(video, ts.resolution);
      mirror(img.data, img.width, img.height);
      if (img.width !== size.w || img.height !== size.h) {
        size = { w: img.width, h: img.height };
        resetGraph();
      }
      try {
        const res = await pool.run(img, { ...ts, lineSource: mode === 'fill' ? 'contours' : 'edges', threshold: mode === 'fill' ? ts.threshold : -1 });
        if (!running) break;
        if (graph) {
          if (mode === 'fill') {
            const rings = res.shapes.flatMap((s) => (s.kind === 'region' ? regionRings(s, res.height) : []));
            const path = bridgedPath(rings);
            const xs: number[] = [], ys: number[] = [];
            for (let i = 0; i < path.length; i += 2) {
              xs.push(path[i]);
              ys.push(path[i + 1]);
            }
            graph.patch([{ id: 'live', latex: polygonLatex(list(xs.length ? xs : [0]), list(ys.length ? ys : [0])) }]);
            segStat.set(fmtInt(xs.length));
          } else {
            const segs = res.shapes.flatMap((s) => (s.kind === 'stroke' ? s.segs : []));
            const c = strokeColumns(segs.length ? segs : [0, 0, 0, 0, 0, 0, 0, 0], res.height).map((col) => list(col));
            graph.patch([{ id: 'live', latex: bezierLatex(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]) }]);
            segStat.set(fmtInt(segs.length / 8));
          }
        }
        frames++;
        const now = performance.now();
        if (now - fpsT0 > 1000) {
          fpsStat.set((frames / ((now - fpsT0) / 1000)).toFixed(1));
          frames = 0;
          fpsT0 = now;
        }
      } catch {
        /* skip a frame */
      }
      const spent = performance.now() - t0;
      await sleep(Math.max(15, 110 - spent));
    }
  }

  async function freeze(): Promise<void> {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const g = c.getContext('2d')!;
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    stop();
    openInConverter({ type: 'file', file: new File([blob], `webcam-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: 'image/png' }) });
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    mount(controls, emptyState({ icon: 'camera', title: 'No camera access', description: 'This browser does not allow camera access on this page.' }));
  }

  return () => {
    stop();
    graph?.destroy();
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mirror(d: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w >> 1; x++) {
      const a = (y * w + x) * 4, b = (y * w + (w - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) {
        const t = d[a + k];
        d[a + k] = d[b + k];
        d[b + k] = t;
      }
    }
  }
}
