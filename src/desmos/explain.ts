/**
 * Explain arbitrary expressions in a Desmos state (for imported JSON files
 * and share links, where we no longer have the traced shapes).
 */

import type { InspectorEntry } from './build';
import type { DesmosState } from './state';

function countListItems(latex: string): number {
  const m = latex.match(/\\left\[(.*?)\\right\]/);
  if (!m) return 0;
  return m[1].split(',').length;
}

export function entriesFromState(state: DesmosState): InspectorEntry[] {
  const out: InspectorEntry[] = [];
  let pendingTitle: string | null = null;
  let n = 0;
  for (const item of state.expressions.list) {
    if (item.type === 'text') {
      if (!item.text.startsWith('Made with')) pendingTitle = item.text;
      continue;
    }
    if (item.type !== 'expression') continue;
    n++;
    const latex = item.latex ?? '';
    const base = { id: item.id, latex };
    const title = pendingTitle;
    pendingTitle = null;
    if (/^F=/.test(latex) && item.slider) {
      out.push({ ...base, kind: 'slider', title: 'Frame slider F', summary: `Frames ${item.slider.min} to ${item.slider.max}`, explain: 'Picks which frame is on screen. Every draw expression reads F.' });
    } else if (latex.startsWith('\\operatorname{polygon}')) {
      const pts = countListItems(latex);
      out.push({
        ...base,
        kind: 'region',
        title: title?.split(':')[0] ?? `Polygon ${n}`,
        summary: pts ? `${pts} points` : 'Polygon from list slices',
        explain: 'polygon() connects the points in order and fills the inside. Holes are walked the opposite way and joined by zero-width bridges.',
      });
    } else if (latex.includes('\\left(1-t\\right)^{3}')) {
      const segs = countListItems(latex);
      out.push({
        ...base,
        kind: 'stroke',
        title: title?.split(':')[0] ?? `Curve ${n}`,
        summary: segs ? `${segs} cubic Bezier segments` : 'Bezier segments selected from lists by frame',
        explain: 'A parametric cubic Bezier curve. As t goes from 0 to 1 each segment moves from its start point to its end point, pulled toward two control points. One equation draws every segment in the lists.',
      });
    } else if (latex.includes('\\operatorname{total}')) {
      const terms = countListItems(latex);
      out.push({
        ...base,
        kind: 'fourier',
        title: title?.split(':')[0] ?? `Fourier curve ${n}`,
        summary: terms ? `${terms} rotating circles` : 'Fourier series',
        explain: 'A sum of circles spinning at whole-number speeds. Together their tips trace the outline once as t goes from 0 to 1.',
      });
    } else if (/^[A-Za-z]_\{[a-z0-9]+\}=\\left\[/.test(latex)) {
      const items = countListItems(latex);
      const name = latex.slice(0, latex.indexOf('='));
      out.push({
        ...base,
        kind: 'data',
        title: `List ${name.replace(/[{}]/g, '').replace('_', ' ')}`,
        summary: `${items.toLocaleString('en-US')} numbers`,
        explain: 'A data list. It draws nothing by itself; draw expressions read slices of it.',
      });
    } else {
      out.push({ ...base, kind: 'note', title: title ?? `Expression ${n}`, summary: latex.length > 60 ? latex.slice(0, 60) + '...' : latex, explain: 'A general Desmos expression.' });
    }
  }
  if (state.expressions.ticker) {
    out.splice(1, 0, {
      id: 'm2d-ticker',
      kind: 'ticker',
      title: 'Ticker (playback)',
      summary: `Runs ${state.expressions.ticker.handlerLatex} every ${state.expressions.ticker.minStepLatex} ms`,
      explain: 'A Desmos ticker repeats an action on a timer; here it advances the frame slider.',
      latex: state.expressions.ticker.handlerLatex,
    });
  }
  return out;
}
