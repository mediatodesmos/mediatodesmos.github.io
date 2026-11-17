/**
 * Hand-drawn icon set: 24-unit grid, 1.75 stroke, round caps and joins, currentColor.
 * No icon library and no unicode glyphs. Every mark here is our own path data.
 *
 * Shape mini-language (segments separated by "|"):
 *   "C cx cy r"          circle
 *   "R x y w h rx"       rounded rect
 *   "F:<segment>"        filled with currentColor (keeps the stroke)
 *   "O:<segment>"        faint (30% opacity), e.g. the spinner track
 *   anything else        path data
 */

import { svgEl } from './dom';

export type IconName =
  | 'upload' | 'image' | 'video' | 'camera' | 'play' | 'pause' | 'stop' | 'step-back' | 'step-forward'
  | 'copy' | 'check' | 'download' | 'share' | 'link' | 'trash' | 'eye' | 'eye-off' | 'layers' | 'sliders'
  | 'settings' | 'info' | 'help' | 'alert' | 'x' | 'plus' | 'minus' | 'chevron-down' | 'chevron-up'
  | 'chevron-left' | 'chevron-right' | 'arrow-right' | 'arrow-up-right' | 'menu' | 'external' | 'sparkle'
  | 'wave' | 'pen' | 'fill' | 'bezier' | 'folder' | 'grid' | 'list' | 'terminal' | 'code' | 'bookmark'
  | 'refresh' | 'crosshair' | 'maximize' | 'zoom-fit' | 'github' | 'clock' | 'film' | 'frame' | 'save'
  | 'gallery' | 'contrast' | 'target' | 'search' | 'lock' | 'wand' | 'scan' | 'spinner'
  // extras
  | 'arrow-left' | 'braces' | 'histogram' | 'webcam'
  // round 2: accounts, theme, tour, BETA tools
  | 'user' | 'log-in' | 'log-out' | 'cloud' | 'sun' | 'moon' | 'compass' | 'crop' | 'palette' | 'axes'
  | 'compare' | 'flask' | 'mail' | 'key';

export interface IconOptions {
  size?: number;
  strokeWidth?: number;
  class?: string;
  /** When set, the icon is announced (role="img" + <title>); otherwise it is aria-hidden. */
  title?: string;
}

