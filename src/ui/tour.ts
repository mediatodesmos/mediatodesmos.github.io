/**
 * First-run guided tour: a dimmed spotlight with a blueprint selection frame around each target,
 * and a card tooltip with a step count, Back, Next and Skip. No libraries.
 *
 *   startTour(CONVERT_TOUR, { id: 'convert' });          // shows once, then remembers it
 *   startTour(CONVERT_TOUR, { id: 'convert', force: true }); // a "Take the tour" button
 *
 * - Runs in a modal <dialog>, so the page behind is inert and focus stays in the card (Tab cycles).
 * - Keys: Right arrow = next, Left arrow = back, Esc = skip. Keys never reach the page's own shortcuts.
 * - Scrolls each target into view and follows it while the page scrolls or reflows.
 * - Steps whose selector matches nothing at start are left out; a step whose target is hidden when
 *   reached (even after its `before` hook) is skipped.
 * - Respects prefers-reduced-motion. Completion (finished or skipped) is stored as m2d.tour.<id>.
 */

import '../styles/tour.css';

import { button, crosshairs, uid } from './components';
import { el, prefersReducedMotion } from './dom';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  /** CSS selector of the element to spotlight (the first match is used). */
  selector: string;
  title: string;
  body: string;
  /** Preferred side for the card. It flips or moves inside the spotlight when there is no room. */
  placement?: TourPlacement;
  /** Runs before the step shows, e.g. to switch a mobile tab so the target becomes visible. */
  before?: () => void | Promise<void>;
}

export interface TourOptions {
  /** Remembered as localStorage "m2d.tour.<id>". */
  id: string;
  /** Show even if this tour was finished or skipped before. */
  force?: boolean;
  /** Small label above the title. Default "Quick tour". */
  label?: string;
  /** Called once when the tour closes. `completed` is true when the user reached the end. */
  onEnd?: (result: { completed: boolean }) => void;
}

export interface TourHandle {
  /** Close without remembering anything. */
  close(): void;
}

/* ================================================================ storage */

const storageKey = (id: string) => `m2d.tour.${id}`;

/** True once the tour was finished or skipped. */
export function hasSeenTour(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) !== null;
  } catch {
    return false;
  }
}

/** Forget that a tour was seen, so it shows again on the next startTour(). */
export function resetTour(id: string): void {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    /* storage blocked */
  }
}

function remember(id: string, how: 'done' | 'skipped'): void {
  try {
    localStorage.setItem(storageKey(id), how);
  } catch {
    /* storage blocked: the tour may show again next visit */
  }
}

/* ================================================================ geometry */

const PAD = 6; // spotlight padding around the target
const GAP = 12; // card distance from the spotlight
const EDGE = 12; // minimum distance from the viewport edge

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OPPOSITE: Record<TourPlacement, TourPlacement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

function viewport(): { w: number; h: number } {
  return { w: document.documentElement.clientWidth || window.innerWidth, h: window.innerHeight };
}

