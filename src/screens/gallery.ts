/** Saved projects, stored in this browser's IndexedDB. */

import { el, mount, fmtBytes, fmtInt } from '../ui/dom';
import { badge, button, emptyState, sectionHead, sheet, spinner, toast } from '../ui/components';
import { openInConverter, go } from '../app';
import { deleteProject, listProjects, type Project } from '../store/projects';
import { openExportSheet, openShareSheet } from './convert/export-sheet';

export function renderGallery(main: HTMLElement): () => void {
  const grid = el('div', { class: 'gal-grid' });
  const root = el(
    'section',
    { class: 'gal' },
    sectionHead({
      overline: 'Projects',
      title: 'Your graphs.',
      lead: 'Projects are saved in this browser only. Nothing is uploaded, so clearing site data deletes them. Export anything you want to keep.',
      align: 'left',
    }),
    grid,
  );
  mount(main, root);
  mount(grid, el('div', { class: 'gal-loading' }, spinner(22)));

  let alive = true;
  const load = async () => {
    let projects: Project[] = [];
    try {
      projects = await listProjects();
    } catch (err) {
      mount(grid, emptyState({ icon: 'alert', title: 'Projects are unavailable', description: err instanceof Error ? err.message : String(err) }));
      return;
    }
    if (!alive) return;
    if (!projects.length) {
      mount(
        grid,
        emptyState({
          icon: 'gallery',
          title: 'No saved projects yet',
          description: 'Convert an image or video, then press Save to keep it here.',
          action: button({ label: 'Convert a file', icon: 'upload', variant: 'primary', onClick: () => go('#/convert') }) as HTMLElement,
        }),
      );
      return;
    }
    mount(grid, ...projects.map((p) => card(p)));
  };

  const card = (p: Project): HTMLElement => {
    const date = new Date(p.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const stats =
      p.kind === 'video'
        ? `${fmtInt(p.stats.frames ?? p.stats.shapes)} frames, ${fmtBytes(p.stats.bytes)}`
        : `${fmtInt(p.stats.shapes)} shapes, ${fmtInt(p.stats.units)} ${p.stats.unitLabel}, ${fmtBytes(p.stats.bytes)}`;
    return el(
      'article',
      { class: 'card gal-card' },
      el(
        'button',
        { class: 'gal-thumb', type: 'button', title: 'Open', on: { click: () => openInConverter({ type: 'project', id: p.id }) } },
        p.thumb ? el('img', { src: p.thumb, alt: `Preview of ${p.name}`, loading: 'lazy' }) : null,
      ),
      el(
        'div',
        { class: 'gal-body' },
        el('div', { class: 'gal-title-row' }, el('h3', { class: 'gal-title', title: p.name }, p.name), badge(p.kind === 'video' ? 'Video' : 'Image', { icon: p.kind === 'video' ? 'film' : 'image' })),
        el('p', { class: 'gal-meta' }, `${stats}. Saved ${date}`),
        el(
          'div',
          { class: 'gal-actions' },
          button({ label: 'Open', icon: 'arrow-right', variant: 'outline', size: 'sm', onClick: () => openInConverter({ type: 'project', id: p.id }) }),
          button({ label: 'Export', icon: 'arrow-up-right', variant: 'ghost', size: 'sm', onClick: () => openExportSheet({ name: p.name, kind: p.kind, state: p.state, bytes: p.stats.bytes }) }),
          button({ label: 'Share', icon: 'share', variant: 'ghost', size: 'sm', onClick: () => void openShareSheet({ name: p.name, kind: p.kind, state: p.state, bytes: p.stats.bytes }) }),
          button({ label: 'Delete', icon: 'trash', variant: 'ghost', size: 'sm', class: 'gal-del', onClick: () => confirmDelete(p) }),
        ),
      ),
    );
  };

  const confirmDelete = (p: Project) => {
    const dlg = sheet({
      title: 'Delete project?',
      description: p.name,
      width: 440,
      content: el(
        'div',
        { class: 'xp' },
        el('p', null, 'This removes the saved graph from this browser. It cannot be undone.'),
        el(
          'div',
          { class: 'xp-row' },
          button({
            label: 'Delete',
            icon: 'trash',
            variant: 'danger',
            onClick: async () => {
              await deleteProject(p.id);
              dlg.close();
              toast('Project deleted');
              void load();
            },
          }),
          button({ label: 'Keep it', variant: 'outline', onClick: () => dlg.close() }),
        ),
      ),
    });
    dlg.open();
  };

  void load();
  return () => {
    alive = false;
  };
}
