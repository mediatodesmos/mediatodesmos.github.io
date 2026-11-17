/**
 * Home screen, laid out on the Vertex landing-page patterns:
 * hero + stacked card mockup, format cloud, how it works, feature grid, stats, FAQ, final CTA.
 * All illustrations are drawn here as inline SVG/HTML. They are diagrams, never fake data.
 */

import '../styles/home.css';

import { el, svgEl, prefersReducedMotion, type Child } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import {
  badge,
  button,
  chipTray,
  crosshairs,
  disposeWithin,
  dropZone,
  faq,
  hatch,
  rule,
  sectionHead,
  stat,
  uid,
  type FaqCategory,
} from '../ui/components';

import { compareSlider } from '../ui/compare';
import type { CompareExample } from './samples-preview';

export interface HomeContext {
  go(href: string): void;
  openFile(file: File): void;
  trySample(kind: 'image' | 'video'): void;
  samplePreview(mode: 'outline' | 'fill' | 'fourier' | 'video'): Promise<SVGSVGElement | null>;
  /** Before/after pairs for the "See the difference" section. */
  compareExamples?(): Promise<CompareExample[]>;
}

type Mode = 'outline' | 'fill' | 'fourier' | 'video';
type Pt = [number, number];

/* ================================================================ small helpers */

const S = svgEl;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const P = (p: Pt): string => `${r2(p[0])} ${r2(p[1])}`;
const sup = (t: string): HTMLElement => el('sup', null, t);
const sub = (t: string): HTMLElement => el('sub', null, t);

function art(viewBox: string, cls: string, ...kids: Child[]): SVGSVGElement {
  return S('svg', { class: `art ${cls}`, viewBox, fill: 'none', attrs: { 'aria-hidden': 'true', focusable: 'false' } }, ...kids);
}

/** Points on a wobbly closed curve around (cx, cy). */
function blob(cx: number, cy: number, r: number, n: number, phase = 0, sx = 1): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + phase;
    const rr = r * (1 + 0.16 * Math.sin(3 * a) + 0.07 * Math.cos(5 * a + 0.6));
    pts.push([cx + rr * Math.cos(a) * sx, cy + rr * Math.sin(a)]);
  }
  return pts;
}

interface Seg {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

/** Closed Catmull-Rom spline as cubic Bezier segments. */
function smoothClosed(pts: Pt[]): { d: string; segs: Seg[] } {
  const n = pts.length;
  const segs: Seg[] = [];
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const e = pts[(i + 2) % n];
    const c1: Pt = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6];
    const c2: Pt = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
    d += `C${P(c1)} ${P(c2)} ${P(c)}`;
    segs.push({ p0: b, c1, c2, p3: c });
  }
  return { d: `${d}Z`, segs };
}

const polygonD = (pts: Pt[]): string => `M${pts.map(P).join('L')}Z`;

/** Fourier chain used by the hero diagram and the feature card (frequency k, radius r, phase). */
const EPI: { k: number; r: number; ph: number }[] = [
  { k: 1, r: 42, ph: -Math.PI / 2 },
  { k: -2, r: 19, ph: 0.6 },
  { k: 3, r: 9, ph: 2.1 },
];

function epiPoint(t: number, scale = 1): Pt {
  let x = 0;
  let y = 0;
  for (const c of EPI) {
    x += c.r * scale * Math.cos(c.k * t + c.ph);
    y += c.r * scale * Math.sin(c.k * t + c.ph);
  }
  return [x, y];
}

function epiPath(cx: number, cy: number, scale = 1, steps = 180): string {
  const pts: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const [x, y] = epiPoint((i / steps) * Math.PI * 2, scale);
    pts.push([cx + x, cy + y]);
  }
  return polygonD(pts);
}

/* ================================================================ data */

interface ModeInfo {
  id: Mode;
  label: string;
  icon: IconName;
  role: string;
  sample: 'image' | 'video';
  details: [string, string, IconName][];
  eq: () => Child[];
}

const EXPORTS: [string, string, IconName] = ['Exports', 'Bookmarklet, snippet, JSON, LaTeX', 'download'];

const MODES: ModeInfo[] = [
  {
    id: 'outline',
    label: 'Outline',
    icon: 'bezier',
    role: 'Cubic Bezier curves',
    sample: 'image',
    details: [
      ['Draws', 'Edges as smooth strokes', 'pen'],
      ['Fitted with', 'Least-squares cubic Beziers', 'bezier'],
      ['Good for', 'Line art, logos and text', 'sparkle'],
      EXPORTS,
    ],
    eq: () => ['B(t) = (1-t)', sup('3'), 'P', sub('0'), ' + 3(1-t)', sup('2'), 'tP', sub('1'), ' + 3(1-t)t', sup('2'), 'P', sub('2'), ' + t', sup('3'), 'P', sub('3')],
  },
  {
    id: 'fill',
    label: 'Fill',
    icon: 'fill',
    role: 'Filled polygons',
    sample: 'image',
    details: [
      ['Draws', 'Dark regions as solid shapes', 'fill'],
      ['Built from', 'Closed contour polygons', 'layers'],
      ['Good for', 'Silhouettes and bold graphics', 'contrast'],
      EXPORTS,
    ],
    eq: () => ['polygon(P', sub('1'), ', P', sub('2'), ', ..., P', sub('n'), ')'],
  },
  {
    id: 'fourier',
    label: 'Fourier',
    icon: 'wave',
    role: 'Rotating circles',
    sample: 'image',
    details: [
      ['Draws', 'Each outline as one closed path', 'wave'],
      ['Built from', 'A Fourier series per path', 'refresh'],
      ['Good for', 'Outlines you want to animate', 'play'],
      EXPORTS,
    ],
    eq: () => ['z(t) = c', sub('0'), ' + c', sub('1'), 'e', sup('it'), ' + c', sub('-1'), 'e', sup('-it'), ' + c', sub('2'), 'e', sup('2it'), ' + ...'],
  },
  {
    id: 'video',
    label: 'Video',
    icon: 'film',
    role: 'Every frame in one graph',
    sample: 'video',
    details: [
      ['Draws', 'Every frame of a short clip', 'film'],
      ['Built from', 'Curves per frame plus a slider', 'sliders'],
      ['Plays with', 'A Desmos ticker', 'play'],
      EXPORTS,
    ],
    eq: () => ['F = 1, 2, ..., N', el('span', { class: 'eq-note' }, '  (a ticker steps F)')],
  },
];

