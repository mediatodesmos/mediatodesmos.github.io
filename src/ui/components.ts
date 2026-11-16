/**
 * UI kit for Media to Desmos (Vertex look). Every function returns plain DOM.
 * Importing this module also loads the token, base and component styles.
 */

import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';

import { el, svgEl, mount, prefersReducedMotion, type Child } from './dom';
import { icon, bracketMarker, type IconName } from './icons';

/* ================================================================ helpers */

let uidCounter = 0;
/** Unique DOM id with a readable prefix. */
export function uid(prefix = 'ui'): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

const disposers = new WeakMap<Element, (() => void)[]>();

/** Register teardown for a node (observers, timers). Call disposeWithin() on the screen root when leaving. */
export function onDispose(node: HTMLElement, fn: () => void): void {
  const list = disposers.get(node) ?? [];
  list.push(fn);
  disposers.set(node, list);
  node.dataset.disposable = '';
}

/** Run every teardown registered inside `root` (including root itself). */
export function disposeWithin(root: ParentNode): void {
  const nodes: Element[] = [...root.querySelectorAll('[data-disposable]')];
  if (root instanceof HTMLElement && root.dataset.disposable !== undefined) nodes.unshift(root);
  for (const n of nodes) {
    for (const fn of disposers.get(n) ?? []) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
    disposers.delete(n);
    (n as HTMLElement).removeAttribute('data-disposable');
  }
}

/** Copy text to the clipboard, falling back to execCommand. Resolves false on failure. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = el('textarea', { value: text, style: 'position:fixed;top:-1000px;left:0;opacity:0', attrs: { readonly: true } });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const EXT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  json: 'application/json',
};

/** Does `file` satisfy an <input accept> string such as "image/*,video/*,.json"? */
export function matchesAccept(file: File, accept: string): boolean {
  const rules = accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!rules.length) return true;
  const name = file.name.toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const type = (file.type || EXT_TYPES[ext] || '').toLowerCase();
  return rules.some((r) => {
    if (r.startsWith('.')) return name.endsWith(r);
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
    return type === r;
  });
}

/* ================================================================ buttons */

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'card' | 'danger';

export interface ButtonOptions {
  label?: string;
  icon?: IconName;
  iconRight?: IconName;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  disabled?: boolean;
  class?: string;
  href?: string;
  onClick?: (e: MouseEvent) => void;
}

const BTN_ICON = { sm: 14, md: 16, lg: 16 } as const;

/** Button, or <a> when `href` is given (external http links open in a new tab). */
export function button(o: ButtonOptions): HTMLButtonElement | HTMLAnchorElement {
  const size = o.size ?? 'md';
  const cls = cx('btn', `btn-${o.variant ?? 'primary'}`, `btn-${size}`, !o.label && 'btn-icon-only', o.class);
  const kids: Child[] = [
    o.icon && icon(o.icon, { size: BTN_ICON[size] }),
    o.label && el('span', { class: 'btn-label' }, o.label),
    o.iconRight && icon(o.iconRight, { size: BTN_ICON[size], class: 'btn-icon-right' }),
  ];
  const ariaLabel = !o.label && o.title ? o.title : undefined;

  if (o.href !== undefined) {
    const external = /^https?:\/\//i.test(o.href);
    const a = el(
      'a',
      {
        class: cls,
        href: o.href,
        title: o.label ? o.title : undefined,
        attrs: {
          'aria-label': ariaLabel,
          target: external ? '_blank' : undefined,
          rel: external ? 'noopener noreferrer' : undefined,
          'aria-disabled': o.disabled ? 'true' : undefined,
          tabindex: o.disabled ? -1 : undefined,
        },
      },
      ...kids,
    );
    a.addEventListener('click', (e) => {
      if (o.disabled) {
        e.preventDefault();
        return;
      }
      o.onClick?.(e);
    });
    if (!o.label && o.title) tooltip(a, o.title);
    return a;
  }

  const b = el(
    'button',
    { class: cls, type: 'button', title: o.label ? o.title : undefined, disabled: !!o.disabled, attrs: { 'aria-label': ariaLabel } },
    ...kids,
  );
  if (o.onClick) b.addEventListener('click', o.onClick);
  if (!o.label && o.title) tooltip(b, o.title);
  return b;
}

