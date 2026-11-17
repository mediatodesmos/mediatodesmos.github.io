/**
 * The first-run tour of the convert workspace (src/screens/convert/index.ts).
 *
 *   startTour(CONVERT_TOUR, { id: CONVERT_TOUR_ID });   // once the workspace has a file open
 *
 * Under 960px the workspace shows one column at a time behind Settings / Graph / Equations tabs,
 * so each step first opens the tab that holds its target. On wider screens that does nothing.
 */

import type { TourStep } from '../ui/tour';

export const CONVERT_TOUR_ID = 'convert';

type WorkspaceTab = 'Settings' | 'Graph' | 'Equations';

/** Open a workspace tab by clicking its chip, when the tabs are on screen. */
function showTab(name: WorkspaceTab): void {
  const tabs = document.querySelector<HTMLElement>('.ws-tabs');
  if (!tabs || tabs.getClientRects().length === 0) return;
  const chip = [...tabs.querySelectorAll<HTMLButtonElement>('.chip')].find((c) => c.textContent?.trim() === name);
  if (chip && chip.getAttribute('aria-checked') !== 'true') chip.click();
}

export const CONVERT_TOUR: TourStep[] = [
  {
    selector: '.ws-file',
    placement: 'bottom',
    title: 'Your file',
    body: 'The file you opened, with its type, resolution and size. Use New, or drop another file on the page, to switch.',
  },
  {
    selector: '.settings .seg',
    placement: 'right',
    title: 'Pick a drawing style',
    body: 'Outline traces lines as Bezier curves, Fill draws solid shapes as polygons, and Fourier redraws each outline with rotating circles.',
    before: () => showTab('Settings'),
  },
  {
    selector: '.ws-graph-wrap',
    placement: 'right',
    title: 'Your graph, live',
    body: 'A real Desmos calculator with your trace on it. It updates as you change settings, and you can pan and zoom to check the details.',
    before: () => showTab('Graph'),
  },
  {
    selector: '.insp',
    placement: 'left',
    title: 'Every equation, explained',
    body: 'Each curve and shape gets its own entry. Select one to highlight it on the graph and read what its equation does.',
    before: () => showTab('Equations'),
  },
  {
    selector: '.ws-actions .btn-primary',
    placement: 'bottom',
    title: 'Send it to Desmos',
    body: 'Export gives you four ways in: a one-click bookmarklet, a console snippet, a JSON file or plain LaTeX lines.',
    before: () => showTab('Graph'),
  },
];
