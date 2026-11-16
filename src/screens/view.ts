/** #/view?d=... : a graph shared by link. */

import { el, mount } from '../ui/dom';
import { button, emptyState, spinner } from '../ui/components';
import { icon } from '../ui/icons';
import { openInConverter, go } from '../app';
import { decodeShare } from '../store/share';
import { GraphView } from '../desmos/embed';
import { entriesFromState } from '../desmos/explain';
import { stateWeight } from '../desmos/state';
import { openExportSheet } from './convert/export-sheet';
import { Inspector } from './convert/inspector';

export function renderView(main: HTMLElement, params: URLSearchParams): () => void {
  let graph: GraphView | null = null;
  const code = params.get('d');
  mount(main, el('div', { class: 'convert-empty' }, el('div', { class: 'convert-loading' }, spinner(26), el('p', null, 'Opening shared graph...'))));
  if (!code) {
    mount(main, el('div', { class: 'convert-empty' }, emptyState({ icon: 'link', title: 'Empty share link', description: 'This link has no graph in it.' })));
    return () => undefined;
  }
  let alive = true;
  decodeShare(code)
    .then(async (p) => {
      if (!alive) return;
      const entries = entriesFromState(p.state);
      const host = el('div', { class: 'ws-graph' });
      const status = el('div', { class: 'ws-graph-status' }, spinner(20), el('span', null, 'Loading Desmos...'));
      const insp = new Inspector({
        onHover: (e) => graph?.highlight(e && e.kind !== 'data' ? [e.id] : []),
        onSelect: (e) => graph?.highlight(e && e.kind !== 'data' ? [e.id] : []),
        onSolo: (e) => graph?.solo(e ? [e.id] : null),
        onZoom: () => graph?.fit(),
        onCopyAll: () => openExportSheet({ name: p.name, kind: p.kind, state: p.state, bytes: stateWeight(p.state).bytes }),
      });
      insp.setEntries(entries);
      mount(
        main,
        el(
          'div',
          { class: 'ws ws-view', dataset: { tab: 'graph' } },
          el(
            'div',
            { class: 'ws-top' },
            el('div', { class: 'ws-file' }, el('span', { class: 'ws-file-icon' }, icon('link', { size: 16 })), el('div', { class: 'ws-file-text' }, el('span', { class: 'ws-file-name' }, p.name), el('span', { class: 'ws-file-meta' }, `Shared ${p.kind} graph  /  ${stateWeight(p.state).expressions} expressions`))),
            el(
              'div',
              { class: 'ws-actions' },
              button({ label: 'Open in converter', icon: 'sliders', variant: 'outline', size: 'sm', onClick: () => openInConverter({ type: 'state', name: p.name, state: p.state }) }),
              button({ label: 'Export to Desmos', icon: 'arrow-up-right', variant: 'primary', size: 'sm', onClick: () => openExportSheet({ name: p.name, kind: p.kind, state: p.state, bytes: stateWeight(p.state).bytes }) }),
            ),
          ),
          el('div', { class: 'ws-grid ws-grid-2' }, el('section', { class: 'ws-center' }, el('div', { class: 'ws-graph-wrap' }, host, status)), el('aside', { class: 'ws-right panel' }, insp.el)),
        ),
      );
      try {
        graph = await GraphView.create(host, { dark: true });
        if (!alive) return graph.destroy();
        status.hidden = true;
        graph.load(p.state);
        if (p.state.expressions.ticker) graph.setFrame(1);
      } catch (err) {
        mount(status, icon('alert', { size: 18 }), el('span', null, err instanceof Error ? err.message : 'Desmos failed to load.'));
        status.classList.add('is-error');
      }
    })
    .catch((err) => {
      if (!alive) return;
      mount(
        main,
        el(
          'div',
          { class: 'convert-empty' },
          emptyState({
            icon: 'alert',
            title: 'This link could not be opened',
            description: err instanceof Error ? err.message : String(err),
            action: button({ label: 'Convert your own', icon: 'upload', variant: 'primary', onClick: () => go('#/convert') }) as HTMLElement,
          }),
        ),
      );
    });
  return () => {
    alive = false;
    graph?.destroy();
  };
}
