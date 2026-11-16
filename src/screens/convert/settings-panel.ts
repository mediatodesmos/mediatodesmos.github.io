/** Left column of the workspace: every tracing and output setting. */

import { el, mount } from '../../ui/dom';
import { segmented, select, slider, toggle, button } from '../../ui/components';
import type { LineSource, Mode } from '../../pipeline/types';
import { BUDGET_RANGE, MODE_INFO, type UiSettings, type VideoSettings } from './model';

export interface SettingsPanelOptions {
  onChange: (patch: Partial<UiSettings>) => void;
  onVideoChange: (patch: Partial<VideoSettings>) => void;
  onBuildVideo: () => void;
  onReset: () => void;
}

export class SettingsPanel {
  readonly el: HTMLElement;
  private s: UiSettings;
  private v: VideoSettings | null = null;
  private videoDuration = 0;
  private autoThreshold = 128;
  private videoInfo = el('div', { class: 'field-hint' });
  private buildBtn: HTMLButtonElement | HTMLAnchorElement | null = null;
  private stale = false;
  private thrHandle: { set(v: number): void } | null = null;
  private bytesPerFrame = 0;

  constructor(initial: UiSettings, private opts: SettingsPanelOptions) {
    this.s = { ...initial, budgets: { ...initial.budgets } };
    this.el = el('div', { class: 'settings' });
    this.render();
  }

  get value(): UiSettings {
    return this.s;
  }

  set(s: UiSettings): void {
    this.s = { ...s, budgets: { ...s.budgets } };
    this.render();
  }

  setAutoThreshold(t: number): void {
    if (this.autoThreshold === t) return;
    this.autoThreshold = t;
    const hint = this.el.querySelector<HTMLElement>('[data-auto-thr]');
    if (hint) hint.textContent = `Automatic (Otsu): ${t}`;
    if (this.s.threshold < 0) this.thrHandle?.set(t);
  }

  /** Enable the video section. */
  setVideo(v: VideoSettings | null, duration = 0): void {
    this.v = v ? { ...v } : null;
    this.videoDuration = duration;
    this.render();
  }

  /** Size of one traced frame in the graph (from the probe frame), for the size estimate. */
  setVideoEstimate(bytesPerFrame: number): void {
    this.bytesPerFrame = bytesPerFrame;
    this.updateVideoInfo();
  }

  setVideoStale(stale: boolean, label?: string): void {
    this.stale = stale;
    if (this.buildBtn) {
      this.buildBtn.classList.toggle('is-stale', stale);
      const lbl = this.buildBtn.querySelector('.btn-label') ?? this.buildBtn;
      if (label) lbl.textContent = label;
    }
  }

  setBuilding(building: boolean): void {
    if (this.buildBtn) (this.buildBtn as HTMLButtonElement).disabled = building;
  }

  private patch(p: Partial<UiSettings>, rerender = false): void {
    Object.assign(this.s, p);
    this.opts.onChange(p);
    if (rerender) this.render();
  }

  private section(title: string, ...children: (Node | null | false)[]): HTMLElement {
    return el('section', { class: 'settings-section' }, el('h3', { class: 'overline settings-title' }, title), ...children);
  }

