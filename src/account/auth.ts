/**
 * Optional sign-in with Firebase Auth: Google (pop-up, with a redirect fallback) or email and password.
 *
 * Firebase loads lazily, with dynamic import(), the first time someone opens the sign-in UI or calls ready().
 * People who signed in before on this device also load it at startup, so their header shows the account.
 * Guests who never sign in never download it.
 *
 * While firebase-config.ts holds no config, `configured` is false and every call resolves to a
 * "Sign-in is not configured yet." error.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Auth, AuthProvider, User } from 'firebase/auth';
import { firebaseConfig } from './firebase-config';

export interface AccountUser {
  readonly uid: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly photoURL: string | null;
}

export interface AuthState {
  /** False until we know whether someone is signed in. */
  readonly ready: boolean;
  readonly user: AccountUser | null;
  /** False while src/account/firebase-config.ts has no config. */
  readonly configured: boolean;
  /** The last sign-in problem, ready to show. Empty once an attempt works. */
  readonly error: string;
}

export interface AuthResult {
  ok: boolean;
  /** What went wrong, in plain words. */
  error?: string;
  /** A note to show on success, for example after a reset link is sent. */
  message?: string;
}

export const NOT_CONFIGURED = 'Sign-in is not configured yet.';
export const MIN_PASSWORD = 8;

const LOAD_FAILED = "Sign-in couldn't load. Check your connection and try again.";
const BAD_EMAIL = "That email address doesn't look right.";
const REDIRECT_UNFINISHED = "Google sign-in didn't finish. Allow pop-ups for this site, then try again.";
export const SIGNED_IN_MESSAGE = 'Signed in. BETA features are unlocked.';

/** Set while this device has a signed-in session, so the next visit loads Firebase to restore it. */
const SIGNED_IN_KEY = 'm2d.signedIn';
/** Set (for this tab only) just before a redirect sign-in leaves the page. */
const REDIRECT_KEY = 'm2d.signInRedirect';
/** Never leave the header waiting forever if Firebase stalls. */
const READY_TIMEOUT_MS = 10_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ================================================================ state */

let state: AuthState = Object.freeze({ ready: false, user: null, configured: firebaseConfig !== null, error: '' });
const listeners = new Set<(s: AuthState) => void>();

function update(patch: Partial<AuthState>): void {
  state = Object.freeze({ ...state, ...patch });
  for (const fn of [...listeners]) {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  }
}

/** The current sign-in state (a frozen snapshot). */
export function getAuthState(): AuthState {
  return state;
}

