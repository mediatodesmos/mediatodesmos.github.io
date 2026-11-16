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

/** Plain LaTeX, data lists first so variables exist before they are used. */
export function latexLines(state: DesmosState): string {
  const data: string[] = [];
  const draw: string[] = [];
  for (const item of state.expressions.list) {
    if (item.type !== 'expression') continue;
    (item.folderId ? data : draw).push(item.latex);
  }
  return [...data, ...draw].join('\n');
}

export const DESMOS_ORIGINS = ['https://www.desmos.com', 'https://desmos.com'];

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