export interface IconButtonOptions {
  icon: IconName;
  /** Used as aria-label and as the hover tooltip. */
  title: string;
  onClick?: (e: MouseEvent) => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** When defined, the button is a toggle (aria-pressed) and shows the active style when true. */
  active?: boolean;
  class?: string;
  disabled?: boolean;
}

export function iconButton(o: IconButtonOptions): HTMLButtonElement {
  const size = o.size ?? 'md';
  const b = el(
    'button',
    {
      class: cx('icon-btn', `btn-${o.variant ?? 'ghost'}`, `icon-btn-${size}`, o.active && 'is-active', o.class),
      type: 'button',
      disabled: !!o.disabled,
      attrs: { 'aria-label': o.title, 'aria-pressed': o.active === undefined ? undefined : String(o.active) },
    },
    icon(o.icon, { size: size === 'sm' ? 14 : 16 }),
  );
  if (o.onClick) b.addEventListener('click', o.onClick);
  tooltip(b, o.title);
  return b;
}

/** Flip a toggle icon button made with iconButton({ active }). */
export function setPressed(btn: HTMLElement, on: boolean): void {
  btn.classList.toggle('is-active', on);
  btn.setAttribute('aria-pressed', String(on));
}

/* ================================================================ badge */

export function badge(text: string, o: { icon?: IconName; tone?: 'default' | 'blue' | 'new' | 'danger' } = {}): HTMLElement {
  return el(
    'span',
    { class: cx('badge', `badge-${o.tone ?? 'default'}`, o.icon && 'has-icon') },
    o.icon && icon(o.icon, { size: o.tone === 'new' ? 10 : 12 }),
    text,
  );
}

/* ================================================================ single-choice groups */

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  title?: string;
  disabled?: boolean;
}

/** Shared radio-group behaviour: roving tabindex, arrow keys, Home/End. */
function bindRadios<T extends string>(
  buttons: HTMLButtonElement[],
  items: Choice<T>[],
  initial: T,
  onChange: (v: T) => void,
  paint: (i: number) => void,
): { set(v: T): void } {
  let current = Math.max(0, items.findIndex((it) => it.value === initial));
  const select = (i: number, notify: boolean, focus: boolean) => {
    current = i;
    buttons.forEach((b, j) => {
      b.setAttribute('aria-checked', String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    paint(i);
    if (focus) buttons[i].focus();
    if (notify) onChange(items[i].value);
  };
  const enabled = (i: number) => !items[i].disabled;
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => {
      if (enabled(i) && i !== current) select(i, true, false);
    });
    b.addEventListener('keydown', (e) => {
      const n = items.length;
      let next = -1;
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (dir) {
        next = i;
        for (let k = 0; k < n; k++) {
          next = (next + dir + n) % n;
          if (enabled(next)) break;
        }
      } else if (e.key === 'Home') {
        next = items.findIndex((_, k) => enabled(k));
      } else if (e.key === 'End') {
        for (let k = n - 1; k >= 0; k--) {
          if (enabled(k)) {
            next = k;
            break;
          }
        }
      }
      if (next < 0) return;
      e.preventDefault();
      if (next !== current) select(next, true, true);
      else buttons[next].focus();
    });
  });
  select(current, false, false);
  return {
    set(v: T) {
      const i = items.findIndex((it) => it.value === v);
      if (i >= 0) select(i, false, false);
    },
  };
}