/** Calls `cb` with the new state whenever it changes (not right away). Returns an unsubscribe function. */
export function onAuthChange(cb: (s: AuthState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/*
 * Dev server only (Vite strips this from builds): preview the signed-in UI and unlocked BETA features
 * before Firebase is configured. In the browser console:
 *   __m2dPreviewSignIn({ email: 'ada@example.com', displayName: 'Ada' })   // signed in
 *   __m2dPreviewSignIn(null)                                                // signed out
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window, {
    __m2dPreviewSignIn(user: Partial<AccountUser> | null) {
      const preview = user ? Object.freeze({ uid: 'preview', displayName: null, email: null, photoURL: null, ...user }) : null;
      update({ ready: true, user: preview });
    },
  });
}

/* ================================================================ storage */

function stored(store: 'local' | 'session', key: string): string | null {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function store(store: 'local' | 'session', key: string, on: boolean): void {
  try {
    const s = store === 'local' ? localStorage : sessionStorage;
    if (on) s.setItem(key, '1');
    else s.removeItem(key);
  } catch {
    /* no storage: sign-in still works for this visit */
  }
}

const rememberSignedIn = (on: boolean) => store('local', SIGNED_IN_KEY, on);

/* ================================================================ Firebase, loaded on demand */

type AuthModule = typeof import('firebase/auth');

interface Api {
  app: FirebaseApp;
  auth: Auth;
  mod: AuthModule;
}

let api: Api | null = null;
let apiPromise: Promise<Api> | null = null;

function loadApi(): Promise<Api> {
  const config = firebaseConfig;
  if (!config) return Promise.reject(new Error(NOT_CONFIGURED));
  apiPromise ??= Promise.all([import('firebase/app'), import('firebase/auth')])
    .then(([appMod, mod]) => {
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config);
      const auth = mod.getAuth(app);
      // Google's sign-in window and Firebase's emails follow the browser's language.
      mod.useDeviceLanguage(auth);
      api = { app, auth, mod };
      return api;
    })
    .catch((err: unknown) => {
      apiPromise = null;
      throw err;
    });
  return apiPromise;
}

function toAccountUser(u: User): AccountUser {
  const fromProvider = <K extends 'email' | 'displayName' | 'photoURL'>(k: K) => u.providerData.find((p) => p[k])?.[k] ?? null;
  return Object.freeze({
    uid: u.uid,
    displayName: u.displayName ?? fromProvider('displayName'),
    email: u.email ?? fromProvider('email'),
    photoURL: u.photoURL ?? fromProvider('photoURL'),
  });
}

function applyUser(u: User | null): void {
  rememberSignedIn(u !== null);
  update({ ready: true, user: u ? toAccountUser(u) : null });
}

let watching: Promise<AuthResult> | null = null;

/** Loads Firebase, follows the sign-in state from then on, and finishes a redirect sign-in. */
function watch(): Promise<AuthResult> {
  watching ??= (async (): Promise<AuthResult> => {
    let a: Api;
    try {
      a = await loadApi();
    } catch {
      watching = null;
      update({ ready: true });
      return fail(LOAD_FAILED);
    }
    const redirected = stored('session', REDIRECT_KEY) === '1';
    store('session', REDIRECT_KEY, false);

    const first = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!state.ready) update({ ready: true });
        resolve();
      }, READY_TIMEOUT_MS);
      a.mod.onAuthStateChanged(
        a.auth,
        (user) => {
          clearTimeout(timer);
          applyUser(user);
          resolve();
        },
        () => {
          clearTimeout(timer);
          if (!state.ready) update({ ready: true });
          resolve();
        },
      );
    });
    if (!redirected) {
      await first;
      return { ok: true };
    }
    // Coming back from a redirect sign-in: report how it went, without waiting forever.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const problem = await Promise.race([
      a.mod.getRedirectResult(a.auth).then(
        () => '',
        (err: unknown) => errorText(err),
      ),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(''), READY_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    await first;
    if (problem) return fail(problem);
    // Browsers that partition storage can drop the result on the way back, so check who is signed in.
    return a.auth.currentUser ? done(SIGNED_IN_MESSAGE) : fail(REDIRECT_UNFINISHED);
  })();
  return watching;
}

let initPromise: Promise<AuthResult> | null = null;

/**
 * Call once at startup (the header does; later calls share the first result). Restores the session of
 * someone who signed in before on this device; otherwise it settles at once without loading Firebase.
 * The result reports how a redirect sign-in went, if the page is coming back from one.
 */
export function initAuth(): Promise<AuthResult> {
  initPromise ??= (async (): Promise<AuthResult> => {
    if (!firebaseConfig) {
      if (!state.ready) update({ ready: true });
      return { ok: true };
    }
    if (watching || stored('local', SIGNED_IN_KEY) === '1' || stored('session', REDIRECT_KEY) === '1') return watch();
    update({ ready: true });
    return { ok: true };
  })();
  return initPromise;
}

/** Loads Firebase if needed and resolves once the sign-in state is known. Resolves at once when not configured. */
export async function ready(): Promise<AuthState> {
  if (firebaseConfig) await watch();
  else if (!state.ready) update({ ready: true });
  return state;
}

/** The shared FirebaseApp, for other Firebase services (Firestore for cloud projects). Null when not configured. */
export async function getFirebaseApp(): Promise<FirebaseApp | null> {
  if (!firebaseConfig) return null;
  return (await loadApi()).app;
}

/* ================================================================ actions */

function done(message?: string): AuthResult {
  if (state.error) update({ error: '' });
  return message ? { ok: true, message } : { ok: true };
}

function fail(error: string): AuthResult {
  update({ error });
  return { ok: false, error };
}

/** Firebase, loaded and followed. Null if it could not load. */
async function getApi(): Promise<Api | null> {
  try {
    const a = api ?? (await loadApi());
    void watch();
    return a;
  } catch {
    return null;
  }
}

