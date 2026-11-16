/** Video transport bar: play / pause, frame scrubber, playback mode. */

import { el } from '../../ui/dom';
import { iconButton, segmented } from '../../ui/components';

export type PlaybackMode = 'desmos' | 'preview';

export interface TransportOptions {
  onFrame: (f: number) => void;
  onPlay: (playing: boolean) => void;
  onMode: (m: PlaybackMode) => void;
}

export class Transport {
  readonly el: HTMLElement;
  private range: HTMLInputElement;
  private label: HTMLElement;
  private playBtn: HTMLButtonElement;
  private playing = false;
  private frames = 1;
  private frame = 1;
  private fps = 10;
  private modeCtl: { el: HTMLElement; set(v: PlaybackMode): void };

  constructor(private opts: TransportOptions) {
    this.range = el('input', {
      class: 'range tp-range',
      type: 'range',
      min: '1',
      max: '1',
      step: '1',
      value: '1',
      attrs: { 'aria-label': 'Frame' },
      on: {
        input: () => {
          this.frame = Number(this.range.value);
          this.updateLabel();
          this.opts.onFrame(this.frame);
        },
      },
    });
    this.label = el('span', { class: 'tp-label mono' });
    this.playBtn = iconButton({ icon: 'play', title: 'Play', variant: 'primary', onClick: () => this.toggle() });
    const prev = iconButton({ icon: 'step-back', title: 'Previous frame', variant: 'ghost', onClick: () => this.step(-1) });
    const next = iconButton({ icon: 'step-forward', title: 'Next frame', variant: 'ghost', onClick: () => this.step(1) });
    this.modeCtl = segmented<PlaybackMode>(
      [
        { value: 'desmos', label: 'Desmos', title: 'Step the real Desmos graph (speed depends on how heavy each frame is)' },
        { value: 'preview', label: 'Smooth preview', title: 'Draw the traced frames directly for smooth playback' },
      ],
      'desmos',
      (m) => this.opts.onMode(m),
      { size: 'sm' },
    );
    this.el = el('div', { class: 'tp' }, prev, this.playBtn, next, this.range, this.label, this.modeCtl.el);
    this.updateLabel();
  }

  setup(frames: number, fps: number): void {
    this.frames = Math.max(1, frames);
    this.fps = fps;
    this.range.max = String(this.frames);
    this.setFrame(1);
  }

  setFrame(f: number): void {
    this.frame = Math.min(this.frames, Math.max(1, f));
    this.range.value = String(this.frame);
    this.updateLabel();
  }

  get current(): number {
    return this.frame;
  }

  setPlaying(p: boolean): void {
    this.playing = p;
    const fresh = iconButton({ icon: p ? 'pause' : 'play', title: p ? 'Pause' : 'Play', variant: 'primary', onClick: () => this.toggle() });
    this.playBtn.replaceWith(fresh);
    this.playBtn = fresh;
  }

  private toggle(): void {
    this.setPlaying(!this.playing);
    this.opts.onPlay(this.playing);
  }

  private step(d: number): void {
    let f = this.frame + d;
    if (f > this.frames) f = 1;
    if (f < 1) f = this.frames;
    this.setFrame(f);
    this.opts.onFrame(f);
  }

  private updateLabel(): void {
    const t = (this.frame - 1) / this.fps;
    this.label.textContent = `${this.frame} / ${this.frames}  ${t.toFixed(1)}s`;
  }
}