  private render(): void {
    const s = this.s;
    const mode = s.mode;
    const usesThreshold = mode === 'fill' || s.lineSource !== 'edges';
    const usesEdges = mode !== 'fill' && s.lineSource === 'edges';
    const br = BUDGET_RANGE[mode];

    const modeCtl = segmented<Mode>(
      [
        { value: 'outline', label: 'Outline', icon: 'pen' },
        { value: 'fill', label: 'Fill', icon: 'fill' },
        { value: 'fourier', label: 'Fourier', icon: 'wave' },
      ],
      mode,
      (m) => {
        const lineSource: LineSource = m === 'fourier' && s.lineSource === 'edges' ? 'contours' : s.lineSource;
        this.patch({ mode: m, lineSource, budget: s.budgets[m] }, true);
      },
      { full: true },
    );

    const sourceCtl =
      mode !== 'fill'
        ? select<LineSource>({
            label: 'Lines come from',
            options: [
              { value: 'edges', label: 'Edges (best for photos)' },
              { value: 'centerline', label: 'Centre lines (best for line art)' },
              { value: 'contours', label: 'Shape outlines (best for logos)' },
            ],
            value: s.lineSource,
            onChange: (v) => this.patch({ lineSource: v }, true),
          }).el
        : null;

    const thrAuto = toggle({
      label: 'Automatic threshold',
      value: s.threshold < 0,
      onChange: (v) => this.patch({ threshold: v ? -1 : this.autoThreshold }, true),
    });
    const thrSlider = slider({
      label: 'Threshold',
      min: 0,
      max: 255,
      step: 1,
      value: s.threshold < 0 ? this.autoThreshold : s.threshold,
      hint: 'Pixels darker than this count as ink.',
      onInput: (v) => this.patch({ threshold: v }),
    });
    this.thrHandle = thrSlider;
    if (s.threshold < 0) thrSlider.setDisabled(true);

    const res = slider({
      label: 'Working resolution',
      min: this.v ? 96 : 120,
      max: this.v ? 640 : 1200,
      step: 8,
      value: s.resolution,
      format: (v) => `${v} px`,
      hint: 'Long side of the traced image. Higher means more detail and more equations.',
      onInput: () => undefined,
      onChange: (v) => this.patch({ resolution: v }),
    });

    const edge = usesEdges
      ? slider({
          label: 'Edge sensitivity',
          min: 0,
          max: 100,
          step: 1,
          value: s.edgeDetail,
          format: (v) => `${v}%`,
          hint: 'Higher keeps fainter edges.',
          onInput: (v) => this.patch({ edgeDetail: v }),
        }).el
      : null;

    const invert = usesThreshold
      ? toggle({
          label: 'Light shapes on dark',
          value: s.invert,
          hint: 'Trace the bright parts instead of the dark parts.',
          onChange: (v) => this.patch({ invert: v }),
        }).el
      : null;

    const blur = slider({
      label: 'Blur before tracing',
      min: 0,
      max: 4,
      step: 0.1,
      value: s.blur,
      format: (v) => (v === 0 ? 'off' : `${v.toFixed(1)} px`),
      hint: 'Smooths noise and grain away.',
      onInput: (v) => this.patch({ blur: v }),
    });

    const tol = slider({
      label: 'Curve tolerance',
      min: 0.3,
      max: 4,
      step: 0.1,
      value: s.smoothing,
      format: (v) => `${v.toFixed(1)} px`,
      hint: 'How far a curve may stray from the pixels. Higher means fewer, smoother pieces.',
      onInput: (v) => this.patch({ smoothing: v }),
    });

    const speck = slider({
      label: 'Ignore specks under',
      min: 0,
      max: 60,
      step: 1,
      value: s.minSize,
      format: (v) => `${v} px`,
      hint: 'Drops tiny bits of noise.',
      onInput: (v) => this.patch({ minSize: v }),
    });

    const budget = slider({
      label: this.v ? `Max ${br.units} per frame` : `Max ${br.units}`,
      min: br.min,
      max: this.v ? Math.min(br.max, 4000) : br.max,
      step: br.step,
      value: s.budgets[mode],
      format: (v) => v.toLocaleString('en-US'),
      hint: 'A hard cap. The smallest shapes are dropped first.',
      onInput: (v) => {
        const budgets = { ...this.s.budgets, [mode]: v };
        this.patch({ budgets, budget: v });
      },
    });

    const terms =
      mode === 'fourier'
        ? slider({
            label: 'Circles per shape (max)',
            min: 3,
            max: 150,
            step: 1,
            value: s.fourierTerms,
            hint: 'More circles follow the outline more closely.',
            onInput: (v) => this.patch({ fourierTerms: v }),
          }).el
        : null;

    const stroke =
      mode !== 'fill'
        ? slider({
            label: 'Line width in Desmos',
            min: 0.5,
            max: 6,
            step: 0.5,
            value: s.strokeWidth,
            format: (v) => `${v}`,
            onInput: (v) => this.patch({ strokeWidth: v }),
          }).el
        : null;

    const notes = this.v
      ? null
      : toggle({
          label: 'Label shapes in Desmos',
          value: s.notes,
          hint: 'Adds a text note above every equation in the exported graph.',
          onChange: (v) => this.patch({ notes: v }),
        }).el;

    const epi =
      mode === 'fourier' && !this.v
        ? toggle({
            label: 'Animate rotating circles',
            value: s.epicycles,
            hint: 'Adds spinning circles that redraw the largest shape. Press play on the ticker in Desmos.',
            onChange: (v) => this.patch({ epicycles: v }),
          }).el
        : null;

    const dark = toggle({
      label: 'Dark preview',
      value: s.dark,
      hint: 'Only changes this preview. Exports are always black on white.',
      onChange: (v) => this.patch({ dark: v }),
    }).el;

    const videoSection = this.v ? this.renderVideo() : null;

    mount(
      this.el,
      videoSection,
      this.section('Drawing style', modeCtl.el, el('p', { class: 'field-hint mode-blurb' }, MODE_INFO[mode].blurb), sourceCtl),
      this.section(
        'Detail',
        res.el,
        edge,
        usesThreshold ? thrAuto.el : null,
        usesThreshold ? el('p', { class: 'field-hint', dataset: { autoThr: '' } }, `Automatic (Otsu): ${this.autoThreshold}`) : null,
        usesThreshold ? thrSlider.el : null,
        invert,
      ),
      this.section('Smoothing', blur.el, tol.el, speck.el),
      this.section('Equation budget', budget.el, terms),
      this.section('Desmos output', stroke, notes, epi, dark),
      el(
        'div',
        { class: 'settings-foot' },
        button({ label: 'Reset settings', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: () => this.opts.onReset() }),
      ),
    );
  }