/** 8-tooth gear outline, generated once so the teeth are exactly regular. */
function gearPath(cx: number, cy: number, teeth: number, rOuter: number, rRoot: number, top: number, root: number): string {
  const step = (Math.PI * 2) / teeth;
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${pt(rRoot, a - (step * root) / 2)}`;
    d += `L${pt(rOuter, a - (step * top) / 2)}L${pt(rOuter, a + (step * top) / 2)}L${pt(rRoot, a + (step * root) / 2)}`;
    d += `A${rRoot} ${rRoot} 0 0 1 ${pt(rRoot, a + step - (step * root) / 2)}`;
  }
  return `${d}Z`;
}

const TRAY = 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3';

const ICONS: Record<IconName, string> = {
  upload: `M12 14.5V4|M7.5 8.5L12 4l4.5 4.5|${TRAY}`,
  download: `M12 4v10.5|M7.5 10L12 14.5 16.5 10|${TRAY}`,
  image:
    'R 3 4 18 16 2.5|C 8.5 8.75 1.75|M3 17l5.15-5.15a1.6 1.6 0 0 1 2.26 0L18.5 20|M14 15.5l1.85-1.85a1.6 1.6 0 0 1 2.26 0L21 16.5',
  video: 'R 2.5 6 13 12 2.5|M15.5 10.25l4.75-2.9a.75.75 0 0 1 1.15.64v8.02a.75.75 0 0 1-1.15.64l-4.75-2.9',
  camera:
    'M3 9a2 2 0 0 1 2-2h2.4l1.6-2.25h6L16.6 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|C 12 13 3.5',
  play: 'M7 4.75v14.5L19.5 12z',
  pause: 'R 6 4.5 4 15 1.25|R 14 4.5 4 15 1.25',
  stop: 'R 5 5 14 14 2.5',
  'step-back': 'M6 5v14|M18.5 5.5v13L9.5 12z',
  'step-forward': 'M18 5v14|M5.5 5.5v13L14.5 12z',
  copy: 'R 8.5 8.5 12 12 2|M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5',
  check: 'M4.5 12.5l4.75 4.75L19.5 7',
  share: 'C 18 5.5 2.5|C 6 12 2.5|C 18 18.5 2.5|M8.2 10.8l7.6-4.1|M8.2 13.2l7.6 4.1',
  link: 'M9.5 7.5H7a4.5 4.5 0 0 0 0 9h2.5|M14.5 7.5H17a4.5 4.5 0 0 1 0 9h-2.5|M8.5 12h7',
  trash:
    'M4 6.5h16|M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5|M6 6.5l.9 12.1A1.5 1.5 0 0 0 8.4 20h7.2a1.5 1.5 0 0 0 1.5-1.4L18 6.5|M10 10.5v6|M14 10.5v6',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z|C 12 12 3',
  'eye-off':
    'M3.5 3.5l17 17|M10.6 5.6c.46-.07.93-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.2 3|M6.6 6.6C4 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.9 0 3.6-.6 5-1.5|M9.9 9.9a3 3 0 0 0 4.2 4.2',
  layers: 'M12 3.5l8.5 4.25L12 12 3.5 7.75z|M3.5 12L12 16.25 20.5 12|M3.5 16.25L12 20.5l8.5-4.25',
  sliders:
    'M4 6h8.5|M16.5 6H20|C 14.5 6 2|M4 12h2.5|M10.5 12H20|C 8.5 12 2|M4 18h10.5|M18.5 18H20|C 16.5 18 2',
  settings: `${gearPath(12, 12, 8, 9.5, 7.25, 0.28, 0.5)}|C 12 12 3`,
  info: 'C 12 12 9|M12 11v5.5|M12 7.75h.01',
  help: 'C 12 12 9|M9.5 9.25a2.6 2.6 0 0 1 5.05.85c0 1.75-2.55 2.35-2.55 4.15|M12 17.25h.01',
  alert:
    'M10.3 4.3L2.7 17.6A1.9 1.9 0 0 0 4.4 20.5h15.2a1.9 1.9 0 0 0 1.7-2.9L13.7 4.3a1.95 1.95 0 0 0-3.4 0z|M12 9.5v4.5|M12 17.25h.01',
  x: 'M6 6l12 12|M18 6L6 18',
  plus: 'M12 5v14|M5 12h14',
  minus: 'M5 12h14',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-right': 'M4.5 12h15|M13.5 6l6 6-6 6',
  'arrow-left': 'M19.5 12h-15|M10.5 6l-6 6 6 6',
  'arrow-up-right': 'M7 17L17 7|M8.5 7H17v8.5',
  menu: 'M4 7h16|M4 12h16|M4 17h16',
  external: 'M14 4h6v6|M20 4l-9 9|M18.5 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h4.5',
  sparkle: 'M11 5Q11.85 12.15 19 13Q11.85 13.85 11 21Q10.15 13.85 3 13Q10.15 12.15 11 5z|M19 3v4|M17 5h4',
  wave: 'M2.5 12C4.1 7.5 5.7 5.25 7.25 5.25S10.4 7.5 12 12s3.2 6.75 4.75 6.75S19.9 16.5 21.5 12',
  pen: 'M4 20l4.5-1L19.3 8.2a1.8 1.8 0 0 0 0-2.5l-1-1a1.8 1.8 0 0 0-2.5 0L5 15.5z|M14.5 6l3.5 3.5',
  fill:
    'M11 3.5l8 8-6.5 6.5a2.1 2.1 0 0 1-3 0l-5-5a2.1 2.1 0 0 1 0-3z|M4.2 11.5H19|M20.5 14.5c.9 1.2 1.5 2.2 1.5 3a1.5 1.5 0 0 1-3 0c0-.8.6-1.8 1.5-3z',
  bezier: 'M3.5 20C3.5 13.5 7.2 8.5 12 8.5s8.5 5 8.5 11.5|M8.9 8.5h6.2|C 7.2 8.5 1.7|C 16.8 8.5 1.7|F:R 10.4 6.9 3.2 3.2 .6',
  folder: 'M3.5 7a2 2 0 0 1 2-2h3.6l2 2.5h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  grid: 'R 4 4 6.5 6.5 1.5|R 13.5 4 6.5 6.5 1.5|R 4 13.5 6.5 6.5 1.5|R 13.5 13.5 6.5 6.5 1.5',
  list: 'M9 6.5h11|M9 12h11|M9 17.5h11|M4.5 6.5h.01|M4.5 12h.01|M4.5 17.5h.01',
  terminal: 'M5 7.5L9.5 12 5 16.5|M12 17h7',
  code: 'M8.5 7L3.5 12l5 5|M15.5 7l5 5-5 5',
  braces:
    'M8 4H7a2 2 0 0 0-2 2v3.5A2.5 2.5 0 0 1 2.5 12 2.5 2.5 0 0 1 5 14.5V18a2 2 0 0 0 2 2h1|M16 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5V18a2 2 0 0 1-2 2h-1',
  bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-3.75L6 20V5a1 1 0 0 1 1-1z',
  refresh: 'M4 12a8 8 0 0 1 14.9-4|M19 3.5V8h-4.5|M20 12a8 8 0 0 1-14.9 4|M5 20.5V16h4.5',
  crosshair: 'C 12 12 8|M12 2.5v4|M12 17.5v4|M2.5 12h4|M17.5 12h4',
  maximize: 'M4 9V5a1 1 0 0 1 1-1h4|M15 4h4a1 1 0 0 1 1 1v4|M20 15v4a1 1 0 0 1-1 1h-4|M9 20H5a1 1 0 0 1-1-1v-4',
  'zoom-fit':
    'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8|M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8|M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16|M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16|R 8.5 8.5 7 7 1.5',
  github:
    'M8.9 21v-3.2c0-1 .2-1.7.8-2.2-2.8-.3-5.3-1.4-5.3-5.9 0-1.2.4-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.3 11.3 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 3 .1 3.3.8.8 1.2 1.9 1.2 3.1 0 4.5-2.5 5.6-5.3 5.9.6.5.9 1.4.9 2.5V21|M8.9 18.5c-3 .9-3.9-.9-5.4-1.4',
  clock: 'C 12 12 9|M12 7v5l3.25 2',
  film: 'R 3.5 3.5 17 17 2|M7.5 3.5v17|M16.5 3.5v17|M3.5 8h4|M3.5 12h17|M3.5 16h4|M16.5 8h4|M16.5 16h4',
  frame: 'M7 3.5v17|M17 3.5v17|M3.5 7h17|M3.5 17h17',
  save:
    'M5.5 4h10.2L20 8.3v10.2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z|M8 4v4.5h7V4|M7.5 20v-5.5h9V20',
  gallery:
    'R 7.5 3.5 13 13 2|M16.5 20.5h-11a2 2 0 0 1-2-2v-11|M7.5 13.5l3.15-3.15a1.4 1.4 0 0 1 2 0l6.15 6.15|C 16 7.75 1.25',
  contrast: 'C 12 12 9|F:M12 3a9 9 0 0 1 0 18z',
  target: 'C 12 12 9|C 12 12 5.5|C 12 12 2',
  search: 'C 11 11 6.5|M20 20l-4.4-4.4',
  lock: 'R 5 10.5 14 10 2|M8 10.5V7.5a4 4 0 0 1 8 0v3|M12 14.5v2',
  wand: 'M3.5 20.5l12-12|M12.5 8.5l3 3|M19 2.75v3.5|M17.25 4.5h3.5|M20.5 11.5h.01|M10.5 3.5h.01',
  scan: 'M4 8V6a2 2 0 0 1 2-2h2|M16 4h2a2 2 0 0 1 2 2v2|M20 16v2a2 2 0 0 1-2 2h-2|M8 20H6a2 2 0 0 1-2-2v-2|M7 12h10',
  histogram: 'M3.5 19.5h17|R 5.5 12 3 5 .75|R 10.5 6 3 11 .75|R 15.5 9.5 3 7.5 .75',
  webcam: 'C 12 10 6.5|C 12 10 2.5|M8.5 21h7|M12 16.5V21',
  spinner: 'O:C 12 12 9|M12 3a9 9 0 0 1 9 9',
  // round 2
  user: 'C 12 8.5 4|M4.5 20.5a7.5 7.5 0 0 1 15 0',
  'log-in': 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4|M3.5 12h11|M10.5 7.5L15 12l-4.5 4.5',
  'log-out': 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4|M9.5 12h11|M16.5 7.5L21 12l-4.5 4.5',
  cloud: 'M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.46A3.75 3.75 0 0 1 17.5 18.5z',
  sun: 'C 12 12 4|M12 2.5v2|M12 19.5v2|M2.5 12h2|M19.5 12h2|M5.3 5.3l1.4 1.4|M17.3 17.3l1.4 1.4|M5.3 18.7l1.4-1.4|M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  compass: 'C 12 12 9|M15.5 8.5l-2 5-5 2 2-5z',
  crop: 'M6.5 2.5v13a2 2 0 0 0 2 2h13|M2.5 6.5h13a2 2 0 0 1 2 2v13',
  palette:
    'M12 3a9 9 0 0 0 0 18c1.1 0 1.75-.75 1.75-1.6 0-.45-.2-.85-.45-1.15-.25-.3-.45-.7-.45-1.15 0-.9.75-1.6 1.65-1.6H16.5A4.5 4.5 0 0 0 21 11c0-4.4-4-8-9-8z|C 7.5 11.5 1|C 10 7.25 1|C 14.5 7.25 1',
  axes: 'M5 3.5v15.5h15.5|M5 3.5L3 5.5|M5 3.5l2 2|M20.5 19l-2-2|M20.5 19l-2 2|M9 15h.01|M9 19v-1.5|M13 19v-1.5|M17 19v-1.5|M5 15h1.5|M5 11h1.5|M5 7h1.5',
  compare: 'M12 3v18|R 3.5 5 17 14 2|O:F:M12 5h6.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H12z|M8.5 10l-2 2 2 2|M15.5 10l2 2-2 2',
  flask: 'M9.5 3.5h5|M10.5 3.5v5.25L5.2 18.1A1.6 1.6 0 0 0 6.6 20.5h10.8a1.6 1.6 0 0 0 1.4-2.4L13.5 8.75V3.5|M7.75 14h8.5',
  mail: 'R 3 5.5 18 13 2|M3.5 7l8.5 6 8.5-6',
  key: 'C 8 15.5 3.5|M10.6 12.9L20 3.5|M16.5 7l2.5 2.5|M14 9.5l2 2',
};

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

function shape(seg: string): SVGElement {
  let s = seg.trim();
  let fill = false;
  let faint = false;
  for (;;) {
    if (s.startsWith('F:')) fill = true;
    else if (s.startsWith('O:')) faint = true;
    else break;
    s = s.slice(2);
  }
  let node: SVGElement;
  if (s.startsWith('C ')) {
    const [cx, cy, r] = s.slice(2).trim().split(/\s+/);
    node = svgEl('circle', { cx, cy, r });
  } else if (s.startsWith('R ')) {
    const [x, y, width, height, rx = '0'] = s.slice(2).trim().split(/\s+/);
    node = svgEl('rect', { x, y, width, height, rx });
  } else {
    node = svgEl('path', { d: s });
  }
  if (fill) node.setAttribute('fill', 'currentColor');
  if (faint) node.setAttribute('opacity', '0.3');
  return node;
}

/** An inline SVG icon. Default size 16px. */
export function icon(name: IconName, opts: IconOptions = {}): SVGSVGElement {
  const size = opts.size ?? 16;
  const classes = ['icon', `icon-${name}`];
  if (name === 'spinner') classes.push('icon-spinner');
  if (opts.class) classes.push(opts.class);
  const svg = svgEl('svg', {
    class: classes.join(' '),
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': opts.strokeWidth ?? 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    attrs: { 'aria-hidden': opts.title ? null : 'true', role: opts.title ? 'img' : null, focusable: 'false' },
  });
  if (opts.title) svg.append(svgEl('title', null, opts.title));
  for (const seg of (ICONS[name] ?? ICONS.help).split('|')) svg.append(shape(seg));
  return svg;
}

/**
 * Brand mark: a cubic Bezier easing curve (a smooth step) with both control handles,
 * the figure every curve editor draws, inside a rounded square.
 * Monochrome (currentColor); the control rings are filled with --logo-surface. 32-unit grid.
 */
export function logoMark(size = 28): SVGSVGElement {
  return svgEl(
    'svg',
    {
      class: 'logo-mark',
      width: size,
      height: size,
      viewBox: '0 0 32 32',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      attrs: { 'aria-hidden': 'true', focusable: 'false' },
    },
    svgEl('rect', { x: 1.5, y: 1.5, width: 29, height: 29, rx: 8, 'stroke-width': 1.5 }),
    svgEl('path', { d: 'M7.5 23.5H17M24.5 8.5H15', 'stroke-width': 1.25, opacity: 0.6 }),
    svgEl('path', { d: 'M7.5 23.5C17 23.5 15 8.5 24.5 8.5', 'stroke-width': 2.4 }),
    // Control points: rings filled with the surface colour so they sit on top of the lines.
    svgEl('circle', { class: 'logo-ring', cx: 17, cy: 23.5, r: 2, 'stroke-width': 1.4 }),
    svgEl('circle', { class: 'logo-ring', cx: 15, cy: 8.5, r: 2, 'stroke-width': 1.4 }),
    svgEl('rect', { x: 5.4, y: 21.4, width: 4.2, height: 4.2, rx: 1, fill: 'currentColor', stroke: 'none' }),
    svgEl('rect', { x: 22.4, y: 6.4, width: 4.2, height: 4.2, rx: 1, fill: 'currentColor', stroke: 'none' }),
  );
}

/**
 * The FAQ open/close marker: square brackets around a plus. The vertical stroke
 * (class "mk-v") collapses when an ancestor has .is-open, turning it into a minus.
 */
export function bracketMarker(): SVGSVGElement {
  return svgEl(
    'svg',
    {
      class: 'bracket-marker',
      width: 22,
      height: 16,
      viewBox: '0 0 28 20',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      attrs: { 'aria-hidden': 'true', focusable: 'false' },
    },
    svgEl('path', { d: 'M7.5 3.5H4.5v13h3' }),
    svgEl('path', { d: 'M20.5 3.5h3v13h-3' }),
    svgEl('path', { d: 'M10.5 10h7' }),
    svgEl('path', { class: 'mk-v', d: 'M14 6.5v7' }),
  );
}
