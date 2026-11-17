/** The export dialog: four ways to get the graph into desmos.com, plus share links. */

import { el, fmtBytes } from '../../ui/dom';
import { button, codeBlock, segmented, sheet, toast, toggle } from '../../ui/components';
import { icon } from '../../ui/icons';
import type { DesmosState } from '../../desmos/state';
import { bookmarkletHref, consoleSnippet, copyText, downloadText, isChromebook, latexLines, latexParts, slug, stateJson } from '../../desmos/export';
import { stageHandoff } from '../../store/projects';
import { shareUrl, SHARE_LINK_LIMIT } from '../../store/share';

type Route = 'latex' | 'bookmark' | 'console' | 'json' | 'image';

export interface ExportInput {
  name: string;
  kind: 'image' | 'video';
  state: DesmosState;
  bytes: number;
  /** A PNG of the traced drawing (for Desmos' image upload), when available. */
  png?: () => Promise<Blob | null>;
}

const BIG = 2_500_000;

/** A copy of the state with Desmos' grid, axes and axis numbers on (on = true) or hidden. */
export function withAxes(state: DesmosState, on = true): DesmosState {
  return { ...state, graph: { ...state.graph, showGrid: on, showXAxis: on, showYAxis: on, xAxisNumbers: on, yAxisNumbers: on } };
}

