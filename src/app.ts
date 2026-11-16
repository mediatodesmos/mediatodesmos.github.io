/** Cross-screen state and navigation. */

import type { DesmosState } from './desmos/state';

export const SITE_NAME = 'Media to Desmos';
export const REPO_URL = 'https://github.com/mediatodesmos/mediatodesmos.github.io';

export type PendingOpen =
  | { type: 'file'; file: File }
  | { type: 'sample'; kind: 'image' | 'video' }
  | { type: 'project'; id: string }
  | { type: 'state'; name: string; state: DesmosState };

let pending: PendingOpen | null = null;

/** Ask the convert screen to open something once it mounts. */
export function openInConverter(p: PendingOpen): void {
  pending = p;
  if (location.hash.startsWith('#/convert')) window.dispatchEvent(new CustomEvent('m2d:open'));
  else go('#/convert');
}

export function takePending(): PendingOpen | null {
  const p = pending;
  pending = null;
  return p;
}

export function go(href: string): void {
  if (href.startsWith('http')) {
    location.href = href;
    return;
  }
  const h = href.startsWith('#') ? href : '#' + href;
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}
