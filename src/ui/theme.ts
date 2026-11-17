/**
 * Colour theme: dark (the default) or light.
 *
 * The palettes live in src/styles/tokens.css. This module flips data-theme on <html>, keeps the
 * theme-color meta in step, remembers the choice and tells listeners.
 *
 *   applyStoredTheme();                 // once at startup, before the first render
 *   headerActions.append(themeToggle()); // sun / moon icon button
 *   onThemeChange((t) => preview.setDark(t === 'dark'));
 */

import { iconButton } from './components';
import { prefersReducedMotion } from './dom';
import { icon } from './icons';

export type Theme = 'dark' | 'light';

/** localStorage key. An inline pre-paint script in index.html can read the same key. */
export const THEME_STORAGE_KEY = 'm2d.theme';

/** Browser chrome colour per theme: the page background (--bg in tokens.css). */
const THEME_COLOR: Record<Theme, string> = { dark: '#121212', light: '#fafafa' };

type Listener = (theme: Theme) => void;

const listeners = new Set<Listener>();
/** The theme last asked for (setTheme, toggle, startup, system or another tab). */
let current: Theme | null = null;
/** The theme <html> shows and listeners last heard. Lags `current` while a crossfade is pending. */
let painted: Theme | null = null;
let externalBound = false;

const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light';

/* ================================================================ storage */

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(t: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {
    /* storage blocked (private mode, site data off): the choice lasts for this page */
  }
}

/* ================================================================ painting */

const lightQuery = (): MediaQueryList | null =>
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

/** Dark unless the system asks for light. */
function systemTheme(): Theme {
  return lightQuery()?.matches ? 'light' : 'dark';
}

function syncMeta(t: Theme): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = THEME_COLOR[t];
}

function paint(t: Theme): void {
  document.documentElement.dataset.theme = t;
  syncMeta(t);
}

interface ViewTransitionLike {
  finished: Promise<unknown>;
}
type StartViewTransition = (update: () => void) => ViewTransitionLike;

/** Paint the latest requested theme and tell listeners if it differs from what they last heard. */
function commit(): void {
  const t = current ?? 'dark';
  paint(t);
  if (painted === t) return;
  painted = t;
  for (const cb of [...listeners]) {
    try {
      cb(t);
    } catch (err) {
      console.error(err);
    }
  }
}

/**
 * Swap palettes in one step. With View Transitions the page crossfades (220ms, see base.css), and
 * listeners run inside the update so their changes crossfade too. Otherwise CSS transitions pause for
 * a frame so every element changes colour at once.
 */
function swap(animate: boolean): void {
  const root = document.documentElement;
  const settle = () => requestAnimationFrame(() => root.classList.remove('is-theme-switching'));
  root.classList.add('is-theme-switching');

  const start = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (animate && typeof start === 'function' && !prefersReducedMotion() && document.visibilityState === 'visible') {
    try {
      start.call(document, commit).finished.then(settle, settle);
      return;
    } catch {
      /* fall through to the instant swap */
    }
  }
  commit();
  void getComputedStyle(root).color; // flush styles while transitions are off
  settle();
}

function apply(t: Theme, animate: boolean): void {
  current = t;
  if (painted === t && document.documentElement.dataset.theme === t) {
    syncMeta(t);
    return;
  }
  swap(animate);
}

/** Follow the system setting (while nothing is stored) and choices made in other tabs. */
function bindExternalChanges(): void {
  if (externalBound) return;
  externalBound = true;
  const mq = lightQuery();
  mq?.addEventListener?.('change', () => {
    if (!readStored()) apply(systemTheme(), true);
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== null) return;
    apply(readStored() ?? systemTheme(), true);
  });
}

/* ================================================================ public API */

/** The theme on screen now. */
export function getTheme(): Theme {
  if (current) return current;
  const attr = document.documentElement.dataset.theme;
  return isTheme(attr) ? attr : 'dark';
}

/** Switch theme and remember the choice. */
export function setTheme(t: Theme): void {
  writeStored(t);
  apply(t, true);
}

/** Flip between dark and light; returns the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Called after every theme change with the new theme. Returns an unsubscribe function. */
export function onThemeChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Call once at startup, before the first render. Applies the stored choice; with nothing stored it
 * honours prefers-color-scheme (light only when the system asks for it, dark otherwise).
 */
export function applyStoredTheme(): Theme {
  const t = readStored() ?? systemTheme();
  apply(t, false);
  bindExternalChanges();
  return t;
}

/* ================================================================ toggle button */

const toggleLabel = (t: Theme) => (t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');

/**
 * Header icon button. Like Vertex it shows the theme it switches to: the sun in dark mode, the moon in light.
 */
export function themeToggle(): HTMLButtonElement {
  const t0 = getTheme();
  const btn = iconButton({
    icon: t0 === 'dark' ? 'sun' : 'moon',
    title: toggleLabel(t0),
    class: 'theme-toggle',
    onClick: () => toggleTheme(),
  });

  let wasConnected = false;
  const off = onThemeChange((t) => {
    if (btn.isConnected) wasConnected = true;
    else if (wasConnected) {
      off(); // the button left the page for good
      return;
    }
    const prevLabel = btn.getAttribute('aria-label');
    const label = toggleLabel(t);
    btn.setAttribute('aria-label', label);
    btn.dataset.tip = label; // tooltip() reads data-tip each time it opens
    // A tooltip that is open on this button right now gets the new text too.
    const tip = document.querySelector<HTMLElement>('.tooltip.is-visible');
    if (tip && tip.textContent === prevLabel && (btn.matches(':hover') || document.activeElement === btn)) tip.textContent = label;
    const glyph = icon(t === 'dark' ? 'sun' : 'moon', { size: 16, class: 'is-entering' });
    btn.querySelector('svg')?.replaceWith(glyph);
  });
  return btn;
}
