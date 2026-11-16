/**
 * The convert workspace: open an image, video or saved graph, tune the
 * tracer live, inspect every equation, and export to Desmos.
 */

import { el, mount, clear, debounce, fmtBytes, fmtInt } from '../../ui/dom';
import { button, chipTray, dropZone, emptyState, iconButton, progress, spinner, stat, toast } from '../../ui/components';
import { icon } from '../../ui/icons';
import { go, takePending, type PendingOpen } from '../../app';
import { getPool, CancelledError } from '../../pipeline/pool';
import type { RgbaImage, TraceResult } from '../../pipeline/types';
import { buildImageGraph, type BuiltGraph, type InspectorEntry } from '../../desmos/build';
import { buildVideoGraph, type BuiltVideo } from '../../desmos/video';
import { entriesFromState } from '../../desmos/explain';
import { GraphView, USING_DEMO_KEY } from '../../desmos/embed';
import { copyText, latexLines, parseStateFile } from '../../desmos/export';
import { imageViewport, stateWeight, type DesmosState } from '../../desmos/state';
import { decodeImage, isImageFile, isJsonFile, isVideoFile, rasterize, sourceSize, type Drawable } from '../../media/raster';
import { FileVideo, frameTimes, type VideoSource } from '../../media/video';
import { SampleVideo, sampleImageFile } from '../../media/samples';
import { drawShapes, resultToSvgString } from '../../render/shapes';
import { getProject, listProjects, MAX_SOURCE_BYTES, newProjectId, saveProject, type Project } from '../../store/projects';
import { SettingsPanel } from './settings-panel';
import { Inspector } from './inspector';
import { Analysis } from './analysis';
import { Transport, type PlaybackMode } from './transport';
import { openExportSheet, openShareSheet } from './export-sheet';
import { BUDGET_RANGE, defaultImageSettings, defaultVideoSettings, traceSettingsOf, type UiSettings, type VideoSettings } from './model';

type Source =
  | { kind: 'image'; name: string; file?: File; drawable: Drawable; width: number; height: number; bytes?: number }
  | { kind: 'video'; name: string; video: VideoSource }
  | { kind: 'state'; name: string; state: DesmosState; project?: Project };

const EXT = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toUpperCase();

export interface ConvertContext {
  /** Let the workspace use the full window width (the empty state uses the normal frame). */
  setWide: (wide: boolean) => void;
}

export function renderConvert(main: HTMLElement, ctx: ConvertContext = { setWide: () => undefined }): () => void {
  const screen = new ConvertScreen(main, ctx);
  return () => screen.destroy();
}

class ConvertScreen {
  private root: HTMLElement;
  private settings: UiSettings = defaultImageSettings();
  private video: VideoSettings | null = null;
  private source: Source | null = null;
  private graph: GraphView | null = null;
  private graphHost!: HTMLElement;
  private graphStatus!: HTMLElement;
  private previewCanvas!: HTMLCanvasElement;
  private panel!: SettingsPanel;
  private inspector!: Inspector;
  private analysis!: Analysis;
  private transport: Transport | null = null;
  private statsEls: Record<string, { el: HTMLElement; set(v: string): void }> = {};
  private result: TraceResult | null = null;
  private built: BuiltGraph | null = null;
  private builtVideo: BuiltVideo | null = null;
  private videoFrames: TraceResult[] | null = null;
  private raster: { res: number; img: RgbaImage } | null = null;
  private token = 0;
  private lastRes = 0;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private playback: PlaybackMode = 'desmos';
  private building = false;
  private cancelBuild = false;
  private projectId: string | null = null;
  private destroyed = false;
  private openListener = () => this.consumePending();
  private keyListener = (e: KeyboardEvent) => this.onKey(e);
  private ws: HTMLElement | null = null;
  private hoverHL = debounce((e: InspectorEntry | null) => this.applyHighlight(e), 40);

  constructor(main: HTMLElement, private ctx: ConvertContext) {
    this.root = el('div', { class: 'convert' });
    mount(main, this.root);
    window.addEventListener('m2d:open', this.openListener);
    window.addEventListener('keydown', this.keyListener);
    if (!this.consumePending()) this.renderEmpty();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPlayback();
    this.cancelBuild = true;
    window.removeEventListener('m2d:open', this.openListener);
    window.removeEventListener('keydown', this.keyListener);
    this.graph?.destroy();
    this.graph = null;
    if (this.source?.kind === 'video') this.source.video.dispose();
  }

  // ------------------------------------------------------------------ opening

  private consumePending(): boolean {
    const p = takePending();
    if (!p) return false;
    void this.open(p);
    return true;
  }

