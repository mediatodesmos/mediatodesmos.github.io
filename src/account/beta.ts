/**
 * The BETA gate. BETA features need a free account; everything else works without one.
 *
 * The gate is client-side: it decides what the interface offers, it is not DRM. Code that applies a
 * BETA setting should still check isBetaEnabled(), since a saved project can carry the setting.
 */

import '../styles/account.css';
import { el } from '../ui/dom';
import { badge, tooltip } from '../ui/components';
import { getAuthState, initAuth, onAuthChange } from './auth';
import { openSignInSheet } from './signin-sheet';

/** True while someone is signed in. */
export function isBetaEnabled(): boolean {
  return getAuthState().user !== null;
}

/** Calls `cb` whenever BETA access turns on or off (not right away). Returns an unsubscribe function. */
export function onBetaChange(cb: (enabled: boolean) => void): () => void {
  let last = isBetaEnabled();
  return onAuthChange((s) => {
    const now = s.user !== null;
    if (now === last) return;
    last = now;
    cb(now);
  });
}

/** The shared BETA badge: the existing blue badge with the flask icon. */
export function betaBadge(): HTMLElement {
  const b = badge('BETA', { icon: 'flask', tone: 'blue' });
  b.classList.add('beta-badge');
  return b;
}

/**
 * Resolves true once BETA access is available. Signed-in people get true at once. Otherwise this
 * opens the sign-in sheet ("<feature> is a BETA feature. Sign in (free) to use it.") and resolves
 * when it closes: true if the person signed in, false if not.
 */
export async function requireBeta(featureName: string): Promise<boolean> {
  // Someone who signed in on an earlier visit may still be loading.
  if (!getAuthState().ready) await initAuth();
  if (isBetaEnabled()) return true;
  return openSignInSheet({ feature: featureName });
}

/* ================================================================ gate */

/**
 * Where betaGate() puts the badge.
 * - auto: inside the control's .field-label if it has one (toggle, select, slider), after it for a
 *   button or input, otherwise above it.
 * - label / inline / top: force one of those. none: no badge (place betaBadge() yourself).
 */
export type BetaBadgePlacement = 'auto' | 'label' | 'inline' | 'top' | 'none';

export interface BetaGateOptions {
  badge?: BetaBadgePlacement;
}

const FOCUSABLE = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function placementFor(control: HTMLElement, wanted: BetaBadgePlacement): Exclude<BetaBadgePlacement, 'auto'> {
  const hasLabel = !!control.querySelector('.field-label');
  if (wanted === 'label') return hasLabel ? 'label' : 'top';
  if (wanted !== 'auto') return wanted;
  if (hasLabel) return 'label';
  return control.matches('button, a, input, select, textarea, .btn, .icon-btn') ? 'inline' : 'top';
}

function focusFirst(control: HTMLElement): void {
  const target = control.matches(FOCUSABLE) ? control : control.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
}

/* Every gate follows one subscription. Gates that leave the page are dropped on the next sweep. */

interface GateRecord {
  wrap: HTMLElement;
  paint(enabled: boolean): void;
  /** Seen in the document at least once, so being detached now means it was removed. */
  seen: boolean;
}

const gates = new Set<GateRecord>();
let following = false;

function sweep(): void {
  for (const g of gates) {
    if (g.wrap.isConnected) g.seen = true;
    else if (g.seen) gates.delete(g);
  }
}

function track(g: GateRecord): void {
  sweep();
  gates.add(g);
  // Screens insert what they build in the same task, so by now the gate is usually on the page.
  queueMicrotask(sweep);
  if (following) return;
  following = true;
  onBetaChange((enabled) => {
    sweep();
    for (const gate of gates) gate.paint(enabled);
  });
}

/**
 * Wraps a control so it only works for signed-in people.
 *
 * Signed out, the control is dimmed and inert (no clicks, no focus) and the BETA badge shows. A click
 * anywhere on it opens the sign-in sheet; after signing in, the control unlocks and takes focus.
 * Signed in, the control works as usual and keeps its BETA badge.
 *
 * Insert the returned element where the control would have gone.
 */
export function betaGate(control: HTMLElement, featureName: string, o: BetaGateOptions = {}): HTMLElement {
  const placement = placementFor(control, o.badge ?? 'auto');
  const lock = el('button', {
    class: 'beta-gate-lock',
    type: 'button',
    attrs: { 'aria-label': `${featureName} is a BETA feature. Sign in (free) to use it.` },
  });
  tooltip(lock, `Sign in (free) to use ${featureName}`);

  const wrap = el('div', { class: `beta-gate beta-gate-${placement}`, dataset: { betaFeature: featureName } });
  if (placement === 'label') control.querySelector('.field-label')?.append(betaBadge());
  if (placement === 'top') wrap.append(betaBadge());
  wrap.append(control);
  if (placement === 'inline') wrap.append(betaBadge());
  wrap.append(lock);

  const record: GateRecord = {
    wrap,
    seen: false,
    paint(enabled: boolean) {
      // Unlocking hides the lock button; if it had focus, hand focus to the control instead of losing it.
      const handOff = enabled && document.activeElement === lock;
      wrap.classList.toggle('is-locked', !enabled);
      control.toggleAttribute('inert', !enabled);
      lock.hidden = enabled;
      if (handOff) focusFirst(control);
    },
  };
  record.paint(isBetaEnabled());
  track(record);

  // A gate taken off the page and put back later catches up when someone reaches for it.
  const resync = () => {
    if (!gates.has(record)) gates.add(record);
    record.paint(isBetaEnabled());
  };
  wrap.addEventListener('pointerenter', resync);
  wrap.addEventListener('focusin', resync);

  lock.addEventListener('click', async () => {
    if (!(await requireBeta(featureName))) return;
    record.paint(true);
    focusFirst(control);
  });
  return wrap;
}
