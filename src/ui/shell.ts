/**
 * App shell: sticky header, double-rail frame, black footer and the mobile menu.
 * Routes are hash based (#/, #/convert, #/live, #/gallery).
 */

import { themeToggle } from './theme';

import { el, mount } from './dom';
import { icon, logoMark, type IconName } from './icons';
import { button, iconButton, tooltip } from './components';
import { headerAccount, menuAccount } from '../account/account-ui';

export interface NavItem {
  label: string;
  href: string;
  icon?: IconName;
}

export interface ShellOptions {
  nav: NavItem[];
  cta: { label: string; href: string };
  repoUrl: string;
}

export interface Shell {
  /** Screens render into this element. */
  main: HTMLElement;
  /** Highlight the nav item whose route matches `href` (anchors after the route are ignored). */
  setActive(href: string): void;
  /** true: the frame spans the full window (rails at the edges) for the workspace. false: the centred frame. */
  setWide(wide: boolean): void;
}

const EXTERNAL = /^https?:\/\//i;

/** "#/convert?x" and "#/#faq" style hrefs reduce to their route ("#/convert", "#/"). */
function routeOf(href: string): string {
  const m = href.match(/^#\/[^#?]*/);
  return m ? m[0] : href;
}

function brand(extraClass = ''): HTMLAnchorElement {
  return el(
    'a',
    { class: `brand ${extraClass}`.trim(), href: '#/', attrs: { 'aria-label': 'Media to Desmos, home' } },
    logoMark(28),
    el('span', { class: 'brand-name' }, 'Media to Desmos'),
  );
}

function footerLink(label: string, href: string): HTMLElement {
  const external = EXTERNAL.test(href);
  return el(
    'a',
    {
      class: 'footer-link',
      href,
      attrs: external ? { target: '_blank', rel: 'noopener noreferrer' } : undefined,
    },
    label,
    external && icon('arrow-up-right', { size: 14 }),
    external && el('span', { class: 'sr-only' }, '(opens in a new tab)'),
  );
}

function footerCol(title: string, links: [string, string][]): HTMLElement {
  return el(
    'div',
    { class: 'footer-col' },
    el('h2', { class: 'footer-head' }, title),
    el('ul', { class: 'footer-links', attrs: { role: 'list' } }, ...links.map(([l, h]) => el('li', null, footerLink(l, h)))),
  );
}

const DEFAULT_PRODUCT: [string, string][] = [
  ['Convert', '#/convert'],
  ['Live webcam', '#/live'],
  ['Gallery', '#/gallery'],
];

function buildFooter(repoUrl: string, nav: NavItem[]): HTMLElement {
  const repo = repoUrl.replace(/\/+$/, '');
  // Product links reuse the nav labels for the app routes, so the footer always matches the header.
  const product = DEFAULT_PRODUCT.map(([label, href]): [string, string] => [nav.find((n) => n.href === href)?.label ?? label, href]);
  const gh = el(
    'a',
    { href: repo, attrs: { target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Media to Desmos on GitHub' } },
    icon('github', { size: 18 }),
  );
  tooltip(gh, 'GitHub');
  return el(
    'footer',
    { class: 'site-footer' },
    el(
      'div',
      { class: 'footer-inner' },
      el(
        'div',
        { class: 'footer-top' },
        el(
          'div',
          { class: 'footer-brand' },
          brand(),
          el('p', { class: 'footer-tagline' }, 'Turn a PNG or MP4 into a black-and-white Desmos graph, right in your browser.'),
        ),
        el(
          'div',
          { class: 'footer-cols' },
          footerCol('Product', product),
          footerCol('Learn', [
            ['How it works', '#/#how'],
            ['FAQ', '#/#faq'],
            ['Desmos API docs', 'https://www.desmos.com/api'],
          ]),
          footerCol('Project', [
            ['GitHub', repo],
            ['Report an issue', `${repo}/issues`],
          ]),
        ),
      ),
      el(
        'div',
        null,
        el('div', { class: 'footer-rule' }),
        el(
          'div',
          { class: 'footer-bottom' },
          el('div', { class: 'footer-social' }, gh),
          el(
            'p',
            { class: 'footer-legal' },
            el('span', null, '© 2026 Media to Desmos'),
            el('span', { class: 'footer-dot', attrs: { 'aria-hidden': 'true' } }),
            el('span', null, 'Not affiliated with or endorsed by Desmos Studio PBC.'),
          ),
        ),
      ),
    ),
  );
}

export function mountShell(root: HTMLElement, o: ShellOptions): Shell {
  const repo = o.repoUrl.replace(/\/+$/, '');

  /* Header */
  const navLinks = o.nav.map((n) => el('a', { class: 'nav-link', href: n.href }, n.label));
  const gh = el(
    'a',
    {
      class: 'icon-btn btn-ghost header-gh',
      href: repo,
      attrs: { target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Media to Desmos on GitHub' },
    },
    icon('github', { size: 18 }),
  );
  tooltip(gh, 'GitHub');
  const menuBtn = iconButton({ icon: 'menu', title: 'Open menu', class: 'menu-toggle' });
  menuBtn.setAttribute('aria-haspopup', 'dialog');
  menuBtn.setAttribute('aria-expanded', 'false');

  const header = el(
    'header',
    { class: 'site-header' },
    el(
      'div',
      { class: 'header-inner' },
      brand(),
      el('nav', { class: 'site-nav', attrs: { 'aria-label': 'Primary' } }, ...navLinks),
      el(
        'div',
        { class: 'header-actions' },
        gh,
        themeToggle(),
        headerAccount(),
        button({ label: o.cta.label, href: o.cta.href, size: 'sm', variant: 'primary', class: 'header-cta' }),
        menuBtn,
      ),
    ),
  );

  /* Mobile menu */
  const mmLinks = o.nav.map((n) =>
    el(
      'a',
      { class: 'mm-link', href: n.href },
      el('span', { class: 'mm-link-label' }, n.icon && icon(n.icon, { size: 18 }), n.label),
      icon('chevron-right', { size: 16, class: 'mm-chev' }),
    ),
  );
  const mmGithub = el(
    'a',
    { class: 'mm-link', href: repo, attrs: { target: '_blank', rel: 'noopener noreferrer' } },
    el('span', { class: 'mm-link-label' }, icon('github', { size: 18 }), 'GitHub'),
    icon('arrow-up-right', { size: 16, class: 'mm-chev' }),
  );
  const menu = el(
    'dialog',
    { class: 'mobile-menu', attrs: { 'aria-label': 'Menu' } },
    el(
      'div',
      { class: 'mm-head' },
      el('span', { class: 'mm-title', tabIndex: -1, attrs: { autofocus: true } }, 'Menu'),
      iconButton({ icon: 'x', title: 'Close menu', onClick: () => menu.close() }),
    ),
    el('nav', { class: 'mm-nav', attrs: { 'aria-label': 'Primary' } }, ...mmLinks, mmGithub),
    menuAccount({ closeMenu: () => menu.close() }),
    el(
      'div',
      { class: 'mm-foot' },
      button({ label: o.cta.label, href: o.cta.href, variant: 'primary', size: 'lg', class: 'mm-cta' }),
      el('p', { class: 'mm-note' }, 'Everything runs in your browser. Nothing is uploaded.'),
    ),
  );
  menuBtn.addEventListener('click', () => {
    if (menu.open) return;
    menu.showModal();
    menuBtn.setAttribute('aria-expanded', 'true');
  });
  menu.addEventListener('close', () => menuBtn.setAttribute('aria-expanded', 'false'));
  menu.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) menu.close();
  });
  const wideQuery = window.matchMedia('(min-width: 768px)');
  wideQuery.addEventListener('change', (e) => {
    if (e.matches && menu.open) menu.close();
  });

  /* Frame */
  const main = el('main', { class: 'site-main', id: 'main', tabIndex: -1 });
  const frame = el('div', { class: 'frame' }, el('div', { class: 'frame-inner' }, main));

  /* Skip link: hash routing owns location.hash, so focus main directly. */
  const skip = el('a', { class: 'skip-link', href: '#main' }, 'Skip to content');
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    main.focus();
  });

  const shell = el('div', { class: 'shell' }, skip, header, frame, buildFooter(repo, o.nav), menu);
  mount(root, shell);

  return {
    main,
    setActive(href: string) {
      const target = routeOf(href || '#/');
      for (const a of [...navLinks, ...mmLinks]) {
        const own = a.getAttribute('href') ?? '';
        // Anchor links such as "#/#how" only light up on an exact match, never for the whole home route.
        const on = own.length > routeOf(own).length ? own === href : routeOf(own) === target;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
    setWide(wide: boolean) {
      shell.classList.toggle('is-wide', wide);
    },
  };
}