const FORMATS: { name: string; note: string; icon: IconName; href?: string }[] = [
  { name: 'PNG', note: 'Image', icon: 'image' },
  { name: 'JPG', note: 'Image', icon: 'image' },
  { name: 'WebP', note: 'Image', icon: 'image' },
  { name: 'GIF', note: 'First frame', icon: 'frame' },
  { name: 'BMP', note: 'Image', icon: 'image' },
  { name: 'MP4', note: 'Video', icon: 'film' },
  { name: 'WebM', note: 'Video', icon: 'film' },
  { name: 'MOV', note: 'Video', icon: 'film' },
  { name: 'Webcam', note: 'Live input', icon: 'webcam', href: '#/live' },
  { name: 'Desmos JSON', note: 'Export', icon: 'braces' },
];

const FAQ_DATA: FaqCategory[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'help',
    items: [
      {
        q: 'Is it free?',
        a: 'Yes. There is no account, no watermark and no paywall, and the code is open source on GitHub.',
      },
      {
        q: 'Are my files uploaded?',
        a: 'No. Decoding, tracing and fitting all happen locally in your browser, so the image or video itself never leaves your device. When you paste into desmos.com, only the finished equations go there.',
      },
      {
        q: 'Why black and white?',
        a: 'Desmos draws curves, not pixels. Splitting each image into ink and paper gives clean outlines that become a manageable number of equations. Colour would multiply that count.',
      },
      {
        q: 'Is this affiliated with Desmos?',
        a: 'No. Media to Desmos is an independent project and is not affiliated with or endorsed by Desmos Studio PBC. It uses the public Desmos API to show your graph.',
      },
    ],
  },
  {
    id: 'export',
    label: 'Export',
    icon: 'share',
    items: [
      {
        q: 'How do I get the graph into desmos.com?',
        a: 'Open desmos.com/calculator, then use any export option: click the bookmarklet, paste the console snippet into your browser console, or copy the LaTeX lines straight into the expression list. The export panel walks you through each one.',
      },
      {
        q: 'Can I save it to my Desmos account?',
        a: 'Yes. Once the graph is on desmos.com, sign in and save it like any other graph.',
      },
      {
        q: 'Why is a big graph slow?',
        a: 'Every curve is an expression that Desmos evaluates and redraws, and a detailed image can produce thousands of them. Lower the detail or raise the simplification to get a lighter graph that stays responsive.',
      },
    ],
  },
  {
    id: 'video',
    label: 'Video',
    icon: 'film',
    items: [
      {
        q: 'How long can a video be?',
        a: 'There is no fixed limit, but every frame adds its own set of curves. Short clips at a modest frame rate work best; long ones make very large graphs.',
      },
      {
        q: 'Why does playback stutter on huge graphs?',
        a: 'Desmos redraws every visible curve each time the ticker advances. When one frame holds many curves, a redraw takes longer than a tick, so frames get skipped. Fewer curves per frame play more smoothly.',
      },
      {
        q: 'Is audio kept?',
        a: 'No. A Desmos graph has no sound, so only the picture is converted.',
      },
    ],
  },
];

/* ================================================================ hero diagrams (on white graph paper) */

function diagramOutline(): SVGSVGElement {
  const { d, segs } = smoothClosed(blob(200, 128, 76, 9, 0.2, 1.22));
  const shown = [segs[0], segs[3], segs[6]];
  return art(
    '0 0 400 250',
    'gp-diagram',
    S('path', { d, class: 'd-ink', 'stroke-width': 2.5 }),
    ...shown.map((s) => S('path', { d: `M${P(s.p0)}L${P(s.c1)}M${P(s.p3)}L${P(s.c2)}`, class: 'd-handle' })),
    ...shown.flatMap((s) => [s.c1, s.c2].map((c) => S('circle', { cx: r2(c[0]), cy: r2(c[1]), r: 3.6, class: 'd-ctrl' }))),
    ...shown.flatMap((s) => [s.p0, s.p3].map((a) => S('rect', { x: r2(a[0] - 3.5), y: r2(a[1] - 3.5), width: 7, height: 7, rx: 1.2, class: 'd-anchor' }))),
  );
}

function diagramFill(): SVGSVGElement {
  const outer = blob(200, 126, 84, 16, 0.1, 1.25);
  const hole = blob(212, 118, 26, 8, 1.1, 1.1);
  return art(
    '0 0 400 250',
    'gp-diagram',
    S('path', { d: `${polygonD(outer)}${polygonD(hole)}`, class: 'd-solid', 'fill-rule': 'evenodd' }),
    ...outer.map((p) => S('circle', { cx: r2(p[0]), cy: r2(p[1]), r: 2.6, class: 'd-vertex' })),
  );
}

