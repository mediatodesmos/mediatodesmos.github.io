/**
 * Account controls for the app shell: the header control and the block in the mobile menu.
 * Signed out they offer "Sign in"; signed in they show the account, that BETA is unlocked, and Sign out.
 */

import '../styles/account.css';
import { el, mount } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { badge, button, toast, tooltip, uid } from '../ui/components';
import { getAuthState, initAuth, onAuthChange, signOut, type AccountUser, type AuthState } from './auth';
import { openSignInSheet } from './signin-sheet';

/* ================================================================ shared bits */

/** First letter or digit of the name or email, so an emoji or symbol never stands in for the avatar. */
function initialOf(user: AccountUser): string {
  for (const s of [user.displayName, user.email]) {
    const m = s?.match(/[\p{L}\p{N}]/u);
    if (m) return m[0].toLocaleUpperCase();
  }
  return '';
}

/** Round avatar: the account photo, else the initial, else the user icon. Decorative (aria-hidden). */
function avatar(user: AccountUser, size: number): HTMLElement {
  const box = el('span', { class: 'avatar', style: `--avatar:${size}px`, attrs: { 'aria-hidden': 'true' } });
  const fallback = () => {
    const initial = initialOf(user);
    mount(box, initial ? el('span', { class: 'avatar-initial' }, initial) : icon('user', { size: Math.round(size / 2) }));
  };
  if (user.photoURL && /^https:\/\//i.test(user.photoURL)) {
    const img = el('img', { class: 'avatar-img', alt: '', referrerPolicy: 'no-referrer', decoding: 'async', src: user.photoURL });
    img.addEventListener('error', fallback, { once: true });
    box.append(img);
  } else {
    fallback();
  }
  return box;
}

function who(user: AccountUser): HTMLElement {
  return el(
    'div',
    { class: 'account-who' },
    user.displayName && el('p', { class: 'account-name truncate' }, user.displayName),
    el('p', { class: user.displayName ? 'account-email truncate' : 'account-name truncate' }, user.email ?? 'Signed in'),
  );
}

const unlockedBadge = () => badge('BETA features unlocked', { icon: 'flask', tone: 'blue' });

async function signOutWithToast(): Promise<void> {
  const res = await signOut();
  if (res.ok) toast('Signed out. BETA features are locked until you sign in again.');
  else toast(res.error ?? "Couldn't sign out. Try again.", { tone: 'error' });
}

/** Re-render on every auth change while `root` is on the page; stop once it has been removed. */
function follow(root: HTMLElement, render: (s: AuthState) => void): void {
  let seen = false;
  render(getAuthState());
  const off = onAuthChange((s) => {
    if (root.isConnected) seen = true;
    else if (seen) {
      off();
      return;
    }
    render(s);
  });
}

/* A redirect sign-in comes back as a fresh page load: report it once, however many shells mount. */
let startupReported = false;

function reportStartup(): void {
  void initAuth().then((res) => {
    if (startupReported) return;
    startupReported = true;
    if (res.error) toast(res.error, { tone: 'error' });
    else if (res.message) toast(res.message, { tone: 'success' });
  });
}

/* ================================================================ header */