/** Vertex tab-chip tray: bordered chips in a floating card tray. Scrolls sideways on small screens. */
export function chipTray<T extends string>(items: Choice<T>[], value: T, onChange: (v: T) => void): { el: HTMLElement; set(v: T): void } {
  const buttons = items.map((it) =>
    el(
      'button',
      { class: 'chip', type: 'button', disabled: !!it.disabled, title: it.title, attrs: { role: 'radio' } },
      it.icon && icon(it.icon, { size: 16 }),
      el('span', null, it.label),
    ),
  );
  const root = el('div', { class: 'chip-tray', attrs: { role: 'radiogroup' } }, ...buttons);
  const ctl = bindRadios(buttons, items, value, onChange, (i) => {
    if (!root.isConnected || root.scrollWidth <= root.clientWidth) return;
    const b = buttons[i];
    const left = b.offsetLeft - (root.clientWidth - b.offsetWidth) / 2;
    root.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
  return { el: root, set: ctl.set };
}

/** Segmented control with a sliding pill (2 to 4 items). */
export function segmented<T extends string>(
  items: Choice<T>[],
  value: T,
  onChange: (v: T) => void,
  o: { size?: 'sm' | 'md'; full?: boolean } = {},
): { el: HTMLElement; set(v: T): void } {
  const pill = el('span', { class: 'seg-pill', attrs: { 'aria-hidden': 'true' } });
  const buttons = items.map((it) =>
    el(
      'button',
      { class: 'seg-btn', type: 'button', disabled: !!it.disabled, title: it.title, attrs: { role: 'radio' } },
      it.icon && icon(it.icon, { size: 14 }),
      el('span', null, it.label),
    ),
  );
  const root = el(
    'div',
    { class: cx('seg', `seg-${o.size ?? 'md'}`, o.full && 'seg-full'), style: `--n:${items.length}`, attrs: { role: 'radiogroup' } },
    pill,
    ...buttons,
  );
  const ctl = bindRadios(buttons, items, value, onChange, (i) => root.style.setProperty('--i', String(i)));
  return { el: root, set: ctl.set };
}

/* ================================================================ form controls */

/** Keep a raw <input type=range> filled up to its value (sets --p). Returns a repaint function for programmatic changes. */
export function syncRange(input: HTMLInputElement): () => void {
  const paint = () => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const v = Number(input.value);
    input.style.setProperty('--p', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
  };
  input.addEventListener('input', paint);
  paint();
  return paint;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  hint?: string;
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}

/** Labelled range: label left, value right (mono), track below, optional hint. */
export function slider(o: SliderOptions): { el: HTMLElement; set(v: number): void; get(): number; setDisabled(d: boolean): void } {
  const id = uid('slider');
  const fmt = o.format ?? ((v: number) => String(v));
  const input = el('input', {
    class: 'range',
    type: 'range',
    id,
    min: String(o.min),
    max: String(o.max),
    step: String(o.step),
    value: String(o.value),
  });
  const out = el('output', { class: 'field-value', attrs: { for: id } }, fmt(o.value));
  const paint = () => {
    const v = Number(input.value);
    const p = o.max > o.min ? ((v - o.min) / (o.max - o.min)) * 100 : 0;
    input.style.setProperty('--p', `${p}%`);
    out.textContent = fmt(v);
  };
  input.addEventListener('input', () => {
    paint();
    o.onInput(Number(input.value));
  });
  if (o.onChange) input.addEventListener('change', () => o.onChange?.(Number(input.value)));
  paint();
  const root = el(
    'div',
    { class: 'field slider-field' },
    el('div', { class: 'field-row' }, el('label', { class: 'field-label', htmlFor: id }, o.label), out),
    input,
    o.hint && el('p', { class: 'field-hint' }, o.hint),
  );
  return {
    el: root,
    set(v: number) {
      input.value = String(v);
      paint();
    },
    get: () => Number(input.value),
    setDisabled(d: boolean) {
      input.disabled = d;
      root.classList.toggle('is-disabled', d);
    },
  };
}

/** Switch row: label left, switch right, optional hint. */
export function toggle(o: { label: string; value: boolean; hint?: string; onChange: (v: boolean) => void }): { el: HTMLElement; set(v: boolean): void } {
  const id = uid('switch');
  const input = el('input', { class: 'switch', type: 'checkbox', id, checked: o.value, attrs: { role: 'switch' } });
  input.addEventListener('change', () => o.onChange(input.checked));
  const root = el(
    'div',
    { class: 'field toggle-field' },
    el('div', { class: 'field-row' }, el('label', { class: 'field-label', htmlFor: id }, o.label), input),
    o.hint && el('p', { class: 'field-hint' }, o.hint),
  );
  return {
    el: root,
    set(v: boolean) {
      input.checked = v;
    },
  };
}

/** Native select with the custom chevron: label left, select right. */
export function select<T extends string>(o: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}): { el: HTMLElement; set(v: T): void } {
  const id = uid('select');
  const s = el('select', { class: 'select', id }, ...o.options.map((op) => el('option', { value: op.value }, op.label)));
  s.value = o.value;
  s.addEventListener('change', () => o.onChange(s.value as T));
  const root = el('div', { class: 'field select-field' }, el('div', { class: 'field-row' }, el('label', { class: 'field-label', htmlFor: id }, o.label), s));
  return {
    el: root,
    set(v: T) {
      s.value = v;
    },
  };
}

/* ================================================================ display */

/** Card: optional title/description header, then children in .card-body. */
export function card(o: { title?: string; description?: string; tint?: boolean; class?: string; children?: Child[] } = {}): HTMLElement {
  return el(
    'div',
    { class: cx('card', o.tint && 'card-tint', o.class) },
    (o.title || o.description) &&
      el('div', { class: 'card-head' }, o.title && el('h3', { class: 'card-title' }, o.title), o.description && el('p', { class: 'card-desc' }, o.description)),
    o.children && o.children.length ? el('div', { class: 'card-body' }, ...o.children) : null,
  );
}

/** Big number with a left rule and a muted label. */
export function stat(label: string, value: string): { el: HTMLElement; set(v: string): void } {
  const v = el('span', { class: 'stat-value' }, value);
  return {
    el: el('div', { class: 'stat' }, v, el('span', { class: 'stat-label' }, label)),
    set(nv: string) {
      v.textContent = nv;
    },
  };
}

/** Independent disclosure items with the bracket [+] / [-] marker. */
export function accordion(items: { q: string; a: Child }[], o: { openFirst?: boolean; level?: 3 | 4 } = {}): HTMLElement {
  const root = el('div', { class: 'accordion' });
  items.forEach((it, i) => {
    const bid = uid('acc-q');
    const pid = uid('acc-a');
    const open = !!o.openFirst && i === 0;
    const trigger = el(
      'button',
      { class: 'acc-trigger', type: 'button', id: bid, attrs: { 'aria-expanded': String(open), 'aria-controls': pid } },
      el('span', { class: 'acc-q' }, it.q),
      bracketMarker(),
    );
    const heading = o.level === 4 ? el('h4', { class: 'acc-heading' }, trigger) : el('h3', { class: 'acc-heading' }, trigger);
    const panel = el(
      'div',
      { class: 'acc-panel', id: pid, attrs: { role: 'region', 'aria-labelledby': bid } },
      el('div', { class: 'acc-panel-inner' }, el('div', { class: 'acc-answer' }, it.a)),
    );
    const item = el('div', { class: cx('acc-item', open && 'is-open') }, heading, panel);
    trigger.addEventListener('click', () => {
      const now = !item.classList.contains('is-open');
      item.classList.toggle('is-open', now);
      trigger.setAttribute('aria-expanded', String(now));
    });
    root.append(item);
  });
  return root;
}

export interface FaqCategory {
  id: string;
  label: string;
  icon: IconName;
  items: { q: string; a: Child }[];
}

/** Vertex FAQ: sticky category rail (left on desktop, top bar on mobile) and grouped accordions. */
export function faq(categories: FaqCategory[]): HTMLElement {
  const railBtns: HTMLButtonElement[] = [];
  const groups: HTMLElement[] = [];
  const setActive = (i: number) =>
    railBtns.forEach((b, j) => {
      b.classList.toggle('is-active', j === i);
      if (j === i) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });

  categories.forEach((c, i) => {
    const gid = uid(`faq-${c.id}`);
    const tid = `${gid}-title`;
    groups.push(
      el(
        'section',
        { class: 'faq-group', id: gid, attrs: { 'aria-labelledby': tid } },
        el('h3', { class: 'faq-group-title', id: tid }, c.label),
        accordion(c.items, { openFirst: i === 0, level: 4 }),
      ),
    );
    const b = el(
      'button',
      { class: 'faq-rail-item', type: 'button', attrs: { 'aria-controls': gid } },
      icon(c.icon, { size: 16 }),
      el('span', null, c.label),
    );
    b.addEventListener('click', () => {
      setActive(i);
      groups[i].scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    railBtns.push(b);
  });
  setActive(0);

  const root = el(
    'div',
    { class: 'faq' },
    el('nav', { class: 'faq-rail', attrs: { 'aria-label': 'Question categories' } }, ...railBtns),
    el('div', { class: 'faq-body' }, ...groups),
  );

  if (typeof IntersectionObserver === 'function') {
    const visible = new Map<Element, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target, e.isIntersecting);
        const first = groups.findIndex((g) => visible.get(g));
        if (first >= 0) setActive(first);
      },
      { rootMargin: '-25% 0px -60% 0px' },
    );
    groups.forEach((g) => io.observe(g));
    onDispose(root, () => io.disconnect());
  }
  return root;
}

