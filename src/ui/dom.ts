/**
 * Tiny DOM helpers shared by every screen and component.
 *
 *   el('button', { class: 'btn btn-primary', on: { click: go } }, 'Convert')
 *   svgEl('path', { d: 'M4 12h16' })
 */

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Props {
  class?: string;
  /** Inline style: a CSS string or an object of camelCase properties. */
  style?: string | Partial<CSSStyleDeclaration>;
  /** Event listeners, e.g. { click: fn, input: fn }. */
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
  /** data-* attributes (camelCase keys become data-kebab). */
  dataset?: Record<string, string | number | boolean>;
  /** Plain attributes set with setAttribute (aria-*, role, for, etc.). */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** Any other DOM property (type, value, href, title, disabled, hidden, tabIndex, ...). */
  [prop: string]: unknown;
}

const RESERVED = new Set(['class', 'style', 'on', 'dataset', 'attrs']);

export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, ...c);
    else if (c instanceof Node) parent.appendChild(c);
    else parent.appendChild(document.createTextNode(String(c)));
  }
}

function applyProps(node: HTMLElement | SVGElement, props: Props | undefined, isSvg: boolean): void {
  if (!props) return;
  if (props.class) node.setAttribute('class', props.class);
  if (props.style) {
    if (typeof props.style === 'string') node.setAttribute('style', props.style);
    else Object.assign((node as HTMLElement).style, props.style);
  }
  if (props.on) {
    for (const [type, fn] of Object.entries(props.on)) {
      if (fn) node.addEventListener(type, fn as EventListener);
    }
  }
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) (node as HTMLElement).dataset[k] = String(v);
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === null || v === undefined || v === false) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (RESERVED.has(k) || v === undefined) continue;
    if (isSvg) node.setAttribute(k, String(v));
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
}

/** Create an HTML element with props and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyProps(node, props ?? undefined, false);
  append(node, ...children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. Every prop except class/style/on/dataset/attrs becomes an attribute. */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props ?? undefined, true);
  append(node, ...children);
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace all children of `node`. */
export function mount(node: Node, ...children: Child[]): void {
  clear(node);
  append(node, ...children);
}

export function $(selector: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector(selector);
}

/** Format a number with thin grouping, e.g. 12345 -> "12,345". */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