/** The header control: a "Sign in" ghost button, or the avatar with an account menu. */
export function headerAccount(): HTMLElement {
  const root = el('div', { class: 'account' });
  const menuId = uid('account-menu');
  let closeMenu: (restoreFocus?: boolean) => void = () => undefined;

  const signedOut = (): HTMLElement => {
    const b = button({
      label: 'Sign in',
      icon: 'user',
      variant: 'ghost',
      size: 'sm',
      class: 'account-signin',
      // Signing in replaces this button with the avatar, so focus moves there once the sheet closes.
      onClick: () => void openSignInSheet().then((ok) => ok && root.querySelector<HTMLElement>('.account-avatar')?.focus()),
    });
    // The label hides on phones, where the button shows only the icon.
    b.setAttribute('aria-label', 'Sign in');
    return b;
  };

  const signedIn = (user: AccountUser): HTMLElement[] => {
    const trigger = el(
      'button',
      {
        class: 'account-avatar',
        type: 'button',
        attrs: { 'aria-label': `Account: ${user.email ?? user.displayName ?? 'signed in'}`, 'aria-expanded': 'false', 'aria-controls': menuId },
      },
      avatar(user, 32),
    );
    tooltip(trigger, 'Account');

    const signOutBtn = button({
      label: 'Sign out',
      icon: 'log-out',
      variant: 'ghost',
      size: 'sm',
      class: 'account-menu-signout',
      onClick: () => {
        closeMenu(true);
        void signOutWithToast();
      },
    });
    const panel = el(
      'div',
      { class: 'account-menu', id: menuId, hidden: true },
      el('div', { class: 'account-menu-head' }, avatar(user, 36), who(user)),
      el('div', { class: 'account-menu-beta' }, unlockedBadge()),
      el('div', { class: 'account-menu-foot' }, signOutBtn),
    );

    const onPointer = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false, true);
    };
    const onRoute = () => setOpen(false);
    let isOpen = false;
    function setOpen(open: boolean, restoreFocus = false): void {
      if (open === isOpen) return;
      isOpen = open;
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open) {
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('keydown', onKey);
        window.addEventListener('hashchange', onRoute);
      } else {
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('hashchange', onRoute);
        if (restoreFocus) trigger.focus();
      }
    }
    closeMenu = (restoreFocus = false) => setOpen(false, restoreFocus);
    trigger.addEventListener('click', () => setOpen(!isOpen));
    return [trigger, panel];
  };

  // Tabbing away from the menu closes it. (Clicks elsewhere are handled by the pointer listener.)
  root.addEventListener('focusout', (e) => {
    const next = e.relatedTarget as Node | null;
    if (next && !root.contains(next)) closeMenu();
  });

  follow(root, (s) => {
    closeMenu();
    if (!s.ready) mount(root, el('span', { class: 'account-placeholder', attrs: { 'aria-hidden': 'true' } }));
    else if (!s.user) mount(root, signedOut());
    else mount(root, ...signedIn(s.user));
  });
  reportStartup();
  return root;
}

/* ================================================================ mobile menu */

function menuRow(o: { icon: IconName; label: string; hint?: string; trailing?: IconName; onClick: () => void }): HTMLElement {
  const b = el(
    'button',
    { class: 'mm-account-row', type: 'button' },
    el(
      'span',
      { class: 'mm-account-label' },
      icon(o.icon, { size: 18 }),
      el('span', { class: 'mm-account-text' }, el('span', null, o.label), o.hint && el('span', { class: 'mm-account-hint' }, o.hint)),
    ),
    o.trailing && icon(o.trailing, { size: 16, class: 'mm-chev' }),
  );
  b.addEventListener('click', o.onClick);
  return b;
}

/** The account block for the mobile menu sheet. `closeMenu` closes the sheet before an action runs. */
export function menuAccount(o: { closeMenu: () => void }): HTMLElement {
  const root = el('div', { class: 'mm-account' });
  follow(root, (s) => {
    if (!s.ready) {
      mount(root);
      return;
    }
    if (!s.user) {
      mount(
        root,
        menuRow({
          icon: 'log-in',
          label: 'Sign in',
          hint: 'Free. Unlocks BETA features.',
          trailing: 'chevron-right',
          onClick: () => {
            o.closeMenu();
            void openSignInSheet();
          },
        }),
      );
      return;
    }
    mount(
      root,
      el('div', { class: 'mm-account-card' }, avatar(s.user, 40), el('div', { class: 'mm-account-info' }, who(s.user), unlockedBadge())),
      menuRow({
        icon: 'log-out',
        label: 'Sign out',
        onClick: () => {
          o.closeMenu();
          void signOutWithToast();
        },
      }),
    );
  });
  return root;
}
