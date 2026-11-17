/** Left column of the workspace: every tracing and output setting. */

import { el, mount } from '../../ui/dom';
import { segmented, select, slider, toggle, button } from '../../ui/components';
import { betaGate, isBetaEnabled } from '../../account/beta';
import { adjustPalette } from '../../pipeline/color';
import { BG_MODEL } from '../../pipeline/bgremove';
import type { CropAspect } from './model';
import type { LineSource, Mode } from '../../pipeline/types';
import { BUDGET_RANGE, ENHANCED_MAX_RES, HIGH_BUDGET_MAX, MODE_INFO, presetValues, VIDEO_MAX_RES, type Quality, type UiSettings, type VideoSettings } from './model';

export interface SettingsPanelOptions {
  onChange: (patch: Partial<UiSettings>) => void;
  onVideoChange: (patch: Partial<VideoSettings>) => void;
  onBuildVideo: () => void;
  onReset: () => void;
  /** Open the editor: draw on the picture, touch up the background cut-out, or paint extra detail. */
  onEdit: (mode: 'draw' | 'mask' | 'detail') => void;
  /** BETA Auto Enhance: start (with a mode) or cancel a settings search. */
  onAutoEnhance: (mode: 'optimize' | 'max' | 'cancel') => void;
}

export class SettingsPanel {
  readonly el: HTMLElement;
  private s: UiSettings;
  private v: VideoSettings | null = null;
  private videoDuration = 0;
  private autoThreshold = 128;
  private bgStatus = '';
  private enhanceMode: 'optimize' | 'max' = 'optimize';
  private enhanceState: { running: boolean; text: string } = { running: false, text: '' };
  private videoInfo = el('div', { class: 'field-hint' });
  private buildBtn: HTMLButtonElement | HTMLAnchorElement | null = null;
  private stale = false;
  /** The current trace's palette (#rrggbb, light to dark) and Auto Color's pick. */
  private palette: string[] = [];
  private autoK: number | null = null;
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

  /** Auto Enhance progress: running shows Cancel instead of the start button. */
  setEnhanceStatus(running: boolean, text: string): void {
    this.enhanceState = { running, text };
    const box = this.el.querySelector<HTMLElement>('[data-enhance]');
    if (box) box.replaceWith(this.renderEnhance());
  }

  /** Progress or problems of the background remover ("" hides the line). */
  setBgStatus(text: string): void {
    this.bgStatus = text;
    const line = this.el.querySelector<HTMLElement>('[data-bg-status]');
    if (line) {
      line.textContent = text;
      line.hidden = !text;
    }
  }

