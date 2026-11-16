/**
 * Right column: every equation in the graph, what it draws, and why.
 * Hover or select a row to highlight its shape in the Desmos graph and on
 * the source image.
 */

import { el, mount, clear, debounce } from '../../ui/dom';
import { icon, type IconName } from '../../ui/icons';
import { button, codeBlock, emptyState, iconButton } from '../../ui/components';
import type { EntryKind, InspectorEntry } from '../../desmos/build';

const KIND_ICON: Record<EntryKind, IconName> = {
  stroke: 'pen',
  region: 'fill',
  fourier: 'wave',
  slider: 'sliders',
  ticker: 'clock',
  draw: 'layers',
  data: 'list',
  note: 'info',
};

const PAGE = 250;

export interface InspectorOptions {
  onHover: (e: InspectorEntry | null) => void;
  onSelect: (e: InspectorEntry | null) => void;
  onSolo: (e: InspectorEntry | null) => void;
  onZoom: (e: InspectorEntry) => void;
  onCopyAll: () => void;
}

export class Inspector {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private head: HTMLElement;
  private filterInput: HTMLInputElement;
  private entries: InspectorEntry[] = [];
  private shown = PAGE;
  private selected: string | null = null;
  private soloed: string | null = null;
  private filter = '';
  private rows = new Map<string, HTMLElement>();

  constructor(private opts: InspectorOptions) {
    this.head = el('div', { class: 'insp-count' });
    this.filterInput = el('input', {
      class: 'input input-sm',
      type: 'search',
      placeholder: 'Filter equations',
      attrs: { 'aria-label': 'Filter equations' },
      on: { input: debounce(() => this.applyFilter(), 120) },
    });
    this.list = el('div', { class: 'insp-list scroll', attrs: { role: 'listbox', 'aria-label': 'Equations' } });
    this.el = el(
      'div',
      { class: 'insp' },
      el(
        'div',
        { class: 'panel-head insp-head' },
        el('div', { class: 'insp-title' }, el('h3', { class: 'panel-title' }, 'Equations'), this.head),
        button({ label: 'Copy all', icon: 'copy', variant: 'outline', size: 'sm', onClick: () => this.opts.onCopyAll() }),
      ),
      el('div', { class: 'insp-filter' }, this.filterInput),
      this.list,
    );
    this.renderEmpty();
  }

  private renderEmpty(): void {
    mount(this.list, emptyState({ icon: 'list', title: 'No equations yet', description: 'Open an image or video and its equations show up here, each with an explanation.' }));
    this.head.textContent = '';
  }

  setEntries(entries: InspectorEntry[]): void {
    this.entries = entries;
    this.shown = PAGE;
    if (this.selected && !entries.some((e) => e.id === this.selected)) this.selected = null;
    if (this.soloed && !entries.some((e) => e.id === this.soloed)) this.soloed = null;
    this.render();
  }

  private applyFilter(): void {
    this.filter = this.filterInput.value.trim().toLowerCase();
    this.shown = PAGE;
    this.render();
  }

  private visible(): InspectorEntry[] {
    if (!this.filter) return this.entries;
    return this.entries.filter((e) => (e.title + ' ' + e.summary).toLowerCase().includes(this.filter));
  }

  private render(): void {
    this.rows.clear();
    if (!this.entries.length) return this.renderEmpty();
    const vis = this.visible();
    const shapes = this.entries.filter((e) => e.kind === 'stroke' || e.kind === 'region' || e.kind === 'fourier').length;
    this.head.textContent = shapes
      ? `${shapes.toLocaleString('en-US')} shape equation${shapes === 1 ? '' : 's'}`
      : `${this.entries.length} expressions`;
    clear(this.list);
    for (const e of vis.slice(0, this.shown)) this.list.appendChild(this.row(e));
    if (vis.length > this.shown) {
      this.list.appendChild(
        el(
          'div',
          { class: 'insp-more' },
          button({
            label: `Show ${Math.min(PAGE, vis.length - this.shown)} more (${(vis.length - this.shown).toLocaleString('en-US')} left)`,
            variant: 'ghost',
            size: 'sm',
            onClick: () => {
              this.shown += PAGE;
              this.render();
            },
          }),
        ),
      );
    }
    if (!vis.length) this.list.appendChild(el('p', { class: 'field-hint insp-none' }, 'Nothing matches that filter.'));
  }