/* ================================================================ drop zone */

interface PasteTarget {
  zone: HTMLElement;
  take: (f: File) => void;
}
const pasteTargets: PasteTarget[] = [];
let pasteBound = false;

function bindPaste(): void {
  if (pasteBound) return;
  pasteBound = true;
  document.addEventListener('paste', (e) => {
    const t = e.target as Element | null;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    for (let i = pasteTargets.length - 1; i >= 0; i--) if (!pasteTargets[i].zone.isConnected) pasteTargets.splice(i, 1);
    const target = [...pasteTargets].reverse().find((p) => p.zone.getClientRects().length > 0);
    const file = e.clipboardData?.files?.[0];
    if (!target || !file) return;
    e.preventDefault();
    target.take(file);
  });
}

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/**
 * File drop target. Click, Enter or Space opens the picker; drag-over shows the blue state;
 * pasting a file anywhere on the page (outside text fields) also works while the zone is visible.
 */
export function dropZone(o: { accept: string; title: string; subtitle?: string; onFile: (f: File) => void; compact?: boolean }): HTMLElement {
  const input = el('input', { class: 'dz-input', type: 'file', accept: o.accept, tabIndex: -1, attrs: { 'aria-hidden': 'true' } });
  const zone = el(
    'div',
    {
      class: cx('dropzone', o.compact && 'is-compact'),
      attrs: { role: 'button', tabindex: 0, 'aria-label': o.subtitle ? `${o.title}. ${o.subtitle}` : o.title },
    },
    el('span', { class: 'dz-icon' }, icon('upload', { size: 18 })),
    el('span', { class: 'dz-text' }, el('span', { class: 'dz-title' }, o.title), o.subtitle && el('span', { class: 'dz-sub' }, o.subtitle)),
    o.compact && el('span', { class: 'dz-cta', attrs: { 'aria-hidden': 'true' } }, 'Browse'),
    input,
  );

  const take = (f: File | null | undefined) => {
    if (!f) return;
    if (!matchesAccept(f, o.accept)) {
      toast(`${f.name || 'That file'} is not a supported file type.`, { tone: 'error' });
      return;
    }
    o.onFile(f);
  };

  zone.addEventListener('click', (e) => {
    if (e.target !== input) input.click();
  });
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    take(input.files?.[0]);
    input.value = '';
  });

  let depth = 0;
  zone.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('is-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('is-over');
    take(e.dataTransfer?.files?.[0]);
  });

  pasteTargets.push({ zone, take });
  bindPaste();
  return zone;
}