function diagramFourier(): SVGSVGElement {
  const cx = 200;
  const cy = 125;
  const sc = 1.25;
  const t = 0.9;
  const kids: Child[] = [S('path', { d: epiPath(cx, cy, sc), class: 'd-ink', 'stroke-width': 2.25 })];
  let x = cx;
  let y = cy;
  for (const c of EPI) {
    const nx = x + c.r * sc * Math.cos(c.k * t + c.ph);
    const ny = y + c.r * sc * Math.sin(c.k * t + c.ph);
    kids.push(S('circle', { cx: r2(x), cy: r2(y), r: r2(c.r * sc), class: 'd-orbit' }));
    kids.push(S('path', { d: `M${r2(x)} ${r2(y)}L${r2(nx)} ${r2(ny)}`, class: 'd-arm' }));
    kids.push(S('circle', { cx: r2(x), cy: r2(y), r: 2, class: 'd-pivot' }));
    x = nx;
    y = ny;
  }
  kids.push(S('circle', { cx: r2(x), cy: r2(y), r: 4.5, class: 'd-pen' }));
  return art('0 0 400 250', 'gp-diagram', ...kids);
}

function diagramVideo(): SVGSVGElement {
  const frames = [0, 1, 2].map((i) => {
    const x = 46 + i * 108;
    const shape = smoothClosed(blob(x + 50, 92 - i * 6, 24, 8, i * 0.5, 1.15)).d;
    return S(
      'g',
      null,
      S('rect', { x, y: 50, width: 100, height: 84, rx: 6, class: i === 1 ? 'd-frame is-on' : 'd-frame' }),
      S('path', { d: shape, class: 'd-ink', 'stroke-width': 2 }),
      S('text', { x: x + 8, y: 126, class: 'd-label' }, `F = ${i + 1}`),
    );
  });
  return art(
    '0 0 400 250',
    'gp-diagram',
    ...frames,
    S('path', { d: 'M62 186H338', class: 'd-track' }),
    S('path', { d: 'M62 186H200', class: 'd-track-on' }),
    S('circle', { cx: 200, cy: 186, r: 7, class: 'd-thumb' }),
    S('text', { x: 62, y: 210, class: 'd-label' }, 'F'),
  );
}

function diagram(mode: Mode): SVGSVGElement {
  if (mode === 'fill') return diagramFill();
  if (mode === 'fourier') return diagramFourier();
  if (mode === 'video') return diagramVideo();
  return diagramOutline();
}

/* ================================================================ hero */

interface CardParts {
  card: HTMLElement;
  body: HTMLElement;
  paper: HTMLElement;
}

function modeCard(m: ModeInfo, ctx: HomeContext): CardParts {
  const paper = el(
    'div',
    { class: 'graph-paper is-loading', attrs: { role: 'img', 'aria-label': `${m.label} style preview` } },
    el('div', { class: 'gp-art' }, diagram(m.id)),
    el('span', { class: 'gp-status' }, icon('spinner', { size: 12 }), 'Tracing a sample'),
  );

  const head = el(
    'div',
    { class: 'scard-head' },
    el('span', { class: 'scard-diamond' }),
    el('span', { class: 'scard-name' }, m.label),
    el('span', { class: 'scard-dot', attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: 'scard-role' }, m.role),
  );

  const side = el(
    'div',
    { class: 'scard-side' },
    el(
      'div',
      { class: 'scard-id' },
      el('span', { class: 'scard-avatar' }, icon(m.icon, { size: 20 })),
      el('div', { class: 'scard-id-text' }, el('p', { class: 'scard-title' }, m.label), el('p', { class: 'scard-sub' }, m.role)),
    ),
    el(
      'div',
      { class: 'scard-actions' },
      el('a', { class: 'mini-btn', href: '#/convert' }, icon('upload', { size: 14 }), el('span', null, 'Convert a file')),
      el(
        'button',
        { class: 'mini-btn', type: 'button', on: { click: () => ctx.trySample(m.sample) } },
        icon('play', { size: 14 }),
        el('span', null, m.sample === 'video' ? 'Try a sample clip' : 'Try a sample'),
      ),
    ),
    el(
      'div',
      { class: 'scard-details' },
      el('p', { class: 'scard-label' }, icon('list', { size: 14 }), 'Details'),
      ...m.details.map(([k, v, ic]) =>
        el('div', { class: 'detail-row' }, el('span', { class: 'detail-key' }, icon(ic, { size: 14 }), k), el('span', { class: 'detail-val' }, v)),
      ),
    ),
  );

  const mainCol = el(
    'div',
    { class: 'scard-main' },
    el('p', { class: 'scard-section' }, icon('eye', { size: 14 }), 'Preview'),
    paper,
    el(
      'div',
      { class: 'scard-eq' },
      el('p', { class: 'scard-label' }, icon('braces', { size: 14 }), 'Equation'),
      el('code', { class: 'scard-eq-code' }, ...m.eq()),
    ),
  );

  const body = el('div', { class: 'scard-body' }, side, mainCol);
  const card = el('article', { class: 'scard', dataset: { mode: m.id }, attrs: { 'aria-label': `${m.label}: ${m.role}` } }, head, body);
  return { card, body, paper };
}

async function loadPreview(paper: HTMLElement, mode: Mode, ctx: HomeContext, alive: () => boolean): Promise<void> {
  let svg: SVGSVGElement | null = null;
  try {
    svg = await ctx.samplePreview(mode);
  } catch (err) {
    console.warn(`samplePreview(${mode}) failed`, err);
  }
  if (!alive()) return;
  paper.classList.remove('is-loading');
  paper.querySelector('.gp-status')?.remove();
  if (svg) {
    svg.classList.add('gp-svg');
    svg.setAttribute('aria-hidden', 'true');
    paper.querySelector('.gp-art')?.replaceWith(el('div', { class: 'gp-art is-real' }, svg));
    paper.dataset.state = 'real';
  } else {
    paper.dataset.state = 'diagram';
    paper.append(el('span', { class: 'gp-tag' }, 'Diagram'));
  }
}

