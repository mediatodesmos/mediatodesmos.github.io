import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/home.css';
import './styles/app.css';

import { mountShell } from './ui/shell';
import { renderHome } from './screens/home';
import { renderConvert } from './screens/convert';
import { renderGallery } from './screens/gallery';
import { renderLive } from './screens/live';
import { renderView } from './screens/view';
import { renderHandoff } from './screens/handoff';
import { go, openInConverter, REPO_URL, SITE_NAME } from './app';
import { samplePreview } from './screens/samples-preview';

type Cleanup = void | (() => void);

const app = document.getElementById('app')!;

interface Route {
  name: string;
  params: URLSearchParams;
  anchor: string | null;
}

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '');
  // "#how" and "#/#how" are anchors on the home page
  if (h.startsWith('/#')) return { name: '', params: new URLSearchParams(), anchor: h.slice(2) };
  if (!h.startsWith('/')) return { name: '', params: new URLSearchParams(), anchor: h || null };
  const [path, query] = h.slice(1).split('?');
  return { name: path.replace(/\/+$/, ''), params: new URLSearchParams(query ?? ''), anchor: null };
}

const TITLES: Record<string, string> = {
  '': `${SITE_NAME}: any image or video as a Desmos graph`,
  convert: `Convert | ${SITE_NAME}`,
  live: `Live webcam | ${SITE_NAME}`,
  gallery: `Projects | ${SITE_NAME}`,
  view: `Shared graph | ${SITE_NAME}`,
  handoff: `Sending to Desmos | ${SITE_NAME}`,
};

let cleanup: Cleanup;
let shell: ReturnType<typeof mountShell> | null = null;
let current = '\u0000';

function ensureShell(): NonNullable<typeof shell> {
  if (!shell) {
    app.innerHTML = '';
    shell = mountShell(app, {
      nav: [
        { label: 'Convert', href: '#/convert', icon: 'upload' },
        { label: 'Live webcam', href: '#/live', icon: 'camera' },
        { label: 'Projects', href: '#/gallery', icon: 'gallery' },
        { label: 'How it works', href: '#/#how', icon: 'help' },
      ],
      cta: { label: 'Convert a file', href: '#/convert' },
      repoUrl: REPO_URL,
    });
  }
  return shell;
}

function route(): void {
  const r = parse(location.hash);
  document.title = TITLES[r.name] ?? SITE_NAME;

  if (r.name === 'handoff') {
    if (typeof cleanup === 'function') cleanup();
    shell = null;
    current = 'handoff';
    app.innerHTML = '';
    cleanup = renderHandoff(app);
    return;
  }

  const sh = ensureShell();
  const key = r.name + '?' + r.params.toString();
  if (key !== current) {
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;
    current = key;
    const wide = r.name === 'live' || r.name === 'view';
    sh.setWide(wide);
    sh.setActive(r.name ? `#/${r.name}` : '#/');
    sh.main.innerHTML = '';
    switch (r.name) {
      case '':
        cleanup = renderHome(sh.main, {
          go,
          openFile: (file) => openInConverter({ type: 'file', file }),
          trySample: (kind) => openInConverter({ type: 'sample', kind }),
          samplePreview,
        });
        break;
      case 'convert':
        cleanup = renderConvert(sh.main, { setWide: (w) => sh.setWide(w) });
        break;
      case 'live':
        cleanup = renderLive(sh.main);
        break;
      case 'gallery':
        cleanup = renderGallery(sh.main);
        break;
      case 'view':
        cleanup = renderView(sh.main, r.params);
        break;
      default:
        go('#/');
        return;
    }
    if (!r.anchor) window.scrollTo({ top: 0 });
  }
  if (r.anchor) {
    const target = document.getElementById(r.anchor);
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

window.addEventListener('hashchange', route);

// Drop a file anywhere on the page to open it.
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('.dropzone, [data-dropzone]')) return; // handled by the drop zone itself
  e.preventDefault();
  openInConverter({ type: 'file', file: f });
});

route();