/* ================================================================ toast */

let toaster: HTMLElement | null = null;

function getToaster(): HTMLElement {
  if (toaster && toaster.isConnected) return toaster;
  toaster = el('div', { class: 'toaster', attrs: { role: 'status', 'aria-live': 'polite' } });
  document.body.append(toaster);
  return toaster;
}

/** Bottom-right toast stack (bottom, full width on phones). timeout 0 keeps it until dismissed. */
export function toast(message: string, o: { tone?: 'default' | 'success' | 'error'; timeout?: number } = {}): void {
  const tone = o.tone ?? 'default';
  const host = getToaster();
  const glyph: IconName = tone === 'success' ? 'check' : tone === 'error' ? 'alert' : 'info';
  const close = el('button', { class: 'toast-close', type: 'button', attrs: { 'aria-label': 'Dismiss notification' } }, icon('x', { size: 14 }));
  const t = el(
    'div',
    { class: cx('toast', `toast-${tone}`) },
    el('span', { class: 'toast-icon' }, icon(glyph, { size: 16 })),
    el('p', { class: 'toast-msg' }, message),
    close,
  );
  let timer: number | undefined;
  const remove = () => {
    if (t.classList.contains('is-leaving')) return;
    window.clearTimeout(timer);
    t.classList.add('is-leaving');
    const done = () => t.remove();
    if (prefersReducedMotion()) done();
    else {
      t.addEventListener('animationend', done, { once: true });
      window.setTimeout(done, 400);
    }
  };
  close.addEventListener('click', remove);
  host.append(t);
  while (host.children.length > 4) host.firstElementChild?.remove();
  const ms = o.timeout ?? (tone === 'error' ? 6000 : 3500);
  if (ms > 0) {
    timer = window.setTimeout(remove, ms);
    t.addEventListener('mouseenter', () => window.clearTimeout(timer));
    t.addEventListener('mouseleave', () => {
      timer = window.setTimeout(remove, 1500);
    });
  }
}

