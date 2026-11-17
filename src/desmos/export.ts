/**
 * The four ways to move a graph into desmos.com (verified in the spike):
 *  1. Bookmarklet "Send to Desmos": one click on desmos.com/calculator; it
 *     opens our #/handoff page, which posts the staged state back, and the
 *     bookmarklet calls Calc.setState. No clipboard or size limits.
 *  2. Console snippet: Calc.setState(...) pasted into DevTools on desmos.com.
 *  3. JSON file download (the raw graph state).
 *  4. LaTeX lines: Desmos splits a multi-line paste into one expression per
 *     line. Styling (black ink, fill opacity, folders) does not survive.
 */

import type { DesmosState } from './state';

export function stateJson(state: DesmosState, pretty = false): string {
  return JSON.stringify(state, null, pretty ? 2 : 0);
}

export function consoleSnippet(state: DesmosState): string {
  return `Calc.setState(${stateJson(state)}, {allowUndo: true})`;
}

export interface PasteOptions {
  /**
   * Fit the drawing into Desmos' default view (about -10..10). A plain paste
   * cannot set the viewport, so without this the picture lands at 0..W, off
   * screen. Default true.
   */
  fit?: boolean;
}

/** Scale and centre that move the graph's viewport into Desmos' default view. */
export function pasteFit(state: DesmosState): { s: number; cx: number; cy: number } {
  const v = state.graph.viewport;
  const w = Math.max(1e-9, v.xmax - v.xmin);
  const h = Math.max(1e-9, v.ymax - v.ymin);
  const s = Math.min(18 / w, 10 / h);
  return {
    s: Number(s.toPrecision(3)),
    cx: Number(((v.xmin + v.xmax) / 2).toFixed(2)),
    cy: Number(((v.ymin + v.ymax) / 2).toFixed(2)),
  };
}

const shift = (v: string, c: number) => (c === 0 ? v : c > 0 ? `${v}-${c}` : `${v}+${-c}`);

/** Q(x,y): the paste-fit transform, applied inside the shared point functions. */
export function fitFunction(state: DesmosState): string {
  const { s, cx, cy } = pasteFit(state);
  return `Q\\left(x,y\\right)=\\left(${s}\\left(${shift('x', cx)}\\right),${s}\\left(${shift('y', cy)}\\right)\\right)`;
}

const POLY = '\\operatorname{polygon}\\left(\\left(';
const FRAME = '\\left[F\\right]';
const SHARED_FN = /^(P_\{\d+\}|Z)\\left\(/;

/**
 * Plain LaTeX for pasting into desmos.com, data lists first so variables
 * exist before they are used. Rotating-circle animations are left out (they
 * need a ticker, which a paste cannot create).
 *
 * With `fit` (default), a transform Q is defined once and wrapped around the
 * shared point functions (P_c, Z) and every drawn polygon or point curve, so
 * the drawing appears centred in Desmos' default view. For videos, F is
 * remapped so Desmos' default -10..10 slider covers every frame:
 *   F_r = clamp(round((F+10)(N-1)/20) + 1)
 */
export function latexLines(state: DesmosState, opts: PasteOptions = {}): string {
  const fit = opts.fit !== false;
  const handler = state.expressions.ticker?.handlerLatex ?? '';
  const frames = handler.startsWith('F\\to') ? Number(/\\left\(F,(\d+)\\right\)/.exec(handler)?.[1] ?? 0) : 0;
  const data: string[] = [];
  const draw: string[] = [];
  if (fit) data.push(fitFunction(state));
  if (frames > 1) {
    data.push(
      `F_{r}=\\max\\left(1,\\min\\left(${frames},\\operatorname{round}\\left(\\frac{\\left(F+10\\right)\\cdot ${frames - 1}}{20}\\right)+1\\right)\\right)`,
    );
  }
  for (const item of state.expressions.list) {
    if (item.type !== 'expression') continue;
    if (item.id.startsWith('epi')) continue;
    let latex = item.latex;
    if (frames > 1) {
      if (item.id === 'F') latex = 'F=-10';
      else if (!item.folderId) latex = latex.split(FRAME).join('\\left[F_{r}\\right]');
    }
    if (fit) {
      if (item.folderId) {
        if (SHARED_FN.test(latex) && latex.includes('=\\left(')) latex = latex.replace('=\\left(', '=Q\\left(');
      } else if (latex.includes(POLY)) {
        // Every polygon((xs, ys)), including ones inside a "for" list.
        latex = latex.split(POLY).join('\\operatorname{polygon}\\left(Q\\left(');
      } else if (latex.startsWith('\\left(')) {
        latex = 'Q' + latex;
      }
    }
    (item.folderId ? data : draw).push(latex);
  }
  return [...data, ...draw].join('\n');
}

/**
 * Split pasted LaTeX into parts of at most `max` characters, never inside a
 * line, keeping the order (data lists first). Huge single pastes can freeze a
 * Chromebook's Desmos tab; several smaller pastes stay responsive.
 */
export function latexParts(text: string, max = 60_000): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const line of text.split('\n')) {
    if (cur.length && len + line.length + 1 > max) {
      parts.push(cur.join('\n'));
      cur = [];
      len = 0;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) parts.push(cur.join('\n'));
  return parts;
}

/** Managed school laptops (ChromeOS) usually block bookmarklets and the console, so pasting is the way in. */
export function isChromebook(): boolean {
  return typeof navigator !== 'undefined' && /\bCrOS\b/.test(navigator.userAgent);
}

export const DESMOS_ORIGINS =['https://www.desmos.com', 'https://desmos.com'];

/**
 * javascript: URL for the "Send to Desmos" bookmark. `origin` is this site's
 * origin (localhost while developing, the Pages URL in production).
 */
export function bookmarkletHref(origin: string): string {
  const code = `(()=>{var o=${JSON.stringify(origin)};if(!window.Calc||!Calc.setState){alert('Media to Desmos: open desmos.com/calculator first, then click this bookmark.');return}var w=window.open(o+'/#/handoff','m2d_handoff','width=460,height=360');if(!w){alert('Media to Desmos: allow pop-ups for desmos.com and click again.');return}var t=setTimeout(function(){window.removeEventListener('message',f)},120000);function f(e){if(e.origin!==o||!e.data||e.data.type!=='m2d-state')return;window.removeEventListener('message',f);clearTimeout(t);try{Calc.setState(e.data.state,{allowUndo:true});e.source&&e.source.postMessage({type:'m2d-done'},o)}catch(err){alert('Media to Desmos could not load the graph: '+err.message)}}window.addEventListener('message',f)})()`;
  return 'javascript:' + encodeURIComponent(code).replace(/'/g, '%27');
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'graph'
  );
}

/** Basic validation for an imported .json state. */
export function parseStateFile(text: string): DesmosState {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || !s.expressions || !Array.isArray(s.expressions.list) || !s.graph) {
    throw new Error('That file is not a Desmos graph state.');
  }
  return s as DesmosState;
}
