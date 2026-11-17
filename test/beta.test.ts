// @vitest-environment happy-dom
/**
 * The BETA gate and the sign-in state behind it, with Firebase mocked.
 * Each test re-imports the account modules, so every test starts signed out with fresh state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  providerData: never[];
}

const h = vi.hoisted(() => {
  const fb = {
    config: null as Record<string, string> | null,
    user: null as FakeUser | null,
    listeners: [] as ((user: FakeUser | null) => void)[],
  };
  const emit = (user: FakeUser | null) => {
    fb.user = user;
    for (const l of fb.listeners) l(user);
  };
  const makeUser = (email: string): FakeUser => ({ uid: `uid-${email}`, email, displayName: null, photoURL: null, providerData: [] });
  const authCode = (code: string) => Object.assign(new Error(code), { code });

  const app = {
    initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
    getApps: vi.fn(() => []),
    getApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  };
  const auth = {
    getAuth: vi.fn(() => ({
      get currentUser() {
        return fb.user;
      },
    })),
    useDeviceLanguage: vi.fn(),
    onAuthStateChanged: vi.fn((_auth: unknown, next: (user: FakeUser | null) => void) => {
      fb.listeners.push(next);
      // Firebase reports the restored session asynchronously.
      queueMicrotask(() => next(fb.user));
      return () => undefined;
    }),
    signInWithEmailAndPassword: vi.fn(async (_auth: unknown, email: string) => {
      const user = makeUser(email);
      emit(user);
      return { user };
    }),
    createUserWithEmailAndPassword: vi.fn(async (_auth: unknown, email: string) => {
      const user = makeUser(email);
      emit(user);
      return { user };
    }),
    signInWithPopup: vi.fn(async () => {
      const user = makeUser('grace@example.com');
      emit(user);
      return { user };
    }),
    signInWithRedirect: vi.fn(async () => undefined),
    getRedirectResult: vi.fn(async () => null),
    sendPasswordResetEmail: vi.fn(async () => undefined),
    signOut: vi.fn(async () => emit(null)),
    GoogleAuthProvider: class {
      setCustomParameters(): void {}
    },
  };
  const sheet = { openSignInSheet: vi.fn(async (_o?: { feature?: string }) => false) };
  return { fb, emit, makeUser, authCode, app, auth, sheet };
});

vi.mock('firebase/app', () => h.app);
vi.mock('firebase/auth', () => h.auth);
vi.mock('../src/account/firebase-config', () => ({
  get firebaseConfig() {
    return h.fb.config;
  },
}));
// The real sheet is DOM-heavy UI (checked in the browser); here it only reports how it was opened.
vi.mock('../src/account/signin-sheet', () => ({ openSignInSheet: h.sheet.openSignInSheet }));

const TEST_CONFIG = { apiKey: 'test-key', authDomain: 'test.firebaseapp.com', projectId: 'test', appId: '1:1:web:1' };
const PASSWORD = 'correct horse battery';

async function load() {
  const auth = await import('../src/account/auth');
  const beta = await import('../src/account/beta');
  const ui = await import('../src/ui/components');
  return { auth, beta, ui };
}

/** A toggle row ("In Color") wrapped in a gate and put on the page. */
function gatedToggle(beta: Awaited<ReturnType<typeof load>>['beta'], ui: Awaited<ReturnType<typeof load>>['ui']) {
  const control = ui.toggle({ label: 'In Color', value: false, onChange: () => undefined }).el;
  const gate = beta.betaGate(control, 'In Color');
  document.body.append(gate);
  return {
    control,
    gate,
    lock: gate.querySelector<HTMLButtonElement>('.beta-gate-lock')!,
    input: control.querySelector<HTMLInputElement>('input')!,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.fb.config = TEST_CONFIG;
  h.fb.user = null;
  h.fb.listeners = [];
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('with no Firebase config', () => {
  beforeEach(() => {
    h.fb.config = null;
  });

  it('reports not configured, keeps BETA locked and never loads Firebase', async () => {
    const { auth, beta } = await load();
    expect(auth.getAuthState().configured).toBe(false);
    expect(await auth.ready()).toMatchObject({ ready: true, configured: false, user: null });
    expect(beta.isBetaEnabled()).toBe(false);

    const calls = [
      () => auth.signInWithGoogle(),
      () => auth.signInWithEmail('ada@example.com', PASSWORD),
      () => auth.createAccount('ada@example.com', PASSWORD),
      () => auth.resetPassword('ada@example.com'),
      () => auth.signOut(),
    ];
    for (const call of calls) await expect(call()).resolves.toEqual({ ok: false, error: 'Sign-in is not configured yet.' });
    expect(auth.getAuthState().error).toBe(auth.NOT_CONFIGURED);
    expect(await auth.getFirebaseApp()).toBeNull();
    expect(h.app.initializeApp).not.toHaveBeenCalled();
    expect(h.auth.getAuth).not.toHaveBeenCalled();
  });

  it('a locked control opens the sign-in sheet and stays locked when nobody signs in', async () => {
    const { beta, ui } = await load();
    const { control, gate, lock } = gatedToggle(beta, ui);
    lock.click();
    await vi.waitFor(() => expect(h.sheet.openSignInSheet).toHaveBeenCalledWith({ feature: 'In Color' }));
    expect(gate.classList.contains('is-locked')).toBe(true);
    expect(control.hasAttribute('inert')).toBe(true);
    await expect(beta.requireBeta('In Color')).resolves.toBe(false);
  });
});

describe('with Firebase configured (mocked)', () => {
  it('signed out means locked', async () => {
    const { auth, beta, ui } = await load();
    await auth.ready();
    expect(auth.getAuthState()).toMatchObject({ ready: true, configured: true, user: null, error: '' });
    expect(beta.isBetaEnabled()).toBe(false);

    const { control, gate, lock } = gatedToggle(beta, ui);
    expect(gate.classList.contains('is-locked')).toBe(true);
    expect(control.hasAttribute('inert')).toBe(true);
    expect(lock.hidden).toBe(false);
    expect(lock.getAttribute('aria-label')).toBe('In Color is a BETA feature. Sign in (free) to use it.');
    // The badge sits in the toggle's label.
    expect(control.querySelector('.field-label .beta-badge')?.textContent).toBe('BETA');
  });

  it('signing in unlocks gates and notifies listeners; signing out locks them again', async () => {
    const { auth, beta, ui } = await load();
    await auth.ready();
    const { control, gate, lock } = gatedToggle(beta, ui);
    const betaChanges: boolean[] = [];
    const emails: (string | null)[] = [];
    beta.onBetaChange((on) => betaChanges.push(on));
    auth.onAuthChange((s) => emails.push(s.user?.email ?? null));

    await expect(auth.signInWithEmail('ada@example.com', PASSWORD)).resolves.toEqual({ ok: true });
    expect(beta.isBetaEnabled()).toBe(true);
    expect(betaChanges).toEqual([true]);
    expect(emails).toContain('ada@example.com');
    expect(auth.getAuthState().user).toMatchObject({ uid: 'uid-ada@example.com', email: 'ada@example.com' });
    expect(gate.classList.contains('is-locked')).toBe(false);
    expect(control.hasAttribute('inert')).toBe(false);
    expect(lock.hidden).toBe(true);
    expect(localStorage.getItem('m2d.signedIn')).toBe('1');

    await expect(auth.signOut()).resolves.toEqual({ ok: true });
    expect(betaChanges).toEqual([true, false]);
    expect(gate.classList.contains('is-locked')).toBe(true);
    expect(control.hasAttribute('inert')).toBe(true);
    expect(localStorage.getItem('m2d.signedIn')).toBeNull();
  });

  it('requireBeta resolves true once the person signs in from the sheet, and skips the sheet after that', async () => {
    const { auth, beta } = await load();
    h.sheet.openSignInSheet.mockImplementationOnce(async () => (await auth.signInWithEmail('ada@example.com', PASSWORD)).ok);
    await expect(beta.requireBeta('In Color')).resolves.toBe(true);
    expect(h.sheet.openSignInSheet).toHaveBeenCalledWith({ feature: 'In Color' });
    expect(beta.isBetaEnabled()).toBe(true);

    h.sheet.openSignInSheet.mockClear();
    await expect(beta.requireBeta('Line-art cleanup')).resolves.toBe(true);
    expect(h.sheet.openSignInSheet).not.toHaveBeenCalled();
  });

  it('requireBeta resolves false when the sheet closes without a sign-in', async () => {
    const { beta } = await load();
    await expect(beta.requireBeta('Super Enhanced 1080p')).resolves.toBe(false);
    expect(h.sheet.openSignInSheet).toHaveBeenCalledWith({ feature: 'Super Enhanced 1080p' });
    expect(beta.isBetaEnabled()).toBe(false);
  });

  it('clicking a locked control and signing in unlocks it and moves focus to it', async () => {
    const { auth, beta, ui } = await load();
    const { gate, input, lock } = gatedToggle(beta, ui);
    h.sheet.openSignInSheet.mockImplementationOnce(async () => (await auth.signInWithEmail('ada@example.com', PASSWORD)).ok);
    lock.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    expect(gate.classList.contains('is-locked')).toBe(false);
  });

  it('places the badge after a button control', async () => {
    const { beta, ui } = await load();
    const control = ui.button({ label: 'Crop and resize', icon: 'crop', variant: 'outline' });
    const gate = beta.betaGate(control, 'Crop and resize');
    expect(gate.classList.contains('beta-gate-inline')).toBe(true);
    expect(control.nextElementSibling?.classList.contains('beta-badge')).toBe(true);
  });

  it('betaBadge is the existing blue badge with the flask icon', async () => {
    const { beta } = await load();
    const b = beta.betaBadge();
    expect(b.classList.contains('badge')).toBe(true);
    expect(b.classList.contains('badge-blue')).toBe(true);
    expect(b.querySelector('svg.icon-flask')).not.toBeNull();
    expect(b.textContent).toBe('BETA');
  });

  it('guests settle at startup without downloading Firebase', async () => {
    const { auth } = await load();
    await expect(auth.initAuth()).resolves.toEqual({ ok: true });
    expect(auth.getAuthState()).toMatchObject({ ready: true, user: null });
    expect(h.app.initializeApp).not.toHaveBeenCalled();
  });

  it('restores the session of someone who signed in before on this device', async () => {
    localStorage.setItem('m2d.signedIn', '1');
    h.fb.user = h.makeUser('ada@example.com');
    const { auth, beta } = await load();
    expect(auth.getAuthState().ready).toBe(false);
    await expect(auth.initAuth()).resolves.toEqual({ ok: true });
    expect(h.app.initializeApp).toHaveBeenCalledWith(TEST_CONFIG);
    expect(beta.isBetaEnabled()).toBe(true);
  });

  it('falls back to a redirect when the browser blocks the Google pop-up', async () => {
    const { auth } = await load();
    h.auth.signInWithPopup.mockRejectedValueOnce(h.authCode('auth/popup-blocked'));
    const res = await auth.signInWithGoogle();
    expect(res.ok).toBe(true);
    expect(h.auth.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('m2d.signInRedirect')).toBe('1');
  });

  it('says so when a redirect sign-in comes back without a result', async () => {
    sessionStorage.setItem('m2d.signInRedirect', '1');
    const { auth } = await load();
    const res = await auth.initAuth();
    expect(res).toEqual({ ok: false, error: "Google sign-in didn't finish. Allow pop-ups for this site, then try again." });
    expect(sessionStorage.getItem('m2d.signInRedirect')).toBeNull();
    expect(auth.getAuthState().user).toBeNull();
  });

  it('turns Firebase errors and bad input into plain words', async () => {
    const { auth } = await load();
    h.auth.signInWithEmailAndPassword.mockRejectedValueOnce(h.authCode('auth/invalid-credential'));
    await expect(auth.signInWithEmail('ada@example.com', 'wrong password')).resolves.toEqual({ ok: false, error: 'Wrong email or password.' });
    expect(auth.getAuthState().error).toBe('Wrong email or password.');

    await expect(auth.createAccount('ada@example.com', 'short')).resolves.toEqual({
      ok: false,
      error: 'Use at least 8 characters for your password.',
    });
    expect(h.auth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    await expect(auth.signInWithEmail('not-an-email', PASSWORD)).resolves.toMatchObject({ ok: false, error: "That email address doesn't look right." });
    expect(auth.errorText(new Error('no code'))).toBe("That didn't work. Try again.");
  });

  it('answers a reset request the same way whether or not the email has an account', async () => {
    const { auth } = await load();
    const ok = await auth.resetPassword('ada@example.com');
    h.auth.sendPasswordResetEmail.mockRejectedValueOnce(h.authCode('auth/user-not-found'));
    const missing = await auth.resetPassword('nobody@example.com');
    expect(ok.ok && missing.ok).toBe(true);
    expect(missing.message).toBe('If an account uses nobody@example.com, a reset link is on its way. Check your inbox and spam folder.');
  });

  it('the header offers Sign in, then shows the account with BETA unlocked', async () => {
    const { auth } = await load();
    const { headerAccount } = await import('../src/account/account-ui');
    const header = headerAccount();
    document.body.append(header);
    await auth.initAuth();
    expect(header.querySelector('.account-signin')?.textContent).toBe('Sign in');

    await auth.signInWithEmail('ada@example.com', PASSWORD);
    const avatar = header.querySelector<HTMLButtonElement>('.account-avatar')!;
    expect(avatar.getAttribute('aria-label')).toBe('Account: ada@example.com');
    expect(avatar.textContent).toBe('A');
    avatar.click();
    const menu = header.querySelector<HTMLElement>('.account-menu')!;
    expect(menu.hidden).toBe(false);
    expect(menu.textContent).toContain('ada@example.com');
    expect(menu.textContent).toContain('BETA features unlocked');
    expect(menu.textContent).toContain('Sign out');
  });
});