function heroStage(ctx: HomeContext, alive: () => boolean): HTMLElement {
  const parts = MODES.map((m) => modeCard(m, ctx));
  const started = new Set<number>();
  const load = (i: number): Promise<void> => {
    if (started.has(i)) return Promise.resolve();
    started.add(i);
    return loadPreview(parts[i].paper, MODES[i].id, ctx, alive);
  };

  let current = 0;
  const apply = (sel: number) => {
    current = sel;
    parts.forEach((p, i) => {
      const depth = (i - sel + MODES.length) % MODES.length;
      p.card.style.setProperty('--d', String(depth));
      p.card.dataset.depth = String(depth);
      p.body.inert = depth !== 0;
      p.card.setAttribute('aria-hidden', String(depth !== 0));
    });
    void load(sel);
  };

  const tray = chipTray(
    MODES.map((m) => ({ value: m.id, label: m.label, icon: m.icon })),
    'outline' as Mode,
    (v) => apply(MODES.findIndex((m) => m.id === v)),
  );
  tray.el.setAttribute('aria-label', 'Drawing style');
  parts.forEach((p, i) =>
    p.card.addEventListener('click', () => {
      if (i === current) return;
      apply(i);
      tray.set(MODES[i].id);
    }),
  );
  apply(0);

  // Warm the remaining previews one at a time after the first.
  void (async () => {
    for (let i = 0; i < MODES.length; i++) {
      if (!alive()) return;
      await load(i);
    }
  })();

  return el(
    'div',
    { class: 'hero-stage' },
    el('div', { class: 'stack' }, ...parts.map((p) => p.card)),
    el('div', { class: 'stack-tray' }, tray.el),
    el(
      'p',
      { class: 'showcase-credit' },
      'Showcase traced with Media to Desmos from Waguri in The Fragrant Flower Blooms with Dignity (Saka Mikami / Kodansha). Only the traced equations are shown here.',
    ),
  );
}

/* ================================================================ before / after */

function compareSection(ctx: HomeContext, alive: () => boolean): HTMLElement | null {
  if (!ctx.compareExamples) return null;
  const titleId = uid('cmp-title');
  const grid = el('div', { class: 'compare-grid', dataset: { reveal: '' } });
  const section = el(
    'section',
    { class: 'home-section compare-section', id: 'compare', attrs: { 'aria-labelledby': titleId } },
    el(
      'div',
      { class: 'home-inner', dataset: { reveal: '' } },
      sectionHead({
        title: 'See the difference.',
        lead: 'Drag the handle to compare an original with its Desmos drawing. These examples are drawn and traced by the site itself.',
        id: titleId,
      }),
    ),
    grid,
  );
  void ctx.compareExamples().then(
    (examples) => {
      if (!alive()) return;
      for (const ex of examples) {
        const cmp = compareSlider({ before: ex.before, after: ex.after, label: ex.title, aspect: ex.aspect, start: 52 });
        grid.appendChild(el('div', { class: 'compare-card' }, cmp.el, el('h3', null, ex.title), el('p', null, ex.body)));
      }
    },
    () => section.remove(),
  );
  return section;
}

function heroSection(ctx: HomeContext, alive: () => boolean): HTMLElement {
  const drop = dropZone({
    accept: 'image/*,video/*',
    title: 'Drop a PNG or MP4 here',
    subtitle: 'or click to browse. Pasting an image works too.',
    onFile: (f) => ctx.openFile(f),
    compact: true,
  });
  const titleId = uid('hero-title');
  return el(
    'section',
    { class: 'hero', attrs: { 'aria-labelledby': titleId } },
    el(
      'div',
      { class: 'hero-copy' },
      badge('Free, runs entirely in your browser', { icon: 'sparkle' }),
      el(
        'h1',
        { class: 'h1 hero-title', id: titleId },
        el('span', { class: 'nowrap' }, 'Any image.'),
        ' ',
        el('span', { class: 'nowrap' }, 'Any video.'),
        ' ',
        el('span', { class: 'nowrap' }, 'One Desmos graph.'),
      ),
      el(
        'p',
        { class: 'lead hero-lead' },
        'Media to Desmos traces PNGs and MP4s to equations that even you can use on any desmos graph! Created by ',
        el('u', null, 'Xiaole Zhang'),
        '.',
      ),
      el(
        'div',
        { class: 'hero-ctas' },
        button({ label: 'Convert a file', href: '#/convert', size: 'lg' }),
        button({ label: 'Try a sample', variant: 'outline', size: 'lg', onClick: () => ctx.trySample('image') }),
      ),
      el('div', { class: 'hero-drop' }, drop),
    ),
    heroStage(ctx, alive),
  );
}

/* ================================================================ formats */

function formatsSection(): HTMLElement {
  const cells = FORMATS.map((f) => {
    const kids: Child[] = [el('span', { class: 'fmt-name' }, icon(f.icon, { size: 16 }), f.name), el('span', { class: 'fmt-note' }, f.note)];
    return f.href ? el('a', { class: 'fmt is-link', href: f.href }, ...kids) : el('div', { class: 'fmt' }, ...kids);
  });
  const cloud = el('div', { class: 'format-cloud', attrs: { role: 'list', 'aria-label': 'Supported inputs and outputs' } }, ...cells);
  cells.forEach((c) => c.setAttribute('role', 'listitem'));
  const wrap = el('div', { class: 'format-wrap', dataset: { reveal: '' } }, cloud);
  crosshairs(wrap);
  return el(
    'section',
    { class: 'home-section formats-section', attrs: { 'aria-label': 'Supported formats' } },
    el('div', { class: 'home-inner' }, el('p', { class: 'overline formats-overline' }, 'Inputs and outputs'), wrap),
  );
}