  private async open(p: PendingOpen): Promise<void> {
    try {
      if (p.type === 'file') await this.openFile(p.file);
      else if (p.type === 'sample') {
        if (p.kind === 'image') await this.openFile(await sampleImageFile());
        else await this.openVideo(new SampleVideo());
      } else if (p.type === 'project') await this.openProject(p.id);
      else await this.openState(p.name, p.state);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { tone: 'error', timeout: 7000 });
      if (!this.source) this.renderEmpty();
    }
  }

  private async openFile(file: File): Promise<void> {
    if (isJsonFile(file)) {
      const state = parseStateFile(await file.text());
      await this.openState(file.name.replace(/\.json$/i, ''), state);
    } else if (isVideoFile(file)) {
      this.renderLoading(`Opening ${file.name}`);
      await this.openVideo(await FileVideo.open(file));
    } else if (isImageFile(file)) {
      this.renderLoading(`Decoding ${file.name}`);
      const drawable = await decodeImage(file);
      const { width, height } = sourceSize(drawable);
      this.resetSourceState();
      this.source = { kind: 'image', name: file.name, file, drawable, width, height, bytes: file.size };
      if (!this.settings || this.video) this.settings = defaultImageSettings();
      this.video = null;
      this.projectId = null;
      await this.renderWorkspace();
      this.retraceNow();
    } else {
      throw new Error(`"${file.name}" is not an image, video or Desmos JSON file.`);
    }
  }

  private async openVideo(v: VideoSource): Promise<void> {
    this.resetSourceState();
    this.source = { kind: 'video', name: v.name, video: v };
    this.settings = defaultVideoSettings();
    const end = Math.min(v.duration, 10);
    this.video = { fps: Math.min(12, Math.round(v.nativeFps) || 12), start: 0, end, maxFrames: 240 };
    this.projectId = null;
    await this.renderWorkspace();
    this.retraceNow();
  }

  private async openState(name: string, state: DesmosState, project?: Project): Promise<void> {
    this.resetSourceState();
    this.source = { kind: 'state', name, state, project };
    this.projectId = project?.id ?? null;
    await this.renderWorkspace();
    const w = stateWeight(state);
    const vp = state.graph?.viewport ?? imageViewport(100, 100);
    this.built = {
      state,
      entries: entriesFromState(state),
      width: vp.xmax - vp.xmin,
      height: vp.ymax - vp.ymin,
      bytes: w.bytes,
      expressions: w.expressions,
    };
    this.inspector.setEntries(this.built.entries);
    this.graph?.load(state);
    const slider = state.expressions.list.find((e) => e.type === 'expression' && e.id === 'F');
    if (slider && slider.type === 'expression' && slider.slider?.max) {
      const frames = Number(slider.slider.max) || 1;
      const fps = state.expressions.ticker ? Math.round(1000 / Math.max(1, Number(state.expressions.ticker.minStepLatex) || 100)) : 10;
      this.ensureTransport(frames, fps);
    }
    this.updateStats();
  }

  private async openProject(id: string): Promise<void> {
    const p = await getProject(id);
    if (!p) throw new Error('That project no longer exists.');
    if (p.kind === 'image' && p.source) {
      const file = new File([p.source], p.sourceName ?? p.name, { type: p.source.type });
      this.settings = { ...defaultImageSettings(), ...(p.settings as Partial<UiSettings>) };
      const keep = this.settings;
      await this.openFile(file);
      this.settings = keep;
      this.panel.set(keep);
      this.projectId = p.id;
      this.retraceNow();
      return;
    }
    await this.openState(p.name, p.state, p);
  }

  private resetSourceState(): void {
    this.stopPlayback();
    if (this.source?.kind === 'video') this.source.video.dispose();
    this.result = null;
    this.built = null;
    this.builtVideo = null;
    this.videoFrames = null;
    this.raster = null;
    this.token++;
  }

  // ------------------------------------------------------------------ layout

  private renderLoading(text: string): void {
    if (this.ws) return; // keep the workspace; a toast is enough
    mount(this.root, el('div', { class: 'convert-empty' }, el('div', { class: 'convert-loading' }, spinner(28), el('p', null, text))));
  }

  private renderEmpty(): void {
    this.ctx.setWide(false);
    this.ws = null;
    this.graph?.destroy();
    this.graph = null;
    const recent = el('div', { class: 'convert-recent' });
    const card = el(
      'div',
      { class: 'convert-empty-card' },
      el('h1', { class: 'convert-empty-title' }, 'Convert a file.'),
      el('p', { class: 'lead' }, 'Drop a PNG, JPG, GIF or MP4 to trace it into black-and-white Desmos equations, or open a saved .json graph. Everything runs on your device.'),
      dropZone({
        accept: 'image/*,video/*,.json,application/json',
        title: 'Drop an image or video',
        subtitle: 'or click to browse: PNG, JPG, WebP, GIF, BMP, MP4, WebM, MOV, JSON',
        onFile: (f) => void this.open({ type: 'file', file: f }),
      }),
      el(
        'div',
        { class: 'convert-samples' },
        button({ label: 'Try a sample image', icon: 'image', variant: 'outline', onClick: () => void this.open({ type: 'sample', kind: 'image' }) }),
        button({ label: 'Try a sample video', icon: 'film', variant: 'outline', onClick: () => void this.open({ type: 'sample', kind: 'video' }) }),
      ),
      recent,
    );
    mount(this.root, el('div', { class: 'convert-empty' }, card));
    listProjects()
      .then((ps) => {
        if (!ps.length || this.ws) return;
        mount(
          recent,
          el('h2', { class: 'overline' }, 'Recent projects'),
          el(
            'div',
            { class: 'convert-recent-list' },
            ...ps.slice(0, 4).map((p) =>
              el(
                'button',
                { class: 'convert-recent-item', type: 'button', on: { click: () => void this.open({ type: 'project', id: p.id }) } },
                el('img', { src: p.thumb, alt: '', loading: 'lazy' }),
                el('span', { class: 'convert-recent-name' }, p.name),
              ),
            ),
          ),
          button({ label: 'All projects', iconRight: 'arrow-right', variant: 'ghost', size: 'sm', onClick: () => go('#/gallery') }),
        );
      })
      .catch(() => undefined);
  }

  private async renderWorkspace(): Promise<void> {
    if (this.destroyed) return;
    const src = this.source!;
    this.ctx.setWide(true);
    this.stopPlayback();
    this.graph?.destroy();
    this.graph = null;
    this.transport = null;

    // Panels
    this.panel = new SettingsPanel(this.settings, {
      onChange: (p) => this.onSettings(p),
      onVideoChange: (p) => this.onVideoSettings(p),
      onBuildVideo: () => void this.buildVideo(),
      onReset: () => {
        this.settings = src.kind === 'video' ? defaultVideoSettings() : defaultImageSettings();
        this.panel.set(this.settings);
        this.graph?.setDark(this.settings.dark);
        this.retraceNow();
      },
    });
    if (src.kind === 'video' && this.video) this.panel.setVideo(this.video, src.video.duration);
    this.inspector = new Inspector({
      onHover: (e) => this.hoverHL(e ?? this.selectedEntry()),
      onSelect: (e) => this.applyHighlight(e),
      onSolo: (e) => this.graph?.solo(e ? [e.id] : null),
      onZoom: (e) => {
        if (e.bbox && this.result) this.graph?.zoomTo(e.bbox, this.result.height);
      },
      onCopyAll: () => this.copyAll(),
    });
    this.analysis = new Analysis({
      onThreshold: (t) => {
        this.settings.threshold = t;
        this.panel.set(this.settings);
        this.retrace();
      },
    });

    // Graph area
    this.graphHost = el('div', { class: 'ws-graph', attrs: { 'aria-label': 'Desmos graph preview' } });
    this.previewCanvas = el('canvas', { class: 'ws-preview', hidden: true });
    this.graphStatus = el('div', { class: 'ws-graph-status' }, spinner(20), el('span', null, 'Loading Desmos...'));
    const graphTools = el(
      'div',
      { class: 'ws-graph-tools' },
      iconButton({ icon: 'zoom-fit', title: 'Fit to view', variant: 'card', size: 'sm', onClick: () => this.graph?.fit() }),
      iconButton({
        icon: 'contrast',
        title: 'Toggle dark preview',
        variant: 'card',
        size: 'sm',
        onClick: () => {
          this.settings.dark = !this.settings.dark;
          this.graph?.setDark(this.settings.dark);
          this.panel.set(this.settings);
          this.root.querySelector('.ws-graph-wrap')?.classList.toggle('is-paper', !this.settings.dark);
        },
      }),
    );
    const graphWrap = el('div', { class: 'ws-graph-wrap' + (this.settings.dark ? '' : ' is-paper') }, this.graphHost, this.previewCanvas, graphTools, this.graphStatus);

    // Stats row
    this.statsEls = {
      shapes: stat('Shapes', '0'),
      units: stat('Segments', '0'),
      exprs: stat('Expressions', '0'),
      size: stat('Graph size', '0 KB'),
    };
    const stats = el('div', { class: 'ws-stats stat-compact' }, ...Object.values(this.statsEls).map((s) => s.el));

    // Top bar
    const meta: string[] = [];
    if (src.kind === 'image') {
      meta.push(EXT(src.name) || 'IMAGE', `${src.width} x ${src.height}`);
      if (src.bytes) meta.push(fmtBytes(src.bytes));
    } else if (src.kind === 'video') {
      const v = src.video;
      meta.push(EXT(v.name) || 'VIDEO', `${v.width} x ${v.height}`, `${v.duration.toFixed(1)} s`, `${Math.round(v.nativeFps)} fps`);
      if (v.bytes) meta.push(fmtBytes(v.bytes));
    } else {
      meta.push('Desmos graph', `${stateWeight(src.state).expressions} expressions`);
    }
    const top = el(
      'div',
      { class: 'ws-top' },
      el(
        'div',
        { class: 'ws-file' },
        el('span', { class: 'ws-file-icon' }, icon(src.kind === 'video' ? 'film' : src.kind === 'image' ? 'image' : 'code', { size: 16 })),
        el('div', { class: 'ws-file-text' }, el('span', { class: 'ws-file-name', title: src.name }, src.name), el('span', { class: 'ws-file-meta' }, meta.join('  /  '))),
      ),
      el(
        'div',
        { class: 'ws-actions' },
        button({ label: 'New', icon: 'upload', variant: 'ghost', size: 'sm', class: 'ws-act', title: 'Open another file', onClick: () => this.pickNew() }),
        button({ label: 'Save', icon: 'save', variant: 'outline', size: 'sm', class: 'ws-act', title: 'Save to your projects', onClick: () => void this.save() }),
        button({ label: 'Share', icon: 'share', variant: 'outline', size: 'sm', class: 'ws-act', title: 'Make a share link', onClick: () => void this.share() }),
        button({ label: 'Export to Desmos', icon: 'arrow-up-right', variant: 'primary', size: 'sm', onClick: () => this.exportGraph() }),
      ),
    );

    // Mobile tabs
    const tabs = chipTray<'settings' | 'graph' | 'equations'>(
      [
        { value: 'settings', label: 'Settings', icon: 'sliders' },
        { value: 'graph', label: 'Graph', icon: 'grid' },
        { value: 'equations', label: 'Equations', icon: 'list' },
      ],
      'graph',
      (v) => {
        if (this.ws) this.ws.dataset.tab = v;
        if (v === 'graph') setTimeout(() => this.graph?.calc.resize(), 30);
      },
    );

    const centerExtra = el('div', { class: 'ws-center-extra' });
    const left =
      src.kind === 'state'
        ? el(
            'aside',
            { class: 'ws-left panel scroll' },
            el(
              'div',
              { class: 'panel-body' },
              emptyState({
                icon: 'lock',
                title: 'Saved graph',
                description:
                  src.project?.source && src.project.kind === 'video'
                    ? 'This video graph was opened from a project. Re-open the original video to change its settings.'
                    : 'This graph came from a file or link, so there is no source image to re-trace. You can still inspect, share and export it.',
                action:
                  src.project?.source && src.project.kind === 'video'
                    ? (button({
                        label: 'Re-open video',
                        icon: 'film',
                        variant: 'outline',
                        onClick: () => {
                          const p = src.project!;
                          void this.openFile(new File([p.source!], p.sourceName ?? p.name, { type: p.source!.type }));
                        },
                      }) as HTMLElement)
                    : undefined,
              }),
            ),
          )
        : el('aside', { class: 'ws-left panel scroll' }, el('div', { class: 'panel-body' }, this.analysis.el, this.panel.el));

    this.ws = el(
      'div',
      { class: 'ws', dataset: { tab: 'graph', kind: src.kind } },
      top,
      el('div', { class: 'ws-tabs' }, tabs.el),
      el(
        'div',
        { class: 'ws-grid' },
        left,
        el('section', { class: 'ws-center' }, graphWrap, centerExtra, stats),
        el('aside', { class: 'ws-right panel' }, this.inspector.el),
      ),
    );
    mount(this.root, this.ws);
    if (USING_DEMO_KEY && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      // Visible reminder for the site owner until a production key is configured.
      console.info('Media to Desmos: using the Desmos demo API key. Set VITE_DESMOS_API_KEY for production.');
    }

    // Start Desmos in the background so tracing does not wait for it.
    const ws = this.ws;
    void GraphView.create(this.graphHost, { dark: this.settings.dark }).then(
      (g) => {
        if (this.destroyed || this.ws !== ws) {
          g.destroy();
          return;
        }
        this.graph = g;
        this.graphStatus.hidden = true;
        if (this.playback !== 'preview') this.previewCanvas.hidden = true;
        if (this.built) {
          g.load(this.built.state);
          if (this.transport) g.setFrame(this.transport.current);
        }
      },
      (err) => {
        if (this.destroyed || this.ws !== ws) return;
        clear(this.graphStatus);
        this.graphStatus.append(
          icon('alert', { size: 18 }),
          el('span', null, err instanceof Error ? err.message : 'Desmos failed to load.'),
          el('span', { class: 'ws-graph-status-sub' }, 'Showing a preview drawn by Media to Desmos. Export still works.'),
          button({ label: 'Retry', icon: 'refresh', variant: 'outline', size: 'sm', onClick: () => void this.retryGraph() }),
        );
        this.graphStatus.classList.add('is-error');
        this.drawFallback();
      },
    );
  }

  private async retryGraph(): Promise<void> {
    clear(this.graphStatus);
    this.graphStatus.classList.remove('is-error');
    this.graphStatus.append(spinner(20), el('span', null, 'Loading Desmos...'));
    try {
      this.graph = await GraphView.create(this.graphHost, { dark: this.settings.dark });
      this.graphStatus.hidden = true;
      this.previewCanvas.hidden = true;
      if (this.built) this.graph.load(this.built.state);
    } catch (err) {
      clear(this.graphStatus);
      this.graphStatus.classList.add('is-error');
      this.graphStatus.append(icon('alert', { size: 18 }), el('span', null, err instanceof Error ? err.message : 'Desmos failed to load.'));
    }
  }

  /** Without Desmos (offline / blocked) show our own drawing of the shapes. */
  private drawFallback(): void {
    if (!this.result) return;
    this.drawPreviewFrame(this.result);
  }

  private pickNew(): void {
    const input = el('input', { type: 'file', accept: 'image/*,video/*,.json,application/json' });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void this.open({ type: 'file', file: f });
    });
    input.click();
  }

  // ------------------------------------------------------------------ tracing

  private onSettings(p: Partial<UiSettings>): void {
    Object.assign(this.settings, p);
    if ('dark' in p) {
      this.graph?.setDark(this.settings.dark);
      this.root.querySelector('.ws-graph-wrap')?.classList.toggle('is-paper', !this.settings.dark);
      if (this.playback === 'preview' && this.videoFrames) this.drawPreviewFrame(this.videoFrames[(this.transport?.current ?? 1) - 1]);
      return;
    }
    if ('strokeWidth' in p || 'notes' in p || 'epicycles' in p) {
      // Output-only changes: rebuild the graph without re-tracing.
      if (this.source?.kind === 'video' && this.videoFrames) {
        this.panel.setVideoStale(true, 'Rebuild video graph');
      } else if (this.result) this.applyResult(this.result, true);
      return;
    }
    if (this.source?.kind === 'video' && this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
    // Shape ids are renumbered on every trace; a new style makes an old selection meaningless.
    if ('mode' in p || 'lineSource' in p || 'resolution' in p) {
      this.inspector.clearSolo();
      if (this.inspector.selection) this.inspector.select(null);
    }
    this.retrace();
  }

  private onVideoSettings(p: Partial<VideoSettings>): void {
    if (!this.video) return;
    Object.assign(this.video, p);
    if (this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
    if ('start' in p) this.retrace();
  }

  private retrace = debounce(() => this.retraceNow(), 140);

  private async currentImage(): Promise<RgbaImage | null> {
    const src = this.source;
    const res = this.settings.resolution;
    if (!src) return null;
    if (src.kind === 'image') {
      if (!this.raster || this.raster.res !== res) this.raster = { res, img: rasterize(src.drawable, res) };
      return this.raster.img;
    }
    if (src.kind === 'video') {
      const v = this.video!;
      const probe = v.start + Math.min(v.end - v.start, 1) * 0.5;
      return src.video.frameAt(probe, res);
    }
    return null;
  }

  private async retraceNow(): Promise<void> {
    if (!this.source || this.source.kind === 'state') return;
    const tok = ++this.token;
    const img = await this.currentImage();
    if (!img || tok !== this.token || this.destroyed) return;
    this.analysis.setSource(img);
    this.ws?.classList.add('is-tracing');
    try {
      const res = await getPool().run(img, traceSettingsOf(this.settings), { preview: true, histogram: true });
      if (tok !== this.token || this.destroyed) return;
      const resChanged = this.lastRes !== res.width;
      this.lastRes = res.width;
      this.applyResult(res, !resChanged);
    } catch (err) {
      if (err instanceof CancelledError) return;
      toast(`Tracing failed: ${err instanceof Error ? err.message : String(err)}`, { tone: 'error' });
    } finally {
      if (tok === this.token) this.ws?.classList.remove('is-tracing');
    }
  }

  private applyResult(res: TraceResult, keepView: boolean): void {
    this.result = res;
    const s = this.settings;
    const usesThr = s.mode === 'fill' || s.lineSource !== 'edges';
    this.panel.setAutoThreshold(res.stats.threshold);
    this.analysis.setResult(res, {
      threshold: usesThr ? (s.threshold >= 0 ? s.threshold : res.stats.threshold) : -1,
      showHistogram: usesThr,
      bitmapLabel: s.mode !== 'fill' && s.lineSource === 'edges' ? 'Edges' : 'Bitmap',
    });
    // A built video graph stays on screen; the probe only updates the analysis card.
    if (this.source?.kind === 'video' && this.builtVideo) return;
    const name = this.source?.name ?? 'Untitled';
    this.built = buildImageGraph(res, { strokeWidth: s.strokeWidth, notes: s.notes, name, epicycles: s.epicycles });
    if (this.source?.kind === 'video') this.panel.setVideoEstimate(this.built.bytes);
    this.inspector.setEntries(this.built.entries);
    if (this.graph) {
      const sel = this.inspector.selection;
      this.graph.load(this.built.state, { keepView });
      if (sel) this.applyHighlight(this.selectedEntry());
    } else this.drawFallback();
    this.updateStats();
  }

  private updateStats(): void {
    const st = this.statsEls;
    if (!st.shapes) return;
    if (this.builtVideo) {
      const v = this.builtVideo;
      st.shapes.set(fmtInt(v.frames));
      st.units.set(fmtInt(v.chunks.reduce((n, c) => n + c.items, 0)));
      st.exprs.set(fmtInt(v.expressions));
      st.size.set(fmtBytes(v.bytes));
      this.setStatLabels('Frames', v.kind === 'fill' ? 'Polygon points' : 'Bezier segments');
      return;
    }
    if (this.result) {
      const r = this.result;
      const unit = BUDGET_RANGE[r.mode];
      st.shapes.set(fmtInt(r.stats.shapes));
      st.units.set(fmtInt(r.mode === 'outline' ? r.stats.segments : r.mode === 'fill' ? r.stats.points : r.stats.terms));
      this.setStatLabels('Shapes', unit.units[0].toUpperCase() + unit.units.slice(1));
    } else if (this.built) {
      st.shapes.set(fmtInt(this.built.entries.length));
      st.units.set('-');
      this.setStatLabels('Entries', 'Data');
    }
    if (this.built) {
      st.exprs.set(fmtInt(this.built.expressions));
      st.size.set(fmtBytes(this.built.bytes));
    }
  }

  private setStatLabels(a: string, b: string): void {
    const set = (s: { el: HTMLElement }, label: string) => {
      const l = s.el.querySelector('.stat-label, [data-stat-label]');
      if (l) l.textContent = label;
    };
    set(this.statsEls.shapes, a);
    set(this.statsEls.units, b);
  }

  // ------------------------------------------------------------------ inspector <-> graph

  private selectedEntry(): InspectorEntry | null {
    const id = this.inspector?.selection;
    const entries = this.builtVideo?.entries ?? this.built?.entries ?? [];
    return id ? entries.find((e) => e.id === id) ?? null : null;
  }

  private applyHighlight(e: InspectorEntry | null): void {
    if (!this.graph) return;
    if (!e) {
      this.graph.highlight([]);
      this.analysis.setHighlight([]);
      return;
    }
    const ids = e.kind === 'data' ? [] : [e.id];
    this.graph.highlight(ids);
    this.analysis.setHighlight(e.shapeId ? [e.shapeId] : []);
  }

  /** Mass copy: every equation as LaTeX lines (Desmos splits a multi-line paste into expressions). */
  private copyAll(): void {
    const state = this.currentState();
    if (!state) return;
    const text = latexLines(state);
    const n = text ? text.split('\n').length : 0;
    copyText(text).then(
      () =>
        toast(`Copied ${n.toLocaleString('en-US')} equations. Click the first line in Desmos and paste. For black ink and solid fills, use Export > One click.`, {
          tone: 'success',
          timeout: 7000,
        }),
      () => toast('Your browser blocked the clipboard. Use Export instead.', { tone: 'error' }),
    );
  }

  // ------------------------------------------------------------------ video

  private async buildVideo(): Promise<void> {
    if (this.source?.kind !== 'video' || !this.video || this.building) return;
    const src = this.source.video;
    const v = this.video;
    const times = frameTimes(v.start, v.end, v.fps, v.maxFrames);
    const ts = traceSettingsOf(this.settings);
    this.building = true;
    this.cancelBuild = false;
    this.stopPlayback();
    this.panel.setBuilding(true);
    const prog = progress({ label: 'Tracing frames' });
    const cancel = button({ label: 'Cancel', icon: 'x', variant: 'outline', size: 'sm', onClick: () => (this.cancelBuild = true) });
    const overlay = el('div', { class: 'ws-build' }, el('div', { class: 'ws-build-card' }, el('p', { class: 'ws-build-title' }, `Building ${times.length} frames`), prog.el, cancel));
    this.root.querySelector('.ws-graph-wrap')?.appendChild(overlay);
    const pool = getPool();
    const results: TraceResult[] = new Array(times.length);
    const inflight: Promise<void>[] = [];
    let done = 0;
    const t0 = performance.now();
    try {
      for (let i = 0; i < times.length; i++) {
        if (this.cancelBuild || this.destroyed) throw new CancelledError();
        const img = await src.frameAt(times[i], ts.resolution);
        const job = pool.run(img, ts).then((r) => {
          results[i] = r;
          done++;
          const elapsed = (performance.now() - t0) / 1000;
          const eta = done > 3 ? (elapsed / done) * (times.length - done) : 0;
          prog.set(done / times.length, `Frame ${done} of ${times.length}${eta > 1 ? `, about ${Math.ceil(eta)} s left` : ''}`);
        });
        inflight.push(job);
        if (inflight.length >= pool.size * 2) await inflight.shift();
      }
      await Promise.all(inflight);
      if (this.cancelBuild || this.destroyed) throw new CancelledError();
      prog.set(1, 'Writing the Desmos graph');
      await new Promise((r) => setTimeout(r, 20));
      const builtV = buildVideoGraph(results, { fps: v.fps, strokeWidth: this.settings.strokeWidth, name: this.source.name });
      this.videoFrames = results;
      this.builtVideo = builtV;
      this.built = builtV;
      this.inspector.setEntries(builtV.entries);
      this.graph?.load(builtV.state);
      this.ensureTransport(builtV.frames, v.fps);
      this.panel.setVideoStale(false, 'Rebuild video graph');
      this.updateStats();
      toast(`Video graph ready: ${builtV.frames} frames, ${fmtBytes(builtV.bytes)}`, { tone: 'success' });
    } catch (err) {
      if (err instanceof CancelledError) {
        pool.clearQueue();
        toast('Video build cancelled');
      } else toast(`Video build failed: ${err instanceof Error ? err.message : String(err)}`, { tone: 'error', timeout: 8000 });
    } finally {
      overlay.remove();
      this.building = false;
      this.panel.setBuilding(false);
    }
  }

  private ensureTransport(frames: number, fps: number): void {
    if (!this.transport) {
      this.transport = new Transport({
        onFrame: (f) => this.showFrame(f),
        onPlay: (p) => (p ? this.startPlayback() : this.stopPlayback()),
        onMode: (m) => {
          this.playback = m;
          this.previewCanvas.hidden = m !== 'preview';
          if (m === 'preview' && !this.videoFrames) {
            toast('Smooth preview needs the traced frames. Build the video graph first.');
          }
          this.showFrame(this.transport!.current);
        },
      });
      this.root.querySelector('.ws-center-extra')?.appendChild(this.transport.el);
    }
    this.transport.setup(frames, fps);
    this.graph?.setFrame(1);
  }

  private showFrame(f: number): void {
    if (this.playback === 'preview' && this.videoFrames) {
      this.previewCanvas.hidden = false;
      this.drawPreviewFrame(this.videoFrames[f - 1]);
    } else this.graph?.setFrame(f);
  }

  private startPlayback(): void {
    this.stopPlayback(false);
    const fps = this.builtVideo?.fps ?? this.video?.fps ?? 10;
    const frames = this.builtVideo?.frames ?? Number(this.transport ? (this.transport.el.querySelector('input') as HTMLInputElement).max : 1);
    this.playTimer = setInterval(() => {
      if (!this.transport) return;
      let f = this.transport.current + 1;
      if (f > frames) f = 1;
      this.transport.setFrame(f);
      this.showFrame(f);
    }, 1000 / fps);
  }

  private stopPlayback(updateUi = true): void {
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = null;
    if (updateUi) this.transport?.setPlaying(false);
  }

  private drawPreviewFrame(res: TraceResult | undefined): void {
    if (!res) return;
    const c = this.previewCanvas;
    const host = this.graphHost.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(host.width * dpr));
    c.height = Math.max(1, Math.round(host.height * dpr));
    c.hidden = false;
    const g = c.getContext('2d')!;
    const dark = this.settings.dark;
    g.fillStyle = dark ? '#121212' : '#fff';
    g.fillRect(0, 0, c.width, c.height);
    const margin = 0.92;
    const s = Math.min(c.width / res.width, c.height / res.height) * margin;
    g.save();
    g.translate((c.width - res.width * s) / 2, (c.height - res.height * s) / 2);
    g.scale(s, s);
    drawShapes(g, res.shapes, { ink: dark ? '#ededed' : '#000', strokeWidth: (this.settings.strokeWidth * dpr) / s });
    g.restore();
  }

  // ------------------------------------------------------------------ save / share / export

  private currentState(): DesmosState | null {
    return this.builtVideo?.state ?? this.built?.state ?? null;
  }

  private kind(): 'image' | 'video' {
    return this.source?.kind === 'video' || this.builtVideo || (this.source?.kind === 'state' && this.source.state.expressions.ticker) ? 'video' : 'image';
  }

  private exportGraph(): void {
    const state = this.currentState();
    if (!state) {
      toast('Nothing to export yet.');
      return;
    }
    if (this.source?.kind === 'video' && !this.builtVideo) {
      toast('This is a single preview frame. Click "Build video graph" to export the whole clip.', { timeout: 6000 });
    }
    openExportSheet({ name: this.source?.name ?? 'graph', kind: this.kind(), state, bytes: stateWeight(state).bytes });
  }

  private async share(): Promise<void> {
    const state = this.currentState();
    if (!state) return;
    await openShareSheet({ name: this.source?.name ?? 'graph', kind: this.kind(), state, bytes: stateWeight(state).bytes });
  }

  private async save(): Promise<void> {
    const state = this.currentState();
    const src = this.source;
    if (!state || !src) return;
    let thumb = '';
    try {
      if (this.graph) thumb = await this.graph.screenshot(360, 240);
    } catch {
      thumb = '';
    }
    const res = this.videoFrames?.[0] ?? this.result;
    if (!thumb && res) thumb = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(resultToSvgString(res, { ink: '#000', paper: '#fff' }));
    const now = Date.now();
    const w = stateWeight(state);
    const r = this.result;
    const file = src.kind === 'image' ? src.file : src.kind === 'video' ? src.video.file : undefined;
    const existing = this.projectId ? await getProject(this.projectId).catch(() => undefined) : undefined;
    const project: Project = {
      id: this.projectId ?? newProjectId(),
      name: src.name,
      kind: this.kind(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      settings: { ...this.settings },
      video: this.video ? { fps: this.video.fps, start: this.video.start, end: this.video.end } : undefined,
      stats: {
        shapes: this.builtVideo ? this.builtVideo.frames : r?.stats.shapes ?? 0,
        units: this.builtVideo ? this.builtVideo.chunks.reduce((n, c) => n + c.items, 0) : r ? r.stats.segments + r.stats.points + r.stats.terms : 0,
        unitLabel: this.builtVideo ? (this.builtVideo.kind === 'fill' ? 'points' : 'segments') : r ? BUDGET_RANGE[r.mode].units : 'items',
        bytes: w.bytes,
        expressions: w.expressions,
        frames: this.builtVideo?.frames,
        fps: this.builtVideo?.fps,
      },
      thumb,
      state,
      source: file && file.size <= MAX_SOURCE_BYTES ? file : existing?.source,
      sourceName: file?.name ?? existing?.sourceName,
    };
    try {
      await saveProject(project);
      this.projectId = project.id;
      toast('Saved to your projects (stored in this browser)', { tone: 'success' });
    } catch (err) {
      toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`, { tone: 'error' });
    }
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape' && this.inspector?.selection) this.inspector.select(null);
    if (this.transport && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const f = this.transport.current + (e.key === 'ArrowRight' ? 1 : -1);
      this.transport.setFrame(f);
      this.showFrame(this.transport.current);
    }
    if (this.transport && e.key === ' ') {
      e.preventDefault();
      const playing = !!this.playTimer;
      this.transport.setPlaying(!playing);
      if (playing) this.stopPlayback();
      else this.startPlayback();
    }
  }
}