  private row(e: InspectorEntry): HTMLElement {
    const isSel = e.id === this.selected;
    const head = el(
      'button',
      {
        class: 'row insp-row' + (isSel ? ' is-active' : ''),
        type: 'button',
        attrs: { role: 'option', 'aria-selected': isSel ? 'true' : 'false' },
        on: {
          click: () => this.select(isSel ? null : e.id),
          mouseenter: () => this.opts.onHover(e),
          mouseleave: () => this.opts.onHover(null),
          focus: () => this.opts.onHover(e),
          blur: () => this.opts.onHover(null),
        },
      },
      el('span', { class: 'insp-icon' }, icon(KIND_ICON[e.kind], { size: 15 })),
      el('span', { class: 'insp-text' }, el('span', { class: 'insp-row-title' }, e.title), el('span', { class: 'insp-row-sum' }, e.summary)),
      icon(isSel ? 'chevron-up' : 'chevron-down', { size: 14, class: 'insp-chev' }),
    );
    const wrap = el('div', { class: 'insp-item' + (isSel ? ' is-open' : '') }, head);
    if (isSel) wrap.appendChild(this.details(e));
    this.rows.set(e.id, wrap);
    return wrap;
  }

  private details(e: InspectorEntry): HTMLElement {
    const isShape = e.kind === 'stroke' || e.kind === 'region' || e.kind === 'fourier' || e.kind === 'draw';
    const latexShown = e.latex.length > 6000 ? e.latex.slice(0, 6000) + ' ...' : e.latex;
    const actions = el(
      'div',
      { class: 'insp-actions' },
      isShape
        ? button({
            label: this.soloed === e.id ? 'Show all' : 'Show only this',
            icon: this.soloed === e.id ? 'eye' : 'eye-off',
            variant: 'outline',
            size: 'sm',
            onClick: () => {
              this.soloed = this.soloed === e.id ? null : e.id;
              this.opts.onSolo(this.soloed ? e : null);
              this.render();
            },
          })
        : null,
      e.bbox ? button({ label: 'Zoom to it', icon: 'zoom-fit', variant: 'outline', size: 'sm', onClick: () => this.opts.onZoom(e) }) : null,
    );
    return el(
      'div',
      { class: 'insp-detail' },
      el('p', { class: 'insp-explain' }, e.explain),
      e.example ? el('p', { class: 'insp-example' }, e.example) : null,
      actions,
      el('div', { class: 'overline insp-latex-label' }, 'Desmos LaTeX'),
      codeBlock(latexShown, { maxHeight: 160, copyLabel: 'Copy equation' }),
      e.latex.length > 6000
        ? el('p', { class: 'field-hint' }, 'Long equation: only the start is shown above. The copy button copies the start only, so use Copy all or Export for the complete graph.')
        : null,
    );
  }

  select(id: string | null, scroll = false): void {
    this.selected = id;
    const entry = id ? this.entries.find((e) => e.id === id) ?? null : null;
    if (entry && scroll) {
      // make sure it's rendered
      const idx = this.visible().indexOf(entry);
      if (idx >= this.shown) this.shown = idx + 20;
    }
    this.render();
    this.opts.onSelect(entry);
    if (entry && scroll) this.rows.get(entry.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  get selection(): string | null {
    return this.selected;
  }

  clearSolo(): void {
    this.soloed = null;
  }

  /** Small toolbar-sized button (used on mobile). */
  static toggleButton(onClick: () => void): HTMLButtonElement {
    return iconButton({ icon: 'list', title: 'Equations', onClick });
  }
}