  private renderVideo(): HTMLElement {
    const v = this.v!;
    const d = this.videoDuration;
    this.updateVideoInfo();
    const start = slider({
      label: 'Start',
      min: 0,
      max: Math.max(0.1, d),
      step: 0.1,
      value: v.start,
      format: (x) => `${x.toFixed(1)} s`,
      onInput: (x) => {
        v.start = Math.min(x, v.end - 0.1);
        this.updateVideoInfo();
      },
      onChange: () => this.opts.onVideoChange({ start: v.start }),
    });
    const end = slider({
      label: 'End',
      min: 0,
      max: Math.max(0.1, d),
      step: 0.1,
      value: v.end,
      format: (x) => `${x.toFixed(1)} s`,
      onInput: (x) => {
        v.end = Math.max(x, v.start + 0.1);
        this.updateVideoInfo();
      },
      onChange: () => this.opts.onVideoChange({ end: v.end }),
    });
    const fps = slider({
      label: 'Frames per second',
      min: 1,
      max: 30,
      step: 1,
      value: v.fps,
      format: (x) => `${x} fps`,
      hint: 'Lower fps gives a lighter graph that plays more smoothly in Desmos.',
      onInput: (x) => {
        v.fps = x;
        this.updateVideoInfo();
      },
      onChange: () => this.opts.onVideoChange({ fps: v.fps }),
    });
    const max = slider({
      label: 'Frame limit',
      min: 10,
      max: 600,
      step: 10,
      value: v.maxFrames,
      onInput: (x) => {
        v.maxFrames = x;
        this.updateVideoInfo();
      },
      onChange: () => this.opts.onVideoChange({ maxFrames: v.maxFrames }),
    });
    const buildBtn = button({
      label: 'Build video graph',
      icon: 'film',
      variant: 'primary',
      class: 'btn-block',
      onClick: () => this.opts.onBuildVideo(),
    });
    this.buildBtn = buildBtn;
    if (this.stale) buildBtn.classList.add('is-stale');
    return this.section(
      'Video',
      el('p', { class: 'field-hint' }, 'Tune the settings on one frame, then build the whole clip as a single Desmos graph with a frame slider.'),
      start.el,
      end.el,
      fps.el,
      max.el,
      this.videoInfo,
      buildBtn,
    );
  }

  private updateVideoInfo(): void {
    const v = this.v;
    if (!v) return;
    const frames = Math.min(v.maxFrames, Math.max(1, Math.floor((v.end - v.start) * v.fps)));
    let text = `${frames} frames, ${(v.end - v.start).toFixed(1)} s of video`;
    if (this.bytesPerFrame > 0) {
      const est = this.bytesPerFrame * frames;
      text += `, about ${est < 1e6 ? Math.round(est / 1024) + ' KB' : (est / 1048576).toFixed(1) + ' MB'} of equations`;
      if (est > 2_500_000) text += '. That is heavy for Desmos: lower the fps, frame limit or budget.';
    }
    this.videoInfo.textContent = text;
    this.videoInfo.classList.toggle('is-warning', this.bytesPerFrame * frames > 2_500_000);
  }
}
