/**
 * #/handoff : opened in a small pop-up by the "Send to Desmos" bookmarklet
 * on desmos.com. It posts the staged graph back to the opener and closes.
 */

import { el, mount } from '../ui/dom';
import { icon } from '../ui/icons';
import { logoMark } from '../ui/icons';
import { readHandoff } from '../store/projects';
import { DESMOS_ORIGINS } from '../desmos/export';

export function renderHandoff(root: HTMLElement): () => void {
  const msg = el('p', { class: 'handoff-msg' }, 'Looking for your staged graph...');
  const title = el('h1', { class: 'handoff-title' }, 'Sending to Desmos');
  mount(root, el('div', { class: 'handoff' }, el('div', { class: 'handoff-card' }, el('div', { class: 'handoff-logo' }, logoMark(28)), title, msg)));

  const onMsg = (e: MessageEvent) => {
    if (!DESMOS_ORIGINS.includes(e.origin) || e.data?.type !== 'm2d-done') return;
    title.textContent = 'Done';
    mount(msg, icon('check', { size: 16 }), ' The graph is in Desmos. This window will close.');
    setTimeout(() => window.close(), 900);
  };
  window.addEventListener('message', onMsg);

  readHandoff()
    .then((h) => {
      if (!h) {
        title.textContent = 'Nothing staged';
        msg.textContent = 'Open a graph in Media to Desmos and click "Export to Desmos" first, then click the bookmark on desmos.com again.';
        return;
      }
      if (!window.opener) {
        title.textContent = 'Open this from desmos.com';
        msg.textContent = 'This page is opened by the "Send to Desmos" bookmark while you are on desmos.com/calculator.';
        return;
      }
      for (const origin of DESMOS_ORIGINS) {
        try {
          (window.opener as Window).postMessage({ type: 'm2d-state', state: h.state, name: h.name }, origin);
        } catch {
          /* wrong origin: ignored */
        }
      }
      msg.textContent = `Sending "${h.name}"...`;
      setTimeout(() => {
        if (title.textContent === 'Sending to Desmos') msg.textContent = `Sent "${h.name}". If the graph did not appear, make sure this window was opened from desmos.com/calculator.`;
      }, 4000);
    })
    .catch(() => {
      title.textContent = 'Storage unavailable';
      msg.textContent = 'This browser blocked local storage, so the staged graph could not be read. Use the Console route instead.';
    });

  return () => window.removeEventListener('message', onMsg);
}