function googleProvider(mod: AuthModule): AuthProvider {
  const provider = new mod.GoogleAuthProvider();
  // Let people choose which Google account to use, which matters on shared computers.
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

/**
 * Google sign-in in a pop-up. If the browser blocks the pop-up, the page redirects to Google instead and
 * initAuth() reports the outcome when it comes back.
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  if (!firebaseConfig) return fail(NOT_CONFIGURED);
  // No await before the pop-up opens when Firebase is already loaded, so the click still counts as
  // the user's gesture. The sign-in sheet preloads Firebase with ready() for this reason.
  let a = api;
  if (!a) {
    try {
      a = await loadApi();
    } catch {
      return fail(LOAD_FAILED);
    }
  }
  void watch();
  const provider = googleProvider(a.mod);
  try {
    await a.mod.signInWithPopup(a.auth, provider);
    rememberSignedIn(true);
    return done();
  } catch (err) {
    if (codeOf(err) !== 'auth/popup-blocked') return fail(errorText(err));
  }
  try {
    rememberSignedIn(true);
    store('session', REDIRECT_KEY, true);
    await a.mod.signInWithRedirect(a.auth, provider);
    return { ok: true, message: 'Taking you to Google to sign in.' };
  } catch (err) {
    store('session', REDIRECT_KEY, false);
    rememberSignedIn(state.user !== null);
    return fail(errorText(err));
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  if (!firebaseConfig) return fail(NOT_CONFIGURED);
  const e = email.trim();
  if (!e || !password) return fail('Enter your email and password.');
  if (!EMAIL_RE.test(e)) return fail(BAD_EMAIL);
  const a = await getApi();
  if (!a) return fail(LOAD_FAILED);
  try {
    await a.mod.signInWithEmailAndPassword(a.auth, e, password);
    rememberSignedIn(true);
    return done();
  } catch (err) {
    return fail(errorText(err));
  }
}

export async function createAccount(email: string, password: string): Promise<AuthResult> {
  if (!firebaseConfig) return fail(NOT_CONFIGURED);
  const e = email.trim();
  if (!e) return fail('Enter your email.');
  if (!EMAIL_RE.test(e)) return fail(BAD_EMAIL);
  if (password.length < MIN_PASSWORD) return fail(`Use at least ${MIN_PASSWORD} characters for your password.`);
  const a = await getApi();
  if (!a) return fail(LOAD_FAILED);
  try {
    await a.mod.createUserWithEmailAndPassword(a.auth, e, password);
    rememberSignedIn(true);
    return done();
  } catch (err) {
    return fail(errorText(err));
  }
}

/** Emails a reset link. The reply is the same whether or not the address has an account. */
export async function resetPassword(email: string): Promise<AuthResult> {
  if (!firebaseConfig) return fail(NOT_CONFIGURED);
  const e = email.trim();
  if (!e) return fail('Enter the email you signed up with.');
  if (!EMAIL_RE.test(e)) return fail(BAD_EMAIL);
  const a = await getApi();
  if (!a) return fail(LOAD_FAILED);
  try {
    await a.mod.sendPasswordResetEmail(a.auth, e);
  } catch (err) {
    // Saying "no such account" would tell anyone which emails have accounts.
    if (codeOf(err) !== 'auth/user-not-found') return fail(errorText(err));
  }
  return done(`If an account uses ${e}, a reset link is on its way. Check your inbox and spam folder.`);
}

export async function signOut(): Promise<AuthResult> {
  if (!firebaseConfig) return fail(NOT_CONFIGURED);
  rememberSignedIn(false);
  const a = api ?? (apiPromise ? await apiPromise.catch(() => null) : null);
  if (!a) {
    // Firebase never loaded, so nobody is signed in on this page.
    if (state.user) update({ user: null });
    return done();
  }
  try {
    await a.mod.signOut(a.auth);
    return done();
  } catch (err) {
    rememberSignedIn(state.user !== null);
    return fail(errorText(err));
  }
}

/* ================================================================ errors */

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/** Firebase error codes in plain words. */
export function errorText(err: unknown): string {
  switch (codeOf(err)) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/missing-password':
      return 'Enter your password.';
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return BAD_EMAIL;
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead, or reset the password.';
    case 'auth/account-exists-with-different-credential':
      return 'That email already has an account with a password. Sign in with your email and password.';
    case 'auth/weak-password':
      return `Use at least ${MIN_PASSWORD} characters for your password.`;
    case 'auth/password-does-not-meet-requirements':
      return 'Choose a stronger password: longer, with a mix of letters, numbers and symbols.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/user-disabled':
      return 'This account has been turned off.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google window closed before sign-in finished.';
    case 'auth/user-cancelled':
      return 'Sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/unauthorized-domain':
      return "Sign-in isn't set up for this web address yet.";
    case 'auth/operation-not-allowed':
      return "This sign-in method isn't turned on yet.";
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/configuration-not-found':
      return "Sign-in isn't set up correctly on this site yet.";
    case 'auth/network-request-failed':
      return "Can't reach the sign-in service. Check your connection and try again.";
    default:
      return "That didn't work. Try again.";
  }
}