/* ================================================================ how it works */

function artAnalyze(): SVGSVGElement {
  const n = 24;
  const x0 = 18;
  const w = 6.5;
  const gap = 2.25;
  const base = 116;
  const thr = 11;
  const bars: Child[] = [];
  for (let i = 0; i < n; i++) {
    const h = 6 + 62 * Math.exp(-((i - 5) ** 2) / 9) + 44 * Math.exp(-((i - 17) ** 2) / 11);
    bars.push(S('rect', { x: r2(x0 + i * (w + gap)), y: r2(base - h), width: w, height: r2(h), rx: 1.5, class: i < thr ? 'a-bar is-ink' : 'a-bar' }));
  }
  const tx = r2(x0 + thr * (w + gap) - gap / 2);
  return art(
    '0 0 240 150',
    'art-analyze',
    S('path', { d: `M12 ${base + 0.5}H228`, class: 'a-axis' }),
    ...bars,
    S('path', { d: `M${tx} 26V${base}`, class: 'a-thresh' }),
    S('rect', { x: tx - 21, y: 8, width: 42, height: 16, rx: 8, class: 'a-tag' }),
    S('text', { x: tx, y: 19.5, class: 'a-tag-text', 'text-anchor': 'middle' }, 'Otsu'),
    S('text', { x: 14, y: 136, class: 'a-label' }, 'ink'),
    S('text', { x: 226, y: 136, class: 'a-label', 'text-anchor': 'end' }, 'paper'),
  );
}

const TRACE_MASK = [
  '0000000000000',
  '0001110000000',
  '0011111001100',
  '0111111111110',
  '0111111111110',
  '0011110111100',
  '0001100011000',
  '0000000000000',
].map((row) => row.split('').map(Number));

/** Marching squares over a binary grid, sampled at cell centres. */
function marchingSquares(g: number[][], cell: number, ox: number, oy: number): string {
  const R = g.length;
  const C = g[0].length;
  const at = (r: number, c: number) => (r >= 0 && r < R && c >= 0 && c < C ? g[r][c] : 0);
  let d = '';
  for (let r = -1; r < R; r++) {
    for (let c = -1; c < C; c++) {
      const idx = at(r, c) * 8 + at(r, c + 1) * 4 + at(r + 1, c + 1) * 2 + at(r + 1, c);
      if (idx === 0 || idx === 15) continue;
      const x = ox + (c + 0.5) * cell;
      const y = oy + (r + 0.5) * cell;
      const h = cell / 2;
      const T: Pt = [x + h, y];
      const Rt: Pt = [x + cell, y + h];
      const B: Pt = [x + h, y + cell];
      const L: Pt = [x, y + h];
      const seg = (a: Pt, b: Pt) => {
        d += `M${P(a)}L${P(b)}`;
      };
      switch (idx) {
        case 1:
        case 14:
          seg(L, B);
          break;
        case 2:
        case 13:
          seg(B, Rt);
          break;
        case 3:
        case 12:
          seg(L, Rt);
          break;
        case 4:
        case 11:
          seg(T, Rt);
          break;
        case 5:
          seg(L, T);
          seg(B, Rt);
          break;
        case 6:
        case 9:
          seg(T, B);
          break;
        case 7:
        case 8:
          seg(L, T);
          break;
        case 10:
          seg(T, Rt);
          seg(L, B);
          break;
      }
    }
  }
  return d;
}

function artTrace(): SVGSVGElement {
  const cell = 14;
  const ox = 29;
  const oy = 19;
  const dots: Child[] = [];
  TRACE_MASK.forEach((row, r) =>
    row.forEach((v, c) => dots.push(S('circle', { cx: ox + (c + 0.5) * cell, cy: oy + (r + 0.5) * cell, r: 1.9, class: v ? 't-in' : 't-out' }))),
  );
  return art('0 0 240 150', 'art-trace', ...dots, S('path', { d: marchingSquares(TRACE_MASK, cell, ox, oy), class: 't-line' }));
}

function artFit(): SVGSVGElement {
  const p0: Pt = [24, 112];
  const c1: Pt = [72, 18];
  const c2: Pt = [158, 142];
  const p3: Pt = [216, 44];
  const at = (t: number): Pt => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
    ];
  };
  const jitter = [1.8, -1.6, 2.4, -2.1, 0.8, -1.7, 2.2, -0.9, 1.5, -2.4, 1, -1.2, 1.8, -0.6, 0.5];
  const samples = jitter.map((j, i) => {
    const [x, y] = at(i / (jitter.length - 1));
    return S('circle', { cx: r2(x), cy: r2(y + j * 2.2), r: 2.3, class: 'f-pt' });
  });
  return art(
    '0 0 240 150',
    'art-fit',
    ...samples,
    S('path', { d: `M${P(p0)}C${P(c1)} ${P(c2)} ${P(p3)}`, class: 'f-curve' }),
    S('path', { d: `M${P(p0)}L${P(c1)}M${P(p3)}L${P(c2)}`, class: 'f-handle' }),
    S('circle', { cx: c1[0], cy: c1[1], r: 4, class: 'f-ctrl' }),
    S('circle', { cx: c2[0], cy: c2[1], r: 4, class: 'f-ctrl' }),
    S('rect', { x: p0[0] - 3.5, y: p0[1] - 3.5, width: 7, height: 7, rx: 1.2, class: 'f-anchor' }),
    S('rect', { x: p3[0] - 3.5, y: p3[1] - 3.5, width: 7, height: 7, rx: 1.2, class: 'f-anchor' }),
  );
}