/** Spotlight box: the target plus padding, kept inside the viewport so the frame stays visible. */
function spotBox(target: Element): Box {
  const r = target.getBoundingClientRect();
  const vp = viewport();
  const x1 = Math.max(r.left - PAD, 4);
  const y1 = Math.max(r.top - PAD, 4);
  const x2 = Math.min(r.right + PAD, vp.w - 4);
  const y2 = Math.min(r.bottom + PAD, vp.h - 4);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/** Card position next to the spotlight: preferred side, its opposite, the roomiest other side, then inside. */
function cardPosition(spot: Box, cw: number, ch: number, preferred: TourPlacement): { x: number; y: number; side: TourPlacement | 'inside' } {
  const vp = viewport();
  const room: Record<TourPlacement, number> = {
    top: spot.y - EDGE,
    bottom: vp.h - (spot.y + spot.h) - EDGE,
    left: spot.x - EDGE,
    right: vp.w - (spot.x + spot.w) - EDGE,
  };
  const rest = (['bottom', 'top', 'right', 'left'] as TourPlacement[])
    .filter((s) => s !== preferred && s !== OPPOSITE[preferred])
    .sort((a, b) => room[b] - room[a]);
  const order: TourPlacement[] = [preferred, OPPOSITE[preferred], ...rest];
  const cx = spot.x + spot.w / 2;
  const cy = spot.y + spot.h / 2;
  const xMax = vp.w - cw - EDGE;
  const yMax = vp.h - ch - EDGE;

  for (const side of order) {
    if (side === 'top' || side === 'bottom') {
      if (room[side] < ch + GAP || cw > vp.w - 2 * EDGE) continue;
      const y = side === 'bottom' ? spot.y + spot.h + GAP : spot.y - GAP - ch;
      return { x: clamp(cx - cw / 2, EDGE, xMax), y, side };
    }
    if (room[side] < cw + GAP || ch > vp.h - 2 * EDGE) continue;
    const x = side === 'right' ? spot.x + spot.w + GAP : spot.x - GAP - cw;
    return { x, y: clamp(cy - ch / 2, EDGE, yMax), side };
  }
  // No room outside: sit inside the spotlight near its bottom edge.
  const bottom = Math.min(spot.y + spot.h, vp.h) - 16;
  return { x: clamp(cx - cw / 2, EDGE, xMax), y: clamp(bottom - ch, EDGE, yMax), side: 'inside' };
}

function isShown(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement) || !node.isConnected) return false;
  const r = node.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || node.getClientRects().length === 0) return false;
  const check = (node as HTMLElement & { checkVisibility?: (o?: { visibilityProperty?: boolean }) => boolean }).checkVisibility;
  return typeof check === 'function' ? check.call(node, { visibilityProperty: true }) : getComputedStyle(node).visibility !== 'hidden';
}

/** Next animation frame, or a short timeout when the page is not painting (background tabs). */
function frame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 64);
  });
}

/** Resolves when a smooth scroll ends (scrollend), right away if nothing scrolls, and after 900ms at most. */
function scrollSettled(): Promise<void> {
  return new Promise((resolve) => {
    let moved = false;
    const timers: number[] = [];
    const onScroll = () => {
      moved = true;
    };
    const done = () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('scrollend', done, true);
      timers.forEach((t) => clearTimeout(t));
      resolve();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('scrollend', done, true);
    timers.push(window.setTimeout(() => !moved && done(), 150));
    timers.push(window.setTimeout(done, 900));
  });
}

/**
 * Does the target need scrolling? A small target must be fully visible under the sticky header;
 * a tall one (an equation list, the graph) only needs to fill 60% of that space.
 */
function needsScroll(node: Element): boolean {
  const r = node.getBoundingClientRect();
  const vp = viewport();
  const top = Math.max(0, document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0);
  const visible = Math.min(r.bottom, vp.h) - Math.max(r.top, top);
  const wanted = Math.min(r.height, (vp.h - top) * 0.6);
  return visible < wanted - 8 || r.left < -8 || r.right > vp.w + 8;
}

/* ================================================================ the tour */

let active: { close(silent: boolean): void } | null = null;

/** Is a tour on screen right now? */
export function isTourActive(): boolean {
  return active !== null;
}

/**
 * Start a tour. Returns null (and remembers nothing) when it was already seen, when none of its
 * targets exist, or when another modal dialog is open.
 */