export function openExportSheet(input: ExportInput): void {
  const { name } = input;
  const baseState = input.state;
  // Desmos' normal coordinate plane by default (older saved projects were blank).
  let state = withAxes(baseState);
  stageHandoff(name, state).catch(() => undefined);
  const axesToggle = toggle({
    label: 'Blank page (hide grid and axes)',
    value: false,
    hint: 'Off shows Desmos’ usual grid, axes and numbers behind the drawing.',
    onChange: (v) => {
      state = withAxes(baseState, !v);
      stageHandoff(name, state).catch(() => undefined);
      renderRoute();
    },
  });

  // Chromebooks block bookmarklets and the console: start them on Paste.
  let route: Route = isChromebook() ? 'latex' : 'bookmark';
  const body = el('div', { class: 'xp-body' });

  const weight = el(
    'div',
    { class: 'xp-weight' + (input.bytes > BIG ? ' is-heavy' : '') },
    icon(input.bytes > BIG ? 'alert' : 'info', { size: 16 }),
    el(
      'span',
      null,
      `This graph is ${fmtBytes(input.bytes)} of equations. `,
      input.bytes > BIG
        ? 'That is heavy: Desmos may take a while to load it and play it slowly. Lowering the budget, resolution or fps helps.'
        : 'Comfortable for Desmos.',
    ),
  );

  const tabs = segmented<Route>(
    [
      { value: 'latex', label: 'Paste', icon: 'copy', title: 'Copy and paste plain equations. Works on Chromebooks.' },
      { value: 'bookmark', label: 'One click', icon: 'bookmark' },
      { value: 'console', label: 'Console', icon: 'terminal' },
      { value: 'json', label: 'JSON', icon: 'download' },
      ...(input.png ? [{ value: 'image' as const, label: 'Image', icon: 'image' as const }] : []),
    ],
    route,
    (r) => {
      route = r;
      renderRoute();
    },
    { full: true },
  );

  const step = (n: number, ...children: (Node | string)[]) =>
    el('li', { class: 'xp-step' }, el('span', { class: 'xp-step-n' }, String(n)), el('div', { class: 'xp-step-body' }, ...children));

  function renderRoute(): void {
    body.innerHTML = '';
    if (route === 'bookmark') {
      const bm = el(
        'a',
        {
          class: 'btn btn-outline xp-bookmarklet',
          href: bookmarkletHref(location.origin),
          title: 'Drag me to your bookmarks bar',
          on: {
            click: (e: MouseEvent) => {
              e.preventDefault();
              toast('Drag the button to your bookmarks bar instead of clicking it.');
            },
          },
        },
        icon('bookmark', { size: 16 }),
        'Send to Desmos',
      );
      body.append(
        el('p', { class: 'xp-lead' }, 'The smoothest route: a bookmark that pulls the graph into desmos.com with every style intact. Set it up once and reuse it.'),
        el(
          'ol',
          { class: 'xp-steps' },
          step(1, el('p', null, 'Drag this button to your bookmarks bar. You only need to do this once.'), bm),
          step(2, el('p', null, 'Open the Desmos graphing calculator. This graph is already staged for it.'), button({ label: 'Open desmos.com/calculator', iconRight: 'arrow-up-right', variant: 'primary', href: 'https://www.desmos.com/calculator', class: 'xp-open' })),
          step(3, el('p', null, 'On desmos.com, click the ', el('strong', null, 'Send to Desmos'), ' bookmark. A small window opens, hands over the graph and closes. Then sign in on Desmos and save it to your account.')),
        ),
        el('p', { class: 'field-hint' }, 'If nothing happens, allow pop-ups for desmos.com. The bookmark only talks to this site and desmos.com.'),
      );
      const a = body.querySelector<HTMLAnchorElement>('.xp-open');
      if (a) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
    } else if (route === 'console') {
      const snippet = consoleSnippet(state);
      body.append(
        el('p', { class: 'xp-lead' }, 'No bookmark needed. Paste one line into the browser console on desmos.com.'),
        el(
          'ol',
          { class: 'xp-steps' },
          step(1, el('p', null, 'Copy the snippet.'), button({ label: `Copy snippet (${fmtBytes(snippet.length)})`, icon: 'copy', variant: 'primary', onClick: () => copyText(snippet).then(() => toast('Snippet copied', { tone: 'success' }), () => toast('Copy failed: your browser blocked the clipboard', { tone: 'error' })) })),
          step(2, el('p', null, 'Open desmos.com/calculator and press F12 (or Ctrl+Shift+J, Cmd+Option+J on a Mac) to open the Console.')),
          step(3, el('p', null, 'Paste and press Enter. If Chrome asks, type "allow pasting" first. Your graph appears and can be undone with Ctrl+Z.')),
        ),
        codeBlock(snippet.length > 1200 ? snippet.slice(0, 1200) + ' ...' : snippet, { maxHeight: 120, copyLabel: 'Copy start' }),
      );
    } else if (route === 'json') {
      body.append(
        el('p', { class: 'xp-lead' }, 'The raw Desmos graph state as a file. Keep it as a backup, open it here later (drop it on the converter), or load it on desmos.com with the console route.'),
        button({ label: `Download ${slug(name)}.json (${fmtBytes(stateJson(state).length)})`, icon: 'download', variant: 'primary', onClick: () => downloadText(`${slug(name)}.desmos.json`, stateJson(state, true)) }),
      );
    } else if (route === 'image') {
      body.append(
        el('p', { class: 'xp-lead' }, 'A picture of the traced drawing, for Desmos’ image upload. Works everywhere, but Desmos shows it as a picture, not as equations.'),
        el(
          'ol',
          { class: 'xp-steps' },
          step(1, el('p', null, 'Download the PNG below.')),
          step(2, el('p', null, 'In Desmos, click ', el('strong', null, '+'), ' at the top of the expression list, then ', el('strong', null, 'image'), ', and pick the file.')),
          step(3, el('p', null, 'Drag its corners to size it. Use Paste for real equations you can edit.')),
        ),
        button({
          label: 'Download PNG',
          icon: 'download',
          variant: 'primary',
          onClick: async () => {
            const blob = await input.png?.();
            if (!blob) return toast('Could not draw the picture', { tone: 'error' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${slug(name)}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          },
        }),
      );
    } else {
      const text = latexLines(state);
      const parts = latexParts(text);
      const copied = new Set<number>();
      const copyPart = (i: number, btn: HTMLElement) =>
        copyText(parts[i]).then(
          () => {
            copied.add(i);
            if (!btn.classList.contains('is-done')) {
              const svg = btn.querySelector('svg');
              svg?.replaceWith(icon('check', { size: Number(svg.getAttribute('width')) || 16 }));
            }
            btn.classList.add('is-done');
            toast(parts.length > 1 ? `Part ${i + 1} copied: paste it into Desmos` : 'Copied: paste it into Desmos', { tone: 'success' });
          },
          () => toast('Copy failed', { tone: 'error' }),
        );
      const partButtons = parts.map((p, i) => {
        const b = button({
          label: parts.length > 1 ? `Copy part ${i + 1} of ${parts.length} (${fmtBytes(p.length)})` : `Copy ${p.split('\n').length.toLocaleString('en-US')} lines (${fmtBytes(p.length)})`,
          icon: 'copy',
          variant: i === 0 ? 'primary' : 'outline',
          onClick: () => void copyPart(i, b),
        });
        return b;
      });
      body.append(
        el('p', { class: 'xp-lead' }, 'Works on school Chromebooks: no bookmarks, extensions or console. You copy plain equations here and paste them into Desmos.'),
        el(
          'ol',
          { class: 'xp-steps' },
          step(1, el('p', null, 'Open ', el('a', { href: 'https://www.desmos.com/calculator', target: '_blank', rel: 'noopener' }, 'desmos.com/calculator'), ' (a new, empty graph is best).')),
          step(2, el('p', null, 'Click the first empty line in the expression list.')),
          step(
            3,
            el(
              'p',
              null,
              parts.length > 1
                ? `Copy part 1 below and paste it (Ctrl+V). Wait until Desmos finishes, click the empty line at the bottom, then do the same with the next part.`
                : 'Copy below and paste (Ctrl+V). Desmos turns every line into its own expression.',
            ),
          ),
          step(
            4,
            el(
              'p',
              null,
              input.kind === 'video'
                ? 'Press play on the F slider to animate. Its normal -10 to 10 range covers every frame.'
                : 'Done: the drawing appears in the middle of the usual grid.',
            ),
          ),
        ),
        el('div', { class: 'xp-parts' }, ...partButtons),
        el('p', { class: 'field-hint' }, 'A paste keeps the equations but not the styling: Desmos picks the colours, and fills are 40% see-through. You can recolour each colour layer by hand.'),
      );
    }
  }

  renderRoute();
  const dlg = sheet({
    title: 'Export to Desmos',
    description: name,
    content: el('div', { class: 'xp' }, weight, axesToggle.el, tabs.el, body),
    width: 620,
  });
  dlg.open();
}

export async function openShareSheet(input: ExportInput): Promise<void> {
  let url = '';
  let length = 0;
  try {
    const r = await shareUrl({ v: 1, name: input.name, kind: input.kind, state: input.state });
    url = r.url;
    length = r.length;
  } catch {
    toast('This browser cannot compress share links.', { tone: 'error' });
    return;
  }
  const tooBig = length > SHARE_LINK_LIMIT;
  const content = el(
    'div',
    { class: 'xp' },
    tooBig
      ? el(
          'div',
          { class: 'xp-weight is-heavy' },
          icon('alert', { size: 16 }),
          el('span', null, `This graph needs a ${fmtBytes(length)} link, too long to share reliably. Export it to desmos.com and share the Desmos link instead, or lower the budget and try again.`),
        )
      : el('p', { class: 'xp-lead' }, 'Anyone with this link sees the graph and its equations. The graph lives inside the link itself; nothing is uploaded.'),
    tooBig ? null : codeBlock(url.length > 600 ? url.slice(0, 600) + '...' : url, { maxHeight: 100, copyLabel: 'Copy start' }),
    tooBig
      ? null
      : el(
          'div',
          { class: 'xp-row' },
          button({ label: `Copy link (${fmtBytes(length)})`, icon: 'link', variant: 'primary', onClick: () => copyText(url).then(() => toast('Link copied', { tone: 'success' })) }),
          button({ label: 'Open', icon: 'external', variant: 'outline', href: url }),
        ),
  );
  sheet({ title: 'Share link', description: input.name, content, width: 560 }).open();
}
