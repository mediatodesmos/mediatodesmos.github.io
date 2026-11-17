/**
 * The convert workspace: open an image, video or saved graph, tune the
 * tracer live, inspect every equation, and export to Desmos.
 */

import { el, mount, clear, debounce, fmtBytes, fmtInt } from '../../ui/dom';
import { button, chipTray, dropZone, emptyState, iconButton, progress, spinner, stat, toast } from '../../ui/components';
import { icon } from '../../ui/icons';
import { go, takePending, type PendingOpen } from '../../app';
import { getPool, CancelledError } from '../../pipeline/pool';
import { frameSignature, imageOtsu, looksLikeDrawing, signatureDiff } from '../../pipeline/image';
import type { RgbaImage, TraceResult } from '../../pipeline/types';
import { adjustPalette } from '../../pipeline/color';
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
import { PreviewView } from '../../render/preview-view';
import { startTour } from '../../ui/tour';
import { getTheme, onThemeChange } from '../../ui/theme';
import { CONVERT_TOUR, CONVERT_TOUR_ID } from '../tour-steps';
import { isBetaEnabled, onBetaChange, requireBeta } from '../../account/beta';
import { getProject, listProjects, MAX_SOURCE_BYTES, newProjectId, saveProject, type Project } from '../../store/projects';
import { SettingsPanel } from './settings-panel';
import type { SourceLayers, BgOptions } from './layers';
import type { EditorMode } from './draw/editor';
import type { EnhanceMode } from '../../pipeline/autoenhance';
import { BG_MODEL } from '../../pipeline/bgremove';
import { Inspector } from './inspector';
import { Analysis } from './analysis';
import { Transport, type PlaybackMode } from './transport';
import { openExportSheet, openShareSheet } from './export-sheet';
import { BUDGET_RANGE, ENHANCED_MAX_RES, HIGH_BUDGET_MAX, VIDEO_MAX_RES, cropOf, defaultImageSettings, defaultVideoSettings, traceSettingsOf, type UiSettings, type VideoSettings } from './model';

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
  private preview: PreviewView | null = null;
  private compare: { root: HTMLElement; layer: HTMLElement; pos: number; stopObserve: (() => void) | null } | null = null;
  /** Desmos is unavailable: the built-in preview stands in for the graph. */
  private fallback = false;
  private panel!: SettingsPanel;
  private inspector!: Inspector;
  private analysis!: Analysis;
  private transport: Transport | null = null;
  private statsEls: Record<string, { el: HTMLElement; set(v: string): void }> = {};
  private result: TraceResult | null = null;
  private built: BuiltGraph | null = null;
  private builtVideo: BuiltVideo | null = null;
  private videoFrames: TraceResult[] | null = null;
  private raster: { key: string; img: RgbaImage } | null = null;
  private betaUnsub: (() => void) | null = null;
  private themeUnsub: (() => void) | null = null;
  private token = 0;
  private lastRes = 0;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private playback: PlaybackMode = 'desmos';
  private building = false;
  private cancelBuild = false;
  private projectId: string | null = null;
  /** The user picked a line source by hand; keep it for the next image. */
  private lineSourceChosen = false;
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
    // Signing in or out switches BETA features on or off: re-apply them.
    this.betaUnsub = onBetaChange(() => this.onBetaChanged());
    this.themeUnsub = onThemeChange(() => this.applyDark());
    if (!this.consumePending()) this.renderEmpty();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPlayback();
    this.cancelBuild = true;
    window.removeEventListener('m2d:open', this.openListener);
    window.removeEventListener('keydown', this.keyListener);
    this.betaUnsub?.();
    this.themeUnsub?.();
    this.graph?.destroy();
    this.graph = null;
    this.preview?.destroy();
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
      if (!this.settings || this.video || !this.lineSourceChosen) {
        if (!this.settings || this.video) this.settings = defaultImageSettings();
        // Drawings and anime trace best as ink lines, photos as edges.
        this.settings.lineSource = looksLikeDrawing(rasterize(drawable, 240)) ? 'ink' : 'edges';
      }
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
    // Video frames (anime scenes, live action) trace best as edges.
    this.settings = defaultVideoSettings();
    this.settings.lineSource = 'edges';
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
    this.layers = null;
    this.bgToken++;
    // A new source always starts fitted, even if its working width matches the last one.
    this.lastRes = 0;
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
        button({ label: 'Start a blank drawing', icon: 'pen', variant: 'outline', onClick: () => void this.openBlankDrawing() }),
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
    this.compare?.stopObserve?.();
    this.compare = null;
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
      onEdit: (mode) => void this.openPictureEditor(mode),
      onAutoEnhance: (mode) => {
        if (mode === 'cancel') this.enhanceCancelled = true;
        else void this.runAutoEnhance(mode);
      },
      onReset: () => {
        this.settings = src.kind === 'video' ? defaultVideoSettings() : defaultImageSettings();
        this.panel.set(this.settings);
        this.applyDark();
        this.updateCropUi();
        this.raster = null;
        this.retraceNow();
      },
    });
    if (src.kind === 'video' && this.video) this.panel.setVideo(this.video, src.video.duration);
    this.inspector = new Inspector({
      onHover: (e) => this.hoverHL(e ?? this.selectedEntry()),
      onSelect: (e) => this.applyHighlight(e),
      onSolo: (e) => this.graph?.solo(e ? [e.id] : null),
      onZoom: (e) => {
        if (!e.bbox || !this.result) return;
        if (this.previewShown()) this.preview?.zoomTo(e.bbox);
        else this.graph?.zoomTo(e.bbox, this.result.height);
      },
      onCopyAll: () => this.copyAll(),
    });
    this.analysis = new Analysis({
      onThreshold: (t) => {
        this.settings.threshold = t;
        this.panel.set(this.settings);
        this.retrace();
      },
      onCrop: (c) => {
        this.settings.crop = c;
        this.raster = null;
        if (this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
        this.retrace();
      },
    });

    // Graph area
    this.graphHost = el('div', { class: 'ws-graph', attrs: { 'aria-label': 'Desmos graph preview' } });
    this.previewCanvas = el('canvas', { class: 'ws-preview', hidden: true, attrs: { 'aria-label': 'Preview drawn by Media to Desmos' } });
    this.preview?.destroy();
    this.preview = new PreviewView(this.previewCanvas);
    this.preview.setDark(this.effectiveDark());
    this.preview.setAxes(this.settings.axes);
    this.preview.setStroke(this.settings.strokeWidth);
    this.fallback = false;
    this.graphStatus = el('div', { class: 'ws-graph-status' }, spinner(20), el('span', null, 'Loading Desmos...'));
    const graphTools = el(
      'div',
      { class: 'ws-graph-tools' },
      iconButton({
        icon: 'zoom-fit',
        title: 'Fit to view',
        variant: 'card',
        size: 'sm',
        onClick: () => (this.previewShown() ? this.preview?.fit() : this.graph?.fit()),
      }),
      iconButton({
        icon: 'compare',
        title: 'Compare with the original',
        variant: 'card',
        size: 'sm',
        onClick: (e) => {
          const on = this.toggleCompare();
          (e.currentTarget as HTMLElement).classList.toggle('is-active', on);
          (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on));
        },
      }),
      iconButton({
        icon: 'axes',
        title: 'Show axes and numbers',
        variant: 'card',
        size: 'sm',
        active: this.settings.axes,
        onClick: (e) => {
          this.settings.axes = !this.settings.axes;
          this.graph?.setAxes(this.settings.axes);
          this.preview?.setAxes(this.settings.axes);
          (e.currentTarget as HTMLElement).classList.toggle('is-active', this.settings.axes);
          (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(this.settings.axes));
        },
      }),
      iconButton({
        icon: 'contrast',
        title: 'Toggle dark preview',
        variant: 'card',
        size: 'sm',
        onClick: () => {
          this.settings.dark = !this.settings.dark;
          this.applyDark();
          this.panel.set(this.settings);
        },
      }),
    );
    const graphWrap = el('div', { class: 'ws-graph-wrap' + (this.effectiveDark() ? '' : ' is-paper') }, this.graphHost, this.previewCanvas, graphTools, this.graphStatus);

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
    const ws0 = this.ws;
    if (USING_DEMO_KEY && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      // Visible reminder for the site owner until a production key is configured.
      console.info('Media to Desmos: using the Desmos demo API key. Set VITE_DESMOS_API_KEY for production.');
    }

    // First visit: a short guided tour of the workspace (remembered once finished or skipped).
    setTimeout(() => {
      if (!this.destroyed && this.ws === ws0) startTour(CONVERT_TOUR, { id: CONVERT_TOUR_ID });
    }, 900);
    // Start Desmos in the background so tracing does not wait for it.
    const ws = this.ws;
    void GraphView.create(this.graphHost, { dark: this.effectiveDark() }).then(
      (g) => {
        if (this.destroyed || this.ws !== ws) {
          g.destroy();
          return;
        }
        this.graph = g;
        this.graphStatus.hidden = true;
        if (this.settings.axes) g.setAxes(true);
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
          iconButton({ icon: 'x', title: 'Hide this message', variant: 'ghost', size: 'sm', class: 'ws-graph-status-close', onClick: () => (this.graphStatus.hidden = true) }),
        );
        this.graphStatus.classList.add('is-error');
        this.fallback = true;
        this.drawFallback();
      },
    );
  }

  /**
   * Before/after overlay: the traced input drawn exactly under the graph on the
   * left of a draggable divider, kept aligned through pans and zooms.
   */
  private toggleCompare(): boolean {
    if (this.compare) {
      this.compare.stopObserve?.();
      this.compare.root.remove();
      this.compare = null;
      if (this.preview) this.preview.onDraw = null;
      return false;
    }
    const src = this.analysis.sourceCanvas();
    if (!src) return false;
    const img = el('canvas', { class: 'ws-cmp-img', width: src.width, height: src.height });
    img.getContext('2d')!.drawImage(src, 0, 0);
    const layer = el('div', { class: 'ws-cmp-layer' }, img);
    const knob = el('span', { class: 'cmp-knob' }, icon('compare', { size: 16 }));
    const handle = el('div', {
      class: 'ws-cmp-handle',
      tabIndex: 0,
      attrs: { role: 'slider', 'aria-label': 'Before and after divider', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 50 },
    }, knob);
    const root = el('div', { class: 'ws-cmp' }, layer, handle);
    const state = { root, layer, pos: 50, stopObserve: null as (() => void) | null };
    const setPos = (p: number) => {
      state.pos = Math.max(0, Math.min(100, p));
      root.style.setProperty('--pos', `${state.pos}%`);
      handle.setAttribute('aria-valuenow', String(Math.round(state.pos)));
    };
    setPos(50);
    let drag = false;
    handle.addEventListener('pointerdown', (e) => {
      drag = true;
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = root.getBoundingClientRect();
      setPos(((e.clientX - r.left) / r.width) * 100);
    });
    handle.addEventListener('pointerup', () => (drag = false));
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') setPos(state.pos - 2);
      else if (e.key === 'ArrowRight') setPos(state.pos + 2);
      else return;
      e.preventDefault();
    });
    this.root.querySelector('.ws-graph-wrap')?.appendChild(root);
    this.compare = state;
    const align = () => {
      const res = this.result;
      if (!res) return;
      const rect = this.previewShown() ? this.preview?.imageRect() : this.graph?.imageRect(res.width, res.height);
      if (!rect) return;
      Object.assign(img.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    };
    if (this.preview) this.preview.onDraw = align;
    if (this.graph) state.stopObserve = this.graph.onViewChange(align);
    align();
    return true;
  }

  /** The built-in preview is on screen (Desmos unavailable, or smooth video preview). */
  private previewShown(): boolean {
    return !this.previewCanvas.hidden;
  }

  private async retryGraph(): Promise<void> {
    clear(this.graphStatus);
    this.graphStatus.classList.remove('is-error');
    this.graphStatus.append(spinner(20), el('span', null, 'Loading Desmos...'));
    try {
      this.graph = await GraphView.create(this.graphHost, { dark: this.effectiveDark() });
      this.graphStatus.hidden = true;
      this.fallback = false;
      if (this.playback !== 'preview') this.previewCanvas.hidden = true;
      if (this.settings.axes) this.graph.setAxes(true);
      if (this.built) this.graph.load(this.built.state);
    } catch (err) {
      clear(this.graphStatus);
      this.graphStatus.classList.add('is-error');
      this.graphStatus.append(icon('alert', { size: 18 }), el('span', null, err instanceof Error ? err.message : 'Desmos failed to load.'));
    }
  }

  /** Without Desmos (offline / blocked) show our own drawing of the shapes. */
  private drawFallback(): void {
    const frame = this.videoFrames && this.transport ? this.videoFrames[this.transport.current - 1] : this.result;
    if (!frame) return;
    this.drawPreviewFrame(frame);
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
      this.applyDark();
      return;
    }
    if ('color' in p) this.applyDark();
    if ('bgRemove' in p || 'bgMethod' in p || 'bgTolerance' in p || 'bgFeather' in p) {
      void this.applyBackground();
      return;
    }
    if ('cropOn' in p || 'cropAspect' in p || 'crop' in p) {
      this.updateCropUi();
      if ('cropOn' in p || 'crop' in p) {
        this.raster = null;
        if (this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
        this.retrace();
      }
      return;
    }
    const outputOnly = ['strokeWidth', 'notes', 'epicycles', 'mergeSmall', 'saturation', 'brightness', 'colorOverrides'];
    if (Object.keys(p).every((k) => outputOnly.includes(k))) {
      // Output-only changes: rebuild the graph without re-tracing.
      if (this.source?.kind === 'video' && this.videoFrames) {
        this.panel.setVideoStale(true, 'Rebuild video graph');
      } else if (this.result) this.applyResult(this.result, true);
      return;
    }
    if (this.source?.kind === 'video' && this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
    // Shape ids are renumbered on every trace; a new style makes an old selection meaningless.
    if ('lineSource' in p) this.lineSourceChosen = true;
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
    const crop = cropOf(this.settings);
    if (!src) return null;
    if (src.kind === 'image') {
      const layers = this.layers;
      const bg = this.bgOptions();
      const layered = !!layers && layers.active(bg);
      const key = `${res}|${crop ? [crop.x, crop.y, crop.w, crop.h].join(',') : ''}|${layered ? `${layers!.version}|${bg.on}|${bg.feather}` : ''}`;
      if (!this.raster || this.raster.key !== key) this.raster = { key, img: rasterize(layered ? layers!.compose(bg) : src.drawable, res, crop) };
      return this.raster.img;
    }
    if (src.kind === 'video') {
      const frame = await src.video.frameAt(this.probeTime(), res, crop);
      return this.layers ? this.layers.processFrame(frame, this.bgOptions()) : frame;
    }
    return null;
  }

  /** Layers over the source: background removal, touch-ups and the user's drawing. */
  private layers: SourceLayers | null = null;

  private bgOptions(): BgOptions {
    const s = this.settings;
    return { on: s.bgRemove, method: s.bgMethod, tolerance: s.bgTolerance, feather: s.bgFeather };
  }

  /** Make the layers for the current source (pictures: the decoded image; videos: the probe frame, as a backdrop). */
  private async ensureLayers(): Promise<SourceLayers | null> {
    if (this.layers) return this.layers;
    const src = this.source;
    if (!src || src.kind === 'state') return null;
    const { SourceLayers } = await import('./layers');
    if (this.source !== src || this.layers) return this.layers;
    if (src.kind === 'image') this.layers = new SourceLayers(src.drawable);
    else {
      const f = await src.video.frameAt(this.probeTime(), 960);
      const c = document.createElement('canvas');
      c.width = f.width;
      c.height = f.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0);
      this.layers = new SourceLayers(c);
    }
    return this.layers;
  }

  private enhanceCancelled = false;
  private enhancing = false;

  /** BETA Auto Enhance: search the settings for the closest match to the picture, then apply them. */
  private async runAutoEnhance(mode: EnhanceMode): Promise<void> {
    const src = this.source;
    if (!src || src.kind === 'state' || this.enhancing) return;
    if (!(await requireBeta('Auto Enhance'))) return;
    this.enhancing = true;
    this.enhanceCancelled = false;
    const video = src.kind === 'video';
    const s = this.settings;
    const crop = cropOf(s);
    const bg = this.bgOptions();
    const layers = this.layers;
    const imageAt = async (r: number): Promise<RgbaImage> => {
      if (src.kind === 'image') return rasterize(layers && layers.active(bg) ? layers.compose(bg) : src.drawable, r, crop);
      const f = await src.video.frameAt(this.probeTime(), r, crop);
      return layers ? layers.processFrame(f, bg) : f;
    };
    this.panel.setEnhanceStatus(true, 'Measuring your picture...');
    try {
      const base = traceSettingsOf(s);
      const { autoEnhance } = await import('../../pipeline/autoenhance');
      const out = await autoEnhance(base, {
        mode,
        run: (img, ts) => getPool().run(img, ts, {}),
        imageAt,
        maxResolution: video ? VIDEO_MAX_RES : ENHANCED_MAX_RES,
        maxBudget: video ? Math.min(4000, BUDGET_RANGE[s.mode].max) : Math.min(HIGH_BUDGET_MAX, s.mode === 'fill' ? HIGH_BUDGET_MAX : 20000),
        targetMs: video ? 135 : 450,
        targetBytes: video ? 6000 : 160_000,
        onProgress: (done, total) => this.panel.setEnhanceStatus(true, `Trying settings: ${done} of about ${total}...`),
        cancelled: () => this.enhanceCancelled || this.destroyed || this.source !== src,
      });
      if (this.destroyed || this.source !== src) return;
      const b = out.settings;
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      const patch: Partial<UiSettings> = {
        resolution: b.resolution,
        smoothing: b.smoothing,
        edgeDetail: b.edgeDetail,
        minSize: b.minSize,
        blur: b.blur,
        fourierTerms: b.fourierTerms,
        budget: b.budget,
        budgets: { ...s.budgets, [s.mode]: b.budget },
        ...(s.mode !== 'fill' ? { lineSource: b.lineSource } : {}),
      };
      Object.assign(this.settings, patch);
      if ('lineSource' in patch) this.lineSourceChosen = true;
      this.panel.set(this.settings);
      const better = out.after > out.before + 0.002;
      this.panel.setEnhanceStatus(
        false,
        better
          ? `Done: match ${pct(out.before)} to ${pct(out.after)} after ${out.tried} tries${this.enhanceCancelled ? ' (stopped early)' : ''}.`
          : `Your settings were already the best match found (${pct(out.after)}, ${out.tried} tries).`,
      );
      this.raster = null;
      if (this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
      this.retrace();
    } catch (err) {
      this.panel.setEnhanceStatus(false, `Auto Enhance stopped: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.enhancing = false;
    }
  }

  /** A white page to draw on from scratch; opens straight into the editor. */
  private async openBlankDrawing(): Promise<void> {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 960;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    this.resetSourceState();
    this.source = { kind: 'image', name: 'Drawing', drawable: c, width: c.width, height: c.height };
    if (!this.settings || this.video) this.settings = defaultImageSettings();
    // Drawn lines trace best as ink.
    this.settings.lineSource = 'ink';
    this.video = null;
    this.projectId = null;
    await this.renderWorkspace();
    this.retraceNow();
    void this.openPictureEditor('draw');
  }

  /** Draw on the picture, touch up the background cut-out, or paint extra detail. */
  private async openPictureEditor(mode: EditorMode): Promise<void> {
    const layers = await this.ensureLayers();
    if (!layers) return;
    if (mode === 'mask') {
      const s = this.settings;
      if (!s.bgRemove) return;
      if (!layers.hasMask(s.bgMethod, s.bgTolerance)) await this.applyBackground();
      if (!layers.hasMask(s.bgMethod, s.bgTolerance)) return;
    }
    // The editor loads on first use, so the converter itself stays light.
    const { openEditor } = await import('./draw/editor');
    openEditor({
      mode,
      layers,
      bg: this.bgOptions(),
      onDone: () => {
        this.raster = null;
        if (this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
        this.retrace();
      },
    });
  }

  /** Turn background removal on (computing the mask, downloading the model the first time) or update it. */
  private async applyBackground(): Promise<void> {
    const s = this.settings;
    if (!s.bgRemove) {
      this.panel.setBgStatus('');
      this.raster = null;
      this.retrace();
      return;
    }
    const layers = await this.ensureLayers();
    if (!layers) return;
    const tok = ++this.bgToken;
    try {
      if (this.source?.kind === 'image') {
        if (!layers.hasMask(s.bgMethod, s.bgTolerance)) {
          this.panel.setBgStatus(s.bgMethod === 'auto' ? 'Preparing the background model...' : 'Finding the background...');
          await layers.computeMask(s.bgMethod, s.bgTolerance, (p) => {
            if (tok !== this.bgToken) return;
            this.panel.setBgStatus(p.stage === 'download' ? `Downloading the background model (${BG_MODEL.size}): ${Math.round(p.loaded * 100)}%` : 'Removing the background...');
          });
        }
      } else if (s.bgMethod === 'auto') {
        this.panel.setBgStatus('Every frame gets its own cut-out when the video graph is built.');
      }
      if (tok !== this.bgToken) return;
      if (this.source?.kind === 'image') this.panel.setBgStatus('');
      this.raster = null;
      if (this.builtVideo) this.panel.setVideoStale(true, 'Rebuild video graph');
      this.retrace();
    } catch (err) {
      if (tok !== this.bgToken) return;
      this.panel.setBgStatus(`Could not remove the background: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private bgToken = 0;

  private probeTime(): number {
    const v = this.video!;
    return v.start + Math.min(v.end - v.start, 1) * 0.5;
  }

  /** The preview is dark unless the user chose paper, or In Color is on (colours need paper). */
  private effectiveDark(): boolean {
    return this.settings.dark && getTheme() === 'dark' && !(isBetaEnabled() && this.settings.color);
  }

  private applyDark(): void {
    const dark = this.effectiveDark();
    this.graph?.setDark(dark);
    this.preview?.setDark(dark);
    this.root.querySelector('.ws-graph-wrap')?.classList.toggle('is-paper', !dark);
  }

  /** BETA crop: show the whole source with the crop rectangle while cropping is on. */
  private updateCropUi(): void {
    const src = this.source;
    if (!src || src.kind === 'state' || !this.settings.cropOn || !isBetaEnabled()) {
      this.analysis?.setCropMode(false, null, null, 'free');
      return;
    }
    const show = (img: RgbaImage) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      this.analysis.setCropMode(this.settings.cropOn && isBetaEnabled(), c, this.settings.crop, this.settings.cropAspect);
    };
    if (src.kind === 'image') show(rasterize(src.drawable, 640));
    else void src.video.frameAt(this.probeTime(), 480).then(show);
  }

  private onBetaChanged(): void {
    if (!this.source || this.source.kind === 'state') return;
    this.panel.set(this.settings);
    this.applyDark();
    this.updateCropUi();
    this.raster = null;
    this.retrace();
  }

  private async retraceNow(): Promise<void> {
    if (!this.source || this.source.kind === 'state') return;
    const tok = ++this.token;
    const img = await this.currentImage();
    if (!img || tok !== this.token || this.destroyed) return;
    this.analysis.setSource(img);
    this.ws?.classList.add('is-tracing');
    try {
      const ts = traceSettingsOf(this.settings);
      const detail = this.layers?.detailMask(img.width, img.height, cropOf(this.settings));
      if (detail) ts.detail = detail;
      const res = await getPool().run(img, ts, { preview: true, histogram: true });
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

  /**
   * The trace with the colour edits applied: saturation, brightness and
   * per-colour replacements are recomputed from the palette each time, so
   * changing them never needs a retrace.
   */
  private withColorEdits(res: TraceResult): TraceResult {
    const pal = res.palette;
    if (!pal) return res;
    const s = this.settings;
    const colors = adjustPalette(pal, { saturation: s.saturation, brightness: s.brightness }, s.colorOverrides);
    return { ...res, shapes: res.shapes.map((sh) => (sh.paletteIndex === undefined ? sh : { ...sh, color: colors[sh.paletteIndex] })) };
  }

  private lastPalette = '';
  private lastAuto = '';

  private applyResult(raw: TraceResult, keepView: boolean): void {
    const s = this.settings;
    // A new palette makes old per-colour replacements meaningless.
    const palKey = raw.palette?.join(',') ?? '';
    if (palKey !== this.lastPalette) {
      if (this.lastPalette && Object.keys(s.colorOverrides).length) s.colorOverrides = {};
      this.lastPalette = palKey;
    }
    // Auto Color suggests a saturation boost for each new automatic palette.
    const autoKey = raw.autoColor ? `${raw.autoColor.k}|${raw.autoColor.saturation}|${palKey}` : '';
    if (raw.autoColor && s.autoColor && autoKey !== this.lastAuto) {
      s.saturation = raw.autoColor.saturation;
      s.brightness = 0;
      this.panel.set(s);
    }
    this.lastAuto = autoKey;
    this.panel.setPalette(raw.palette ?? null, raw.autoColor?.k ?? null);
    const res = this.withColorEdits(raw);
    this.result = res;
    const usesThr = s.mode === 'fill' || s.lineSource === 'centerline' || s.lineSource === 'contours';
    this.panel.setAutoThreshold(res.stats.threshold);
    this.analysis.setResult(res, {
      threshold: usesThr ? (s.threshold >= 0 ? s.threshold : res.stats.threshold) : -1,
      showHistogram: usesThr,
      bitmapLabel: s.mode !== 'fill' && s.lineSource === 'edges' ? 'Edges' : s.mode !== 'fill' && s.lineSource === 'ink' ? 'Ink' : 'Bitmap',
    });
    // A built video graph stays on screen; the probe only updates the analysis card.
    if (this.source?.kind === 'video' && this.builtVideo) return;
    const name = this.source?.name ?? 'Untitled';
    this.built = buildImageGraph(res, {
      strokeWidth: s.strokeWidth,
      notes: s.notes,
      name,
      epicycles: s.epicycles,
      mergeAll: s.mergeSmall,
    });
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
    const shapeIds = e?.shapeId ? [e.shapeId] : [];
    this.analysis.setHighlight(shapeIds);
    this.preview?.setHighlight(shapeIds);
    if (!this.graph) return;
    this.graph.highlight(e && e.kind !== 'data' ? [e.id] : []);
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
      // Held frames (anime often repeats a drawing for 2-3 frames) reuse the previous trace,
      // and the automatic threshold is smoothed over time so the drawing does not flicker.
      const dupOf = new Map<number, number>();
      let lastSig: Float32Array | null = null;
      let lastKept = -1;
      let ema = -1;
      const autoThr = ts.threshold < 0;
      for (let i = 0; i < times.length; i++) {
        if (this.cancelBuild || this.destroyed) throw new CancelledError();
        const raw = await src.frameAt(times[i], ts.resolution, cropOf(this.settings));
        const img = this.layers ? await this.layers.processFrame(raw, this.bgOptions()) : raw;
        const sig = frameSignature(img);
        if (lastSig && lastKept >= 0 && signatureDiff(sig, lastSig) < 1.2) {
          dupOf.set(i, lastKept);
          done++;
          continue;
        }
        lastSig = sig;
        lastKept = i;
        let frameSettings = ts;
        if (autoThr) {
          const o = imageOtsu(img);
          ema = ema < 0 ? o : ema * 0.7 + o * 0.3;
          frameSettings = { ...ts, threshold: Math.round(ema) };
        }
        const job = pool.run(img, frameSettings).then((r) => {
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
      for (const [i, j] of dupOf) results[i] = results[j];
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
    if ((this.playback === 'preview' || this.fallback) && this.videoFrames) {
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
    if (!res || !this.preview) return;
    this.previewCanvas.hidden = false;
    this.preview.setStroke(this.settings.strokeWidth);
    this.preview.setResult(res);
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
    const res = this.videoFrames && this.transport ? this.videoFrames[this.transport.current - 1] : this.result;
    openExportSheet({
      name: this.source?.name ?? 'graph',
      kind: this.kind(),
      state,
      bytes: stateWeight(state).bytes,
      png: res ? () => this.renderPng(res) : undefined,
    });
  }

  /** The traced drawing as a PNG (long side 1600 px, on white), for Desmos' image upload. */
  private renderPng(res: TraceResult): Promise<Blob | null> {
    const shown = this.withColorEdits(res);
    const s = 1600 / Math.max(shown.width, shown.height);
    const c = document.createElement('canvas');
    c.width = Math.round(shown.width * s);
    c.height = Math.round(shown.height * s);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.scale(s, s);
    drawShapes(g, shown.shapes, { ink: '#000000', strokeWidth: Math.max(0.8, (this.settings.strokeWidth * 0.6) / s) });
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
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
        ...(this.builtVideo ? { frames: this.builtVideo.frames, fps: this.builtVideo.fps } : {}),
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