function artPaste(): HTMLElement {
  const rows: Child[][] = [
    ['B', sub('1'), '(t) = ((1-t)', sup('3'), 'x', sub('0'), ' + ...'],
    ['polygon(P', sub('1'), ', ..., P', sub('n'), ')'],
    ['X', sub('1'), ' = [0.12, 0.48, 0.91, ...]'],
  ];
  return el(
    'div',
    { class: 'art art-paste', attrs: { 'aria-hidden': 'true' } },
    el('div', { class: 'pa-bar' }, el('span', { class: 'pa-chip' }, icon('bookmark', { size: 12 }), 'Media to Desmos')),
    el(
      'div',
      { class: 'pa-list' },
      ...rows.map((r, i) => el('div', { class: 'pa-row' }, el('span', { class: 'pa-num' }, String(i + 1)), el('span', { class: 'pa-tex' }, ...r))),
    ),
  );
}

function howSection(): HTMLElement {
  const steps: { n: string; icon: IconName; title: string; body: string; art: Element }[] = [
    {
      n: '01',
      icon: 'contrast',
      title: 'Analyze',
      body: 'Reads the luminance of every pixel, builds a histogram and picks an automatic Otsu threshold between ink and paper.',
      art: artAnalyze(),
    },
    {
      n: '02',
      icon: 'scan',
      title: 'Trace',
      body: 'Finds edges with Canny edge detection, or walks filled regions into closed contours with marching squares.',
      art: artTrace(),
    },
    {
      n: '03',
      icon: 'bezier',
      title: 'Fit',
      body: 'Fits least-squares cubic Bezier curves, polygons or a Fourier series to every contour it finds.',
      art: artFit(),
    },
    {
      n: '04',
      icon: 'copy',
      title: 'Paste',
      body: 'Gets it into Desmos with a one-click bookmarklet, a console snippet, a JSON file or plain LaTeX lines.',
      art: artPaste(),
    },
  ];
  const titleId = uid('how-title');
  return el(
    'section',
    { class: 'home-section how-section', id: 'how', attrs: { 'aria-labelledby': titleId } },
    el(
      'div',
      { class: 'home-inner', dataset: { reveal: '' } },
      sectionHead({ title: 'From pixels to equations.', lead: 'Four steps, all running on your device.', id: titleId }),
    ),
    el(
      'ol',
      { class: 'steps', attrs: { role: 'list' }, dataset: { reveal: '' } },
      ...steps.map((s) =>
        el(
          'li',
          { class: 'step' },
          el('div', { class: 'step-art' }, s.art),
          el(
            'div',
            { class: 'step-text' },
            el('p', { class: 'step-num' }, s.n),
            el('h3', { class: 'step-title' }, icon(s.icon, { size: 16 }), s.title),
            el('p', { class: 'step-body' }, s.body),
          ),
        ),
      ),
    ),
  );
}

/* ================================================================ features */

function miniPaper(...kids: Child[]): HTMLElement {
  return el('div', { class: 'mini-paper' }, ...kids);
}

function artInspector(): HTMLElement {
  const strokes = [
    { d: 'M14 88L48 42L70 64L92 40L146 88', label: 'B', n: '1', note: 'ridge' },
    { d: 'M120 22a11 11 0 1 0 .01 0', label: 'B', n: '2', note: 'sun' },
    { d: 'M10 98C50 90 104 106 150 96', label: 'B', n: '3', note: 'ground' },
  ];
  return el(
    'div',
    { class: 'art art-inspector', attrs: { 'aria-hidden': 'true' } },
    miniPaper(art('0 0 160 110', 'ins-svg', ...strokes.map((s, i) => S('path', { d: s.d, class: `ins-stroke k${i + 1}` })))),
    el(
      'div',
      { class: 'ins-list' },
      ...strokes.map((s, i) =>
        el(
          'div',
          { class: `ins-row k${i + 1}` },
          el('span', { class: 'ins-swatch' }),
          el('span', { class: 'ins-tex' }, s.label, sub(s.n), '(t)'),
          el('span', { class: 'ins-note' }, s.note),
        ),
      ),
    ),
  );
}

function artMassPaste(): HTMLElement {
  const lists = [
    ['List 1', 100],
    ['List 2', 100],
    ['List 3', 42],
  ] as const;
  return el(
    'div',
    { class: 'art art-mass', attrs: { 'aria-hidden': 'true' } },
    el('p', { class: 'mass-head' }, icon('layers', { size: 14 }), 'Chunked under the 10,000 limit'),
    ...lists.map(([name, pct]) =>
      el('div', { class: 'mass-row' }, el('span', { class: 'mass-name' }, name), el('span', { class: 'mass-bar' }, el('span', { style: `width:${pct}%` }))),
    ),
    el('span', { class: 'mass-btn' }, icon('copy', { size: 12 }), 'Paste all'),
  );
}

function artVideo(): HTMLElement {
  const frames = [0, 1, 2, 3].map((i) =>
    el(
      'span',
      { class: `vid-frame f${i + 1}` },
      art('0 0 60 44', 'vid-svg', S('path', { d: smoothClosed(blob(30 + (i - 1.5) * 4, 23 - Math.abs(i - 1.5) * 3, 11, 7, i * 0.7, 1.15)).d, class: 'vid-ink' })),
    ),
  );
  return el(
    'div',
    { class: 'art art-video', attrs: { 'aria-hidden': 'true' } },
    el('div', { class: 'vid-strip' }, ...frames),
    el(
      'div',
      { class: 'vid-ctrl' },
      el('span', { class: 'vid-play' }, icon('play', { size: 12 })),
      el('span', { class: 'vid-track' }, el('span', { class: 'vid-thumb' })),
      el('span', { class: 'vid-f' }, 'F'),
    ),
  );
}