export function startTour(steps: TourStep[], opts: TourOptions): TourHandle | null {
  if (!opts.force && hasSeenTour(opts.id)) return null;
  if (document.querySelector('dialog[open]:not(.tour)')) return null;
  const list = steps.filter((s) => document.querySelector(s.selector));
  if (!list.length) return null;
  active?.close(true);

  const reduced = prefersReducedMotion();
  const titleId = uid('tour-title');
  const bodyId = uid('tour-body');

  /* ---------------------------------------------------------- DOM */

  const spot = el('div', { class: 'tour-spot', attrs: { 'aria-hidden': 'true' } });
  crosshairs(spot);

  const count = el('span', { class: 'tour-count mono' });
  const title = el('h2', { class: 'card-title tour-title', id: titleId });
  const body = el('p', { class: 'card-desc tour-body', id: bodyId });
  const text = el('div', { class: 'tour-text' }, title, body);
  const pips = list.map(() => el('span', { class: 'tour-pip' }));

  const skipBtn = button({ label: 'Skip', variant: 'ghost', size: 'sm', class: 'tour-skip', onClick: () => finish('skipped') }) as HTMLButtonElement;
  const backBtn = button({ label: 'Back', variant: 'outline', size: 'sm', class: 'tour-back', onClick: () => void go(index - 1, -1) }) as HTMLButtonElement;
  const nextBtn = button({ label: 'Next', iconRight: 'arrow-right', variant: 'primary', size: 'sm', class: 'tour-next', onClick: () => void go(index + 1, 1) }) as HTMLButtonElement;
  const doneBtn = button({ label: 'Done', icon: 'check', variant: 'primary', size: 'sm', class: 'tour-done', onClick: () => finish('done') }) as HTMLButtonElement;

  const card = el(
    'div',
    { class: 'card tour-card' },
    el(
      'div',
      { class: 'card-head tour-head' },
      el('div', { class: 'tour-meta' }, el('span', { class: 'overline' }, opts.label ?? 'Quick tour'), count),
      text,
    ),
    el(
      'div',
      { class: 'tour-foot' },
      el('div', { class: 'tour-pips', attrs: { 'aria-hidden': 'true' } }, ...pips),
      el('div', { class: 'tour-actions' }, skipBtn, backBtn, nextBtn, doneBtn),
    ),
  );
  const live = el('p', { class: 'sr-only', attrs: { 'aria-live': 'polite' } });
  const dlg = el('dialog', { class: 'tour', attrs: { 'aria-labelledby': titleId, 'aria-describedby': bodyId } }, spot, card, live);

  /* ---------------------------------------------------------- state */

  let index = -1;
  let target: HTMLElement | null = null;
  let closed = false;
  let busy = false;
  let placed = false;
  let raf = 0;
  const lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const setText = (i: number, announce: boolean) => {
    const s = list[i];
    title.textContent = s.title;
    body.textContent = s.body;
    count.textContent = `${i + 1} of ${list.length}`;
    pips.forEach((p, j) => {
      p.classList.toggle('is-done', j < i);
      p.classList.toggle('is-current', j === i);
    });
    const last = i === list.length - 1;
    backBtn.disabled = i === 0;
    skipBtn.hidden = last;
    nextBtn.hidden = last;
    doneBtn.hidden = !last;
    if (!reduced && placed) {
      text.classList.remove('is-swapping');
      void text.offsetWidth; // restart the swap animation
      text.classList.add('is-swapping');
    }
    if (announce) live.textContent = `Step ${i + 1} of ${list.length}. ${s.title}. ${s.body}`;
  };

  /** Measure and move the spotlight and the card. Instant, so they track scrolling and reflow exactly. */
  const place = () => {
    raf = 0;
    if (closed || index < 0) return;
    if (!isShown(target)) {
      // The target was re-rendered or hidden: follow its replacement, or move on.
      const again = document.querySelector(list[index].selector);
      if (isShown(again)) {
        target = again;
        ro.observe(again);
      } else {
        void go(index + 1, 1);
        return;
      }
    }
    const box = spotBox(target);
    const radius = Math.min(24, (parseFloat(getComputedStyle(target).borderTopLeftRadius) || 4) + PAD);
    spot.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;border-radius:${radius}px`;
    const pos = cardPosition(box, card.offsetWidth, card.offsetHeight, list[index].placement ?? 'bottom');
    card.style.left = `${Math.round(pos.x)}px`;
    card.style.top = `${Math.round(pos.y)}px`;
    card.dataset.side = pos.side;
    if (!placed) {
      placed = true;
      dlg.classList.add('is-ready'); // reveal (and run the entrance animation) only once positioned
    }
  };

  /** Step change: the spotlight and card glide to the new target (scroll-driven updates stay instant). */
  let glideTimer = 0;
  const glide = () => {
    if (placed && !reduced) {
      dlg.classList.add('is-moving');
      clearTimeout(glideTimer);
      glideTimer = window.setTimeout(() => dlg.classList.remove('is-moving'), 460);
    }
    place();
  };

  const schedule = () => {
    if (raf || closed) return;
    raf = requestAnimationFrame(place);
    // Background tabs skip animation frames; still settle the layout.
    setTimeout(() => {
      if (raf) {
        cancelAnimationFrame(raf);
        place();
      }
    }, 80);
  };

  /** Show step `to`, skipping hidden targets in direction `dir`. Past the end, the tour finishes. */
  const go = async (to: number, dir: 1 | -1): Promise<void> => {
    if (busy || closed) return;
    busy = true;
    try {
      let i = to;
      while (i >= 0 && i < list.length) {
        await list[i].before?.();
        if (closed) return;
        await frame();
        if (closed) return;
        const node = document.querySelector(list[i].selector);
        if (isShown(node)) {
          const focusWasOn = document.activeElement;
          index = i;
          target = node;
          ro.disconnect();
          ro.observe(node);
          ro.observe(card);
          setText(i, placed);
          if (needsScroll(node)) {
            const block = node.getBoundingClientRect().height > viewport().h * 0.7 ? 'start' : 'center';
            if (!placed || reduced) {
              node.scrollIntoView({ block, inline: 'nearest', behavior: 'auto' });
            } else {
              // The card fades out while the page scrolls; the spotlight rides along with the target.
              dlg.classList.add('is-scrolling');
              node.scrollIntoView({ block, inline: 'nearest', behavior: 'smooth' });
              await scrollSettled();
              if (closed) return;
              dlg.classList.remove('is-scrolling');
            }
          }
          glide();
          // Keep focus on a visible, enabled control (Next becomes Done on the last step).
          const keep = focusWasOn instanceof HTMLButtonElement && card.contains(focusWasOn) && !focusWasOn.hidden && !focusWasOn.disabled;
          if (!keep) (i === list.length - 1 ? doneBtn : nextBtn).focus({ preventScroll: true });
          return;
        }
        i += dir;
      }
      // Ran out of steps going forward: that is the end, unless nothing was ever shown.
      if (dir > 0) finish(index >= 0 ? 'done' : null);
    } finally {
      busy = false;
    }
  };

  /* ---------------------------------------------------------- closing */

  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('hashchange', onRoute);
    clearInterval(poll);
    clearTimeout(glideTimer);
    ro.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (dlg.open) dlg.close();
    dlg.remove();
    if (active === controller) active = null;
    if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
  };

  function finish(how: 'done' | 'skipped' | null): void {
    if (closed) return;
    closed = true;
    if (how) remember(opts.id, how);
    try {
      opts.onEnd?.({ completed: how === 'done' });
    } catch (err) {
      console.error(err);
    }
    if (reduced || !dlg.open) {
      teardown();
      return;
    }
    dlg.classList.add('is-closing');
    const fallback = setTimeout(teardown, 260);
    const onEnd = (e: AnimationEvent) => {
      if (e.target !== card) return; // ignore the text swap animation bubbling up
      card.removeEventListener('animationend', onEnd);
      clearTimeout(fallback);
      teardown();
    };
    card.addEventListener('animationend', onEnd);
  }

  const controller = { close: (silent: boolean) => finish(silent ? null : 'skipped') };
  const onRoute = () => finish(null);

  /* ---------------------------------------------------------- events */

  const ro = new ResizeObserver(schedule);
  const poll = setInterval(schedule, 400); // catches layout shifts that fire no event

  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the tour is modal: page shortcuts (frame stepping, play) must not fire
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index === list.length - 1) finish('done');
      else void go(index + 1, 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) void go(index - 1, -1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish('skipped');
    } else if (e.key === 'Tab') {
      const items = [skipBtn, backBtn, nextBtn, doneBtn].filter((b) => !b.hidden && !b.disabled);
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
      e.preventDefault();
      items[next].focus();
    }
  });
  dlg.addEventListener('keyup', (e) => e.stopPropagation());
  // Esc can also arrive as a cancel request, and the browser may close the dialog by itself.
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    finish('skipped');
  });
  dlg.addEventListener('close', () => finish('skipped'));

  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('hashchange', onRoute);

  /* ---------------------------------------------------------- go */

  document.body.append(dlg);
  dlg.showModal();
  active = controller;
  void go(0, 1);

  return { close: () => finish(null) };
}

/** Close any running tour without remembering it. */
export function endTour(): void {
  active?.close(true);
}
