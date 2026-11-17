/**
 * Before/after slider: the original on the left of a draggable divider, the
 * Desmos drawing on the right. Mouse, touch and keyboard (arrows, Home, End).
 */

import { el } from './dom';
import { icon } from './icons';
import { badge } from './components';
import '../styles/compare.css';

export interface CompareOptions {
  before: Element;
  after: Element;
  label: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** Start position, 0..100 (percent from the left). */
  start?: number;
  /** Width / height, used to reserve space before content loads. */
  aspect?: number;
}

export function compareSlider(o: CompareOptions): { el: HTMLElement; set(pct: number): void } {
  let pct = o.start ?? 50;
  const beforeLayer = el('div', { class: 'cmp-layer cmp-before' }, o.before);
  const afterLayer = el('div', { class: 'cmp-layer cmp-after' }, o.after);
  const handle = el(
    'div',
    {
      class: 'cmp-handle',
      tabIndex: 0,
      attrs: { role: 'slider', 'aria-label': `${o.label}: drag to compare`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct) },
    },
    el('span', { class: 'cmp-knob' }, icon('compare', { size: 16 })),
  );
  const root = el(
    'div',
    { class: 'cmp', style: o.aspect ? `aspect-ratio:${o.aspect}` : undefined },
    afterLayer,
    beforeLayer,
    handle,
    el('div', { class: 'cmp-tag cmp-tag-l' }, badge(o.beforeLabel ?? 'Original', { icon: 'image' })),
    el('div', { class: 'cmp-tag cmp-tag-r' }, badge(o.afterLabel ?? 'Desmos', { icon: 'bezier', tone: 'blue' })),
  );

  const set = (v: number) => {
    pct = Math.max(0, Math.min(100, v));
    root.style.setProperty('--pos', `${pct}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(pct)));
  };
  set(pct);

  const fromEvent = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 100);
  };
  let dragging = false;
  root.addEventListener('pointerdown', (e) => {
    dragging = true;
    root.setPointerCapture(e.pointerId);
    fromEvent(e);
    handle.focus({ preventScroll: true });
  });
  root.addEventListener('pointermove', (e) => {
    if (dragging) fromEvent(e);
  });
  root.addEventListener('pointerup', () => (dragging = false));
  root.addEventListener('pointercancel', () => (dragging = false));
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') set(pct - step);
    else if (e.key === 'ArrowRight') set(pct + step);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(100);
    else return;
    e.preventDefault();
  });
  return { el: root, set };
}