function artFourier(): SVGSVGElement {
  const sc = 0.9;
  const cx = 110;
  const cy = 76;
  const T = 12;
  // Nested groups: each circle rotates relative to its parent at (k - kParent) turns per period.
  let inner: Child = S('circle', { cx: 0, cy: 0, r: 3.2, class: 'fo-pen' });
  for (let i = EPI.length - 1; i >= 0; i--) {
    const c = EPI[i];
    const parentK = i === 0 ? 0 : EPI[i - 1].k;
    const parentPh = i === 0 ? 0 : EPI[i - 1].ph;
    const rel = c.k - parentK;
    const a0 = ((c.ph - parentPh) * 180) / Math.PI;
    const r = r2(c.r * sc);
    inner = S(
      'g',
      {
        class: 'fo-spin',
        style: `--a0:${r2(a0)}deg;--turn:${rel > 0 ? 360 : -360}deg;--dur:${r2(T / Math.abs(rel))}s`,
      },
      S('circle', { cx: 0, cy: 0, r, class: 'fo-orbit' }),
      S('path', { d: `M0 0H${r}`, class: 'fo-arm' }),
      S('circle', { cx: 0, cy: 0, r: 1.6, class: 'fo-pivot' }),
      S('g', { transform: `translate(${r} 0)` }, inner),
    );
  }
  return art('0 0 220 152', 'art-fourier', S('path', { d: epiPath(cx, cy, sc), class: 'fo-path' }), S('g', { transform: `translate(${cx} ${cy})` }, inner));
}

function artWebcam(): HTMLElement {
  const doodle = 'M40 18C52 18 58 30 52 38S34 44 30 34 38 20 46 24 50 34 42 34';
  return el(
    'div',
    { class: 'art art-webcam', attrs: { 'aria-hidden': 'true' } },
    el('span', { class: 'cam-live' }, el('span', { class: 'cam-dot' }), 'Live'),
    art(
      '0 0 120 80',
      'cam-svg',
      S('path', { d: 'M8 20V12a4 4 0 0 1 4-4h8M100 8h8a4 4 0 0 1 4 4v8M112 60v8a4 4 0 0 1-4 4h-8M20 72h-8a4 4 0 0 1-4-4v-8', class: 'cam-corner' }),
      S('rect', { x: 30, y: 14, width: 60, height: 50, rx: 3, class: 'cam-paper', transform: 'rotate(-4 60 39)' }),
      S('path', { d: doodle, class: 'cam-ink', transform: 'translate(14 2)' }),
      S('path', { d: doodle, class: 'cam-trace', transform: 'translate(14 2)', pathLength: 100 }),
    ),
  );
}

function artProjects(): HTMLElement {
  const items: [string, string, IconName][] = [
    ['Cat sketch', 'Outline', 'bezier'],
    ['Logo', 'Fill', 'fill'],
    ['Bouncing ball', 'Video', 'film'],
  ];
  return el(
    'div',
    { class: 'art art-projects', attrs: { 'aria-hidden': 'true' } },
    ...items.map(([name, mode, ic], i) =>
      el(
        'div',
        { class: `proj-row${i === 0 ? ' is-on' : ''}` },
        el('span', { class: 'proj-icon' }, icon(ic, { size: 14 })),
        el('span', { class: 'proj-name' }, name),
        el('span', { class: 'proj-mode' }, mode),
      ),
    ),
    el('div', { class: 'proj-link' }, icon('link', { size: 12 }), el('span', null, 'Share link'), el('span', { class: 'proj-copy' }, icon('copy', { size: 12 }))),
  );
}

function featuresSection(): HTMLElement {
  const feats: { title: string; body: string; art: Element }[] = [
    {
      title: 'Every equation explained',
      body: 'The inspector lists each equation and highlights the stroke it draws, so you always know which line is which.',
      art: artInspector(),
    },
    {
      title: 'Mass paste into Desmos',
      body: 'Send every equation to desmos.com in one go. Long lists are split to stay under the Desmos list limit.',
      art: artMassPaste(),
    },
    {
      title: 'A whole video in one graph',
      body: 'Each frame gets its own curves. A slider picks the frame and a ticker plays them back.',
      art: artVideo(),
    },
    {
      title: 'Fourier mode',
      body: 'Redraw any outline with a chain of rotating circles, computed from a Fourier series of the path.',
      art: artFourier(),
    },
    {
      title: 'Live webcam',
      body: 'Point your camera at a drawing and trace it live, right in the browser.',
      art: artWebcam(),
    },
    {
      title: 'Projects and share links',
      body: 'Keep your conversions as projects and share a link that opens the same graph.',
      art: artProjects(),
    },
  ];
  const titleId = uid('feat-title');
  return el(
    'section',
    { class: 'home-section features-section', attrs: { 'aria-labelledby': titleId } },
    el(
      'div',
      { class: 'home-inner', dataset: { reveal: '' } },
      sectionHead({ title: 'More than a tracer.', lead: 'Tools for checking, exporting and animating what you trace.', id: titleId }),
    ),
    el(
      'ul',
      { class: 'features', attrs: { role: 'list' }, dataset: { reveal: '' } },
      ...feats.map((f) =>
        el(
          'li',
          { class: 'feature' },
          el('div', { class: 'feature-art' }, f.art),
          el('div', { class: 'feature-text' }, el('h3', { class: 'feature-title' }, f.title), el('p', { class: 'feature-body' }, f.body)),
        ),
      ),
    ),
  );
}

/* ================================================================ stats */