/* ================================================================ sheet */

let scrollLocks = 0;

function lockScroll(): void {
  scrollLocks += 1;
  if (scrollLocks > 1) return;
  const root = document.documentElement;
  root.style.setProperty('--sbw', `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
  root.classList.add('is-locked');
}

function unlockScroll(): void {
  if (scrollLocks === 0) return;
  scrollLocks -= 1;
  if (scrollLocks === 0) document.documentElement.classList.remove('is-locked');
}

/**
 * Modal sheet on a native <dialog>: centred card on desktop, bottom sheet under 640px.
 * Esc, the close button and a scrim click close it; focus is trapped by showModal() and restored on close.
 */
export function sheet(o: { title: string; description?: string; content: Child; width?: number; onClose?: () => void }): {
  el: HTMLElement;
  body: HTMLElement;
  open(): void;
  close(): void;
} {
  const tid = uid('sheet-title');
  const did = uid('sheet-desc');
  const body = el('div', { class: 'sheet-body scroll' }, o.content);
  const closeBtn = iconButton({ icon: 'x', title: 'Close', onClick: () => api.close() });
  const dlg = el(
    'dialog',
    {
      class: 'sheet',
      style: o.width ? `--sheet-w:${o.width}px` : undefined,
      attrs: { 'aria-labelledby': tid, 'aria-describedby': o.description ? did : undefined },
    },
    el('div', { class: 'sheet-grab', attrs: { 'aria-hidden': 'true' } }),
    el(
      'header',
      { class: 'sheet-head' },
      // Initial focus lands on the heading (not the close button) so no tooltip pops on open.
      el(
        'div',
        { class: 'sheet-heading', tabIndex: -1, attrs: { autofocus: true } },
        el('h2', { class: 'sheet-title', id: tid }, o.title),
        o.description && el('p', { class: 'sheet-desc', id: did }, o.description),
      ),
      closeBtn,
    ),
    body,
  );

  let mounted = false;
  let closing = false;
  let lastFocus: HTMLElement | null = null;

  const cleanup = () => {
    if (!mounted) return;
    mounted = false;
    closing = false;
    dlg.classList.remove('is-closing');
    dlg.remove();
    unlockScroll();
    if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    o.onClose?.();
  };
  dlg.addEventListener('close', cleanup);

  const finish = () => {
    if (dlg.open) dlg.close();
    else cleanup();
  };

  const api = {
    el: dlg as HTMLElement,
    body,
    open() {
      if (dlg.open) return;
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dlg.isConnected) document.body.append(dlg);
      mounted = true;
      closing = false;
      dlg.classList.remove('is-closing');
      lockScroll();
      dlg.showModal();
    },
    close() {
      if (!dlg.open || closing) return;
      closing = true;
      if (prefersReducedMotion()) {
        finish();
        return;
      }
      dlg.classList.add('is-closing');
      const fallback = window.setTimeout(finish, 320);
      const onEnd = (e: AnimationEvent) => {
        if (e.target !== dlg) return;
        dlg.removeEventListener('animationend', onEnd);
        window.clearTimeout(fallback);
        finish();
      };
      dlg.addEventListener('animationend', onEnd);
    },
  };

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    api.close();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) api.close();
  });
  return api;
}

/* ================================================================ progress, spinner */

/** Thin progress bar. set(fraction) with 0..1; a negative or NaN fraction shows the indeterminate state. */
export function progress(o: { label?: string } = {}): { el: HTMLElement; set(fraction: number, label?: string): void } {
  const labelEl = el('span', { class: 'progress-label' }, o.label ?? '');
  const pct = el('span', { class: 'progress-pct mono' }, '0%');
  const bar = el('div', { class: 'progress-bar' });
  const track = el(
    'div',
    {
      class: 'progress-track',
      attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': o.label || 'Progress' },
    },
    bar,
  );
  const root = el('div', { class: 'progress' }, el('div', { class: 'progress-head' }, labelEl, pct), track);
  return {
    el: root,
    set(fraction: number, label?: string) {
      if (label !== undefined) {
        labelEl.textContent = label;
        track.setAttribute('aria-label', label || 'Progress');
      }
      const indeterminate = !Number.isFinite(fraction) || fraction < 0;
      root.classList.toggle('is-indeterminate', indeterminate);
      if (indeterminate) {
        pct.textContent = '';
        track.removeAttribute('aria-valuenow');
        return;
      }
      const f = Math.min(1, Math.max(0, fraction));
      const p = Math.round(f * 100);
      bar.style.setProperty('--v', String(f));
      pct.textContent = `${p}%`;
      track.setAttribute('aria-valuenow', String(p));
    },
  };
}

export function spinner(size = 16): HTMLElement {
  return el('span', { class: 'spinner', attrs: { role: 'status', 'aria-label': 'Loading' } }, icon('spinner', { size }));
}

/* ================================================================ blueprint decorations */

/** 40px diagonal-hatch divider strip with crosshairs where it meets the rails. */
export function hatch(): HTMLElement {
  const h = el('div', { class: 'hatch', attrs: { 'aria-hidden': 'true' } });
  crosshairs(h);
  return h;
}

/** A dashed horizontal rule with crosshairs at both ends. */
export function rule(): HTMLElement {
  const r = el('div', { class: 'rule', attrs: { 'aria-hidden': 'true' } });
  crosshairs(r, ['tl', 'tr']);
  return r;
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Add "+" marks centred on the container's corners (the container must not clip overflow). */
export function crosshairs(container: HTMLElement, corners: Corner[] = ['tl', 'tr', 'bl', 'br']): void {
  container.classList.add('has-cross');
  for (const c of corners) {
    container.append(
      svgEl(
        'svg',
        { class: `cross cross-${c}`, width: 12, height: 12, viewBox: '0 0 12 12', attrs: { 'aria-hidden': 'true', focusable: 'false' } },
        svgEl('path', { d: 'M0 6h12M6 0v12', stroke: 'currentColor', 'stroke-width': 1, fill: 'none' }),
      ),
    );
  }
}

/** Centred (or left) section heading: optional overline, serif H2, lead. */
export function sectionHead(o: { overline?: string; title: string; lead?: string; align?: 'center' | 'left'; id?: string }): HTMLElement {
  return el(
    'header',
    { class: cx('section-head', o.align === 'left' && 'is-left') },
    o.overline && el('p', { class: 'overline' }, o.overline),
    el('h2', { class: 'h2', id: o.id }, o.title),
    o.lead && el('p', { class: 'lead' }, o.lead),
  );
}

/* ================================================================ tooltip */

let tipEl: HTMLElement | null = null;
let tipOwner: HTMLElement | null = null;
let tipTimer: number | undefined;
let tipGlobalBound = false;

function closeTip(): void {
  window.clearTimeout(tipTimer);
  if (!tipEl) return;
  tipEl.classList.remove('is-visible');
  if (tipOwner?.getAttribute('aria-describedby') === tipEl.id) tipOwner.removeAttribute('aria-describedby');
  tipOwner = null;
}

function openTip(target: HTMLElement): void {
  const text = target.dataset.tip;
  if (!text || !target.isConnected) return;
  if (!tipEl) tipEl = el('div', { class: 'tooltip', id: uid('tooltip'), attrs: { role: 'tooltip' } });
  const host = target.closest('dialog[open]') ?? document.body;
  if (tipEl.parentElement !== host) host.append(tipEl);
  tipEl.textContent = text;
  tipOwner = target;
  if (target.getAttribute('aria-label') !== text) target.setAttribute('aria-describedby', tipEl.id);
  const r = target.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  let top = r.top - th - 8;
  let side = 'top';
  if (top < 8) {
    top = r.bottom + 8;
    side = 'bottom';
  }
  const left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
  tipEl.dataset.side = side;
  const shown = tipEl;
  requestAnimationFrame(() => {
    if (tipOwner === target) shown.classList.add('is-visible');
  });
}

/** Hover/focus tooltip (dark UI, light bubble). Replaces any native title on the target. */
export function tooltip(target: HTMLElement, text: string): void {
  target.removeAttribute('title');
  target.dataset.tip = text;
  if (!tipGlobalBound) {
    tipGlobalBound = true;
    window.addEventListener('scroll', closeTip, { capture: true, passive: true });
    window.addEventListener('hashchange', closeTip);
    window.addEventListener('blur', closeTip);
  }
  const show = (delay: number) => {
    window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => openTip(target), delay);
  };
  const hide = () => {
    if (tipOwner === target || !tipOwner) closeTip();
  };
  target.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') show(tipEl?.classList.contains('is-visible') ? 0 : 400);
  });
  target.addEventListener('pointerleave', hide);
  target.addEventListener('pointerdown', hide);
  target.addEventListener('focus', () => {
    if (target.matches(':focus-visible')) show(150);
  });
  target.addEventListener('blur', hide);
  target.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
}

/* ================================================================ code + empty state */

/** Monospace box with a copy button. Copy reads the live <code> text, so you may update it later. */
export function codeBlock(text: string, o: { maxHeight?: number; copyLabel?: string } = {}): HTMLElement {
  const code = el('code', null, text);
  const pre = el('pre', { class: 'code scroll', style: o.maxHeight ? `max-height:${o.maxHeight}px` : undefined }, code);
  const label = o.copyLabel ?? 'Copy';
  const btn = el('button', { class: 'btn btn-card btn-sm code-copy', type: 'button' });
  const idle = () => mount(btn, icon('copy', { size: 14 }), el('span', { class: 'btn-label' }, label));
  idle();
  let timer: number | undefined;
  btn.addEventListener('click', async () => {
    const ok = await copyText(code.textContent ?? '');
    if (!ok) {
      toast('Copy failed. Select the text and copy it by hand.', { tone: 'error' });
      return;
    }
    mount(btn, icon('check', { size: 14 }), el('span', { class: 'btn-label' }, 'Copied'));
    btn.classList.add('is-copied');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      idle();
      btn.classList.remove('is-copied');
    }, 1600);
  });
  return el('div', { class: 'code-block' }, pre, btn);
}

export function emptyState(o: { icon: IconName; title: string; description?: string; action?: HTMLElement }): HTMLElement {
  return el(
    'div',
    { class: 'empty' },
    el('span', { class: 'empty-icon' }, icon(o.icon, { size: 18 })),
    el('h3', { class: 'empty-title' }, o.title),
    o.description && el('p', { class: 'empty-desc' }, o.description),
    o.action && el('div', { class: 'empty-action' }, o.action),
  );
}