  /** The palette of the latest trace, for the colour swatches. */
  setPalette(palette: string[] | null, autoK: number | null): void {
    const p = palette ?? [];
    if (p.join() === this.palette.join() && autoK === this.autoK) return;
    this.palette = p;
    this.autoK = autoK;
    if (this.s.color) this.render();
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
    const usesThreshold = mode === 'fill' || s.lineSource === 'centerline' || s.lineSource === 'contours';
    const usesEdges = mode !== 'fill' && (s.lineSource === 'edges' || s.lineSource === 'ink');
    const br = BUDGET_RANGE[mode];

    const modeCtl = segmented<Mode>(
      [
        { value: 'outline', label: 'Outline', icon: 'pen' },
        { value: 'fill', label: 'Fill', icon: 'fill' },
        { value: 'fourier', label: 'Fourier', icon: 'wave' },
      ],
      mode,
      (m) => {
        const lineSource: LineSource = m === 'fourier' && (s.lineSource === 'edges' || s.lineSource === 'ink') ? 'contours' : s.lineSource;
        this.patch({ mode: m, lineSource, budget: s.budgets[m] }, true);
      },
      { full: true },
    );

    const sourceCtl =
      mode !== 'fill'
        ? select<LineSource>({
            label: 'Lines come from',
            options: [
              { value: 'ink', label: 'Ink lines (best for drawings and anime)' },
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

    const quality = segmented<Quality>(
      [
        { value: 'balanced', label: 'Balanced', title: 'Sharp, and still quick for Desmos to draw' },
        { value: 'max', label: 'Max detail', title: 'Highest fidelity. Bigger graphs that Desmos draws more slowly' },
      ],
      s.quality,
      (q) => {
        const p = presetValues(q, !!this.v);
        const budget = p.budgets ? p.budgets[s.mode] : s.budget;
        this.patch({ ...p, quality: q, budget }, true);
      },
      { size: 'sm', full: true },
    );

    const merge =
      (mode === 'outline' || mode === 'fourier') && !this.v
        ? toggle({
            label: 'Fewest equations',
            value: s.mergeSmall,
            hint: 'All curves of a colour share one equation, so Desmos loads and redraws much faster. Turn off to inspect curves one by one.',
            onChange: (v) => this.patch({ mergeSmall: v }),
          }).el
        : null;

    const res = slider({
      label: 'Working resolution',
      min: this.v ? 96 : 120,
      max: this.v ? VIDEO_MAX_RES : ENHANCED_MAX_RES,
      step: 8,
      value: s.resolution,
      format: (v) => `${v} px`,
      hint: 'Long side of the traced image, up to 1920 px (1080p) for pictures. Higher means more detail and more equations.',
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
      max: this.v ? Math.min(br.max, 4000) : HIGH_BUDGET_MAX,
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
      this.renderPicture(),
      this.section(
        'Detail',
        quality.el,
        res.el,
        toggle({
          label: 'Sharpen & denoise',
          value: s.enhance,
          hint: 'Cleans and sharpens the picture before tracing. Helps blurry or noisy photos, most of all at high resolutions.',
          onChange: (v) => this.patch({ enhance: v }),
        }).el,
        edge,
        usesThreshold ? thrAuto.el : null,
        usesThreshold ? el('p', { class: 'field-hint', dataset: { autoThr: '' } }, `Automatic (Otsu): ${this.autoThreshold}`) : null,
        usesThreshold ? thrSlider.el : null,
        invert,
      ),
      this.section('Smoothing', blur.el, tol.el, speck.el),
      this.section('Equation budget', budget.el, terms),
      this.section('Desmos output', stroke, merge, notes, epi, dark),
      this.renderBeta(),
      el(
        'div',
        { class: 'settings-foot' },
        button({ label: 'Reset settings', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: () => this.opts.onReset() }),
      ),
    );
  }

  /** BETA features: every control is gated behind a (free) account. */
  private renderBeta(): HTMLElement {
    const s = this.s;
    // In Color is for still images: video graphs stay black and white.
    const color = this.v
      ? null
      : toggle({
      label: 'In Color',
      value: s.color,
      hint: s.mode === 'fill' ? 'Traces colour layers that stack like paper cut-outs.' : 'Gives each stroke the colour of the picture under it.',
      onChange: (v) => this.patch({ color: v }, true),
    });
    const inColor = s.color && !this.v;
    const autoColor = inColor
      ? toggle({
          label: 'Auto Color',
          value: s.autoColor,
          hint: 'Finds how many colours this picture really needs, and brings back the vividness that averaging takes away.',
          onChange: (v) => this.patch({ autoColor: v }, true),
        })
      : null;
    let colors: HTMLElement | null = null;
    if (inColor) {
      const ctl = slider({
        label: s.autoColor ? 'Colours (picked automatically)' : 'Colours',
        min: 2,
        max: 16,
        step: 1,
        value: s.autoColor && this.autoK ? this.autoK : s.colors,
        hint: s.autoColor ? 'Auto Color chose this. Turn Auto Color off to pick your own.' : 'How many colours to reduce the picture to. More colours means more equations.',
        onInput: (v) => this.patch({ colors: v }),
      });
      if (s.autoColor) ctl.setDisabled(true);
      colors = ctl.el;
    }
    const adjust = inColor ? this.renderColorAdjust() : null;
    const lineArt =
      s.mode !== 'fill' && (s.lineSource === 'ink' || s.lineSource === 'centerline')
        ? toggle({
            label: 'Line-art cleanup',
            value: s.lineCleanup,
            hint: 'Removes screentone dots and joins small gaps in comic and anime line art.',
            onChange: (v) => this.patch({ lineCleanup: v }),
          })
        : null;
    const crop = toggle({
      label: 'Crop and resize',
      value: s.cropOn,
      hint: 'Drag on the source picture above to crop it. Working resolution sets the output size.',
      onChange: (v) => this.patch({ cropOn: v }, true),
    });
    const cropTools = s.cropOn
      ? el(
          'div',
          { class: 'crop-tools' },
          segmented<CropAspect>(
            [
              { value: 'free', label: 'Free' },
              { value: '1:1', label: '1:1' },
              { value: '4:3', label: '4:3' },
              { value: '16:9', label: '16:9' },
              { value: '9:16', label: '9:16' },
            ],
            s.cropAspect,
            (v) => this.patch({ cropAspect: v }),
            { size: 'sm', full: true },
          ).el,
          button({ label: 'Reset crop', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: () => this.patch({ crop: null }, true) }),
        )
      : null;
    return this.section(
      'BETA features',
      betaGate(this.renderEnhance(), 'Auto Enhance', { badge: 'top' }),
      el('p', { class: 'field-hint' }, isBetaEnabled() ? 'Thanks for signing in. These features are still being tuned.' : 'Free with an account. Sign in to try them.'),
      color ? betaGate(color.el, 'In Color') : null,
      autoColor ? betaGate(autoColor.el, 'Auto Color') : null,
      colors ? betaGate(colors, 'In Color') : null,
      adjust,
      lineArt ? betaGate(lineArt.el, 'Line-art cleanup') : null,
      betaGate(crop.el, 'Crop and resize'),
      cropTools ? betaGate(cropTools, 'Crop and resize', { badge: 'none' }) : null,
    );
  }

  /** BETA Auto Enhance: pick a goal, then let it search the settings. */
  private renderEnhance(): HTMLElement {
    const st = this.enhanceState;
    const modeCtl = segmented<'optimize' | 'max'>(
      [
        { value: 'optimize', label: 'Optimization', title: 'As close to the picture as possible while staying quick for Desmos to draw.' },
        { value: 'max', label: 'Max Quality', title: 'As close to the picture as possible, whatever the size.' },
      ],
      this.enhanceMode,
      (v) => (this.enhanceMode = v),
      { size: 'sm', full: true },
    );
    return el(
      'div',
      { class: 'enhance', dataset: { enhance: '' } },
      el('div', { class: 'field-row' }, el('span', { class: 'field-label' }, 'Auto Enhance')),
      modeCtl.el,
      st.running
        ? button({ label: 'Cancel', icon: 'x', variant: 'outline', size: 'sm', onClick: () => this.opts.onAutoEnhance('cancel') })
        : button({ label: 'Auto Enhance', icon: 'wand', variant: 'primary', size: 'sm', onClick: () => this.opts.onAutoEnhance(this.enhanceMode) }),
      el(
        'p',
        { class: 'field-hint', attrs: { 'aria-live': 'polite' } },
        st.text || 'Tunes one step at a time: resolution first, then smoothing, detail and budget, keeping whatever matches your picture best and looks cleanest. Videos are tuned on five frames. You can still change anything afterwards.',
      ),
    );
  }

  /** The picture: background remover, drawing and the detail brush. */
  private renderPicture(): HTMLElement {
    const s = this.s;
    const bg = toggle({
      label: 'Remove background',
      value: s.bgRemove,
      hint: this.v
        ? 'Cuts the subject out of every frame before tracing, so only it becomes equations.'
        : 'Cuts the subject out before tracing, so only it becomes equations.',
      onChange: (v) => this.patch({ bgRemove: v }, true),
    });
    const controls: (HTMLElement | null)[] = [];
    if (s.bgRemove) {
      controls.push(
        segmented<'auto' | 'plain'>(
          [
            { value: 'auto', label: 'Automatic', icon: 'wand', title: `A small AI model finds the subject (downloads once, ${BG_MODEL.size}).` },
            { value: 'plain', label: 'Plain colour', icon: 'fill', title: 'Removes a flat background colour that touches the edges. Instant.' },
          ],
          s.bgMethod,
          (v) => this.patch({ bgMethod: v }, true),
          { size: 'sm', full: true },
        ).el,
      );
      if (s.bgMethod === 'plain') {
        controls.push(
          slider({
            label: 'Colour tolerance',
            min: 2,
            max: 60,
            step: 1,
            value: s.bgTolerance,
            hint: 'How different a colour can be from the background and still go.',
            onInput: () => undefined,
            onChange: (v) => this.patch({ bgTolerance: v }),
          }).el,
        );
      }
      controls.push(
        slider({
          label: 'Soften edges',
          min: 0,
          max: 6,
          step: 0.5,
          value: s.bgFeather,
          format: (v) => `${v} px`,
          onInput: () => undefined,
          onChange: (v) => this.patch({ bgFeather: v }),
        }).el,
      );
      if (!this.v) {
        controls.push(button({ label: 'Touch up the cut-out', icon: 'brush', variant: 'outline', size: 'sm', onClick: () => this.opts.onEdit('mask') }));
      }
    }
    const status = el('p', { class: 'field-hint bg-status', dataset: { bgStatus: '' }, hidden: !this.bgStatus }, this.bgStatus);
    const tools = el(
      'div',
      { class: 'picture-tools' },
      button({ label: 'Draw on it', icon: 'pen', variant: 'outline', size: 'sm', onClick: () => this.opts.onEdit('draw') }),
      this.v ? null : button({ label: 'Detail brush', icon: 'sparkle', variant: 'ghost', size: 'sm', onClick: () => this.opts.onEdit('detail') }),
    );
    return this.section('Picture', bg.el, ...controls, status, tools);
  }

  /** Saturation, brightness and per-colour swatches. Changes rebuild the graph without retracing. */
  private renderColorAdjust(): HTMLElement {
    const s = this.s;
    const sat = slider({
      label: 'Saturation',
      min: 0,
      max: 200,
      step: 5,
      value: Math.round(s.saturation * 100),
      format: (v) => `${v}%`,
      hint: s.autoColor ? 'Auto Color set this. You can still adjust it.' : 'Makes every colour more vivid, or more muted.',
      onInput: () => undefined,
      onChange: (v) => this.patch({ saturation: v / 100 }, true),
    });
    const bright = slider({
      label: 'Brightness',
      min: -50,
      max: 50,
      step: 5,
      value: Math.round(s.brightness * 100),
      format: (v) => (v > 0 ? `+${v}%` : `${v}%`),
      onInput: () => undefined,
      onChange: (v) => this.patch({ brightness: v / 100 }, true),
    });
    const shown = adjustPalette(this.palette, { saturation: s.saturation, brightness: s.brightness }, s.colorOverrides);
    const picker = el('input', { type: 'color', class: 'swatch-picker', tabIndex: -1, attrs: { 'aria-hidden': 'true' } });
    let editing = -1;
    picker.addEventListener('change', () => {
      if (editing < 0) return;
      this.patch({ colorOverrides: { ...this.s.colorOverrides, [editing]: picker.value } }, true);
    });
    const swatches = this.palette.length
      ? el(
          'div',
          { class: 'swatches', attrs: { role: 'group', 'aria-label': 'Colours in the graph' } },
          ...shown.map((c, i) =>
            el('button', {
              type: 'button',
              class: 'swatch' + (s.colorOverrides[i] ? ' is-custom' : ''),
              style: { background: c },
              title: `Colour ${i + 1}: ${c}. Click to replace it.`,
              attrs: { 'aria-label': `Colour ${i + 1}, ${c}. Replace` },
              on: {
                click: () => {
                  editing = i;
                  picker.value = c;
                  picker.click();
                },
              },
            }),
          ),
          picker,
        )
      : null;
    const changed = s.saturation !== 1 || s.brightness !== 0 || Object.keys(s.colorOverrides).length > 0;
    return el(
      'div',
      { class: 'color-adjust' },
      sat.el,
      bright.el,
      swatches,
      swatches ? el('p', { class: 'field-hint' }, 'Click a colour to replace it. Light colours sit underneath, dark ones on top.') : null,
      changed
        ? button({
            label: 'Reset colours',
            icon: 'refresh',
            variant: 'ghost',
            size: 'sm',
            onClick: () => this.patch({ saturation: 1, brightness: 0, colorOverrides: {} }, true),
          })
        : null,
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