function statsChart(): HTMLElement {
  const gid = uid('stat-grad');
  const curve = 'M0 400C450 380 650 60 1000 0';
  return el(
    'div',
    { class: 'stats-chart', attrs: { 'aria-hidden': 'true' } },
    S(
      'svg',
      { class: 'stats-svg', viewBox: '0 0 1000 400', preserveAspectRatio: 'none', fill: 'none', attrs: { focusable: 'false' } },
      S(
        'defs',
        null,
        S(
          'linearGradient',
          { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
          S('stop', { offset: '0%', 'stop-color': '#3b82f6', 'stop-opacity': 0.22 }),
          S('stop', { offset: '100%', 'stop-color': '#3b82f6', 'stop-opacity': 0 }),
        ),
      ),
      S('path', { d: `${curve}L1000 400Z`, fill: `url(#${gid})` }),
      S('path', { d: 'M0 400L450 380M1000 0L650 60', class: 'sc-handle' }),
      S('path', { d: curve, class: 'sc-line' }),
    ),
    el('span', { class: 'sc-dot', style: 'left:45%;top:95%' }),
    el('span', { class: 'sc-dot', style: 'left:65%;top:15%' }),
  );
}

function statsSection(): HTMLElement {
  const titleId = uid('stats-title');
  const stats = [
    stat('Uploads. Every file stays on your device.', '0'),
    stat('Entries per list in Desmos. Bigger traces are split around it.', '10,000'),
    stat('Drawing styles: outline, fill and Fourier.', '3'),
    stat('Ways to export: bookmarklet, snippet, JSON and LaTeX.', '4'),
  ];
  return el(
    'section',
    { class: 'home-section stats-section', attrs: { 'aria-labelledby': titleId } },
    el(
      'div',
      { class: 'home-inner', dataset: { reveal: '' } },
      sectionHead({
        title: 'Built for big graphs.',
        lead: 'Desmos caps each list at 10,000 entries, so long traces are cut into chunks that each fit, then pasted together.',
        id: titleId,
      }),
    ),
    el('div', { class: 'stats-block' }, el('div', { class: 'home-inner' }, el('div', { class: 'stats-grid', dataset: { reveal: '' } }, ...stats.map((s) => s.el))), statsChart()),
  );
}

/* ================================================================ faq */

function faqSection(): HTMLElement {
  const titleId = uid('faq-title');
  return el(
    'section',
    { class: 'home-section faq-section', id: 'faq', attrs: { 'aria-labelledby': titleId } },
    el(
      'div',
      { class: 'home-inner' },
      el('div', { dataset: { reveal: '' } }, sectionHead({ title: 'Frequently asked questions.', lead: 'Quick answers about privacy, exporting and video.', id: titleId })),
      el('div', { class: 'faq-wrap' }, faq(FAQ_DATA)),
    ),
  );
}

/* ================================================================ final CTA */

function orbit(): HTMLElement {
  const rings: { size: number; dur: number; dir: 1 | -1; chips: [string, IconName][] }[] = [
    { size: 340, dur: 60, dir: 1, chips: [['PNG', 'image'], ['MP4', 'film'], ['GIF', 'frame']] },
    { size: 560, dur: 90, dir: -1, chips: [['JPG', 'image'], ['WebM', 'film'], ['Webcam', 'webcam'], ['LaTeX', 'code']] },
    { size: 780, dur: 130, dir: 1, chips: [['WebP', 'image'], ['MOV', 'film'], ['BMP', 'image'], ['JSON', 'braces'], ['Snippet', 'terminal']] },
  ];
  return el(
    'div',
    { class: 'orbit', attrs: { 'aria-hidden': 'true' } },
    ...rings.map((ring, ri) =>
      el(
        'div',
        { class: ring.dir < 0 ? 'orbit-ring is-rev' : 'orbit-ring', style: `--size:${ring.size}px;--dur:${ring.dur}s` },
        ...ring.chips.map(([label, ic], ci) => {
          const angle = (360 / ring.chips.length) * ci + ri * 23 - 90;
          return el(
            'span',
            { class: 'orbit-slot', style: `--a:${r2(angle)}deg` },
            el('span', { class: 'orbit-spin' }, el('span', { class: 'orbit-chip' }, icon(ic, { size: 14 }), label)),
          );
        }),
      ),
    ),
  );
}

function ctaSection(): HTMLElement {
  const titleId = uid('cta-title');
  return el(
    'section',
    { class: 'home-section cta-section', attrs: { 'aria-labelledby': titleId } },
    el(
      'div',
      { class: 'home-inner cta-inner', dataset: { reveal: '' } },
      el('h2', { class: 'h2 cta-title', id: titleId }, 'Drop a file. Get a graph.'),
      el('p', { class: 'lead' }, 'Free and private. Nothing to install and nothing to upload.'),
      button({ label: 'Convert a file', href: '#/convert', size: 'lg', class: 'cta-btn', iconRight: 'arrow-right' }),
    ),
    orbit(),
  );
}

/* ================================================================ reveal */

function armReveal(root: HTMLElement): () => void {
  if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') return () => {};
  root.classList.add('reveal-on');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.04 },
  );
  root.querySelectorAll('[data-reveal]').forEach((n) => io.observe(n));
  return () => io.disconnect();
}

/* ================================================================ entry */

export function renderHome(main: HTMLElement, ctx: HomeContext): () => void {
  let alive = true;
  const isAlive = () => alive;
  const root = el(
    'div',
    { class: 'home' },
    heroSection(ctx, isAlive),
    rule(),
    formatsSection(),
    hatch(),
    howSection(),
    rule(),
    compareSection(ctx, isAlive),
    ctx.compareExamples ? rule() : null,
    featuresSection(),
    hatch(),
    statsSection(),
    hatch(),
    faqSection(),
    hatch(),
    ctaSection(),
  );
  main.replaceChildren(root);
  const stopReveal = armReveal(root);
  return () => {
    alive = false;
    stopReveal();
    disposeWithin(root);
  };
}
