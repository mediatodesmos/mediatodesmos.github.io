/**
 * The sign-in sheet: Google, or email and password, with create-account and forgot-password states.
 * Built from the shared sheet(), button(), .input and icon set.
 */

import '../styles/account.css';
import { el, mount } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { button, iconButton, setPressed, sheet, toast, uid } from '../ui/components';
import {
  createAccount,
  getAuthState,
  MIN_PASSWORD,
  onAuthChange,
  ready,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  SIGNED_IN_MESSAGE,
  type AuthResult,
} from './auth';

export type SignInMode = 'signin' | 'create' | 'reset';

export interface SignInSheetOptions {
  /** The BETA feature the person reached for, named at the top of the sheet. */
  feature?: string;
  mode?: SignInMode;
}

interface ModeCopy {
  title: string;
  desc: string;
  submit: string;
  icon: IconName;
}

const ABOUT = 'Free, and only needed for BETA features.';

const MODES: Record<SignInMode, ModeCopy> = {
  signin: { title: 'Sign in', desc: ABOUT, submit: 'Sign in', icon: 'log-in' },
  create: { title: 'Create an account', desc: ABOUT, submit: 'Create account', icon: 'user' },
  reset: {
    title: 'Reset your password',
    desc: "Enter your account's email and we'll send you a link to choose a new password.",
    submit: 'Send reset link',
    icon: 'mail',
  },
};

const NOTE = 'BETA access is for signed-in users. Your projects stay on your device unless you turn on cloud projects.';

let current: { promise: Promise<boolean>; setFeature(feature?: string): void } | null = null;

/** Swap a button's leading icon for the spinner while it works. */
function setButtonBusy(btn: HTMLElement, busy: boolean, idleIcon: IconName | null): void {
  btn.querySelector(':scope > .icon')?.remove();
  const glyph = busy ? icon('spinner', { size: 16 }) : idleIcon ? icon(idleIcon, { size: 16 }) : null;
  if (glyph) btn.prepend(glyph);
  if (busy) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
}

function featureCallout(feature: string): HTMLElement {
  return el(
    'div',
    { class: 'signin-feature' },
    el('span', { class: 'signin-feature-icon' }, icon('flask', { size: 16 })),
    el(
      'p',
      { class: 'signin-feature-text' },
      el('strong', null, feature),
      ' is a BETA feature. ',
      el('span', { class: 'signin-feature-cta' }, 'Sign in (free) to use it.'),
    ),
  );
}

/**
 * Opens the sign-in sheet. Resolves when it closes: true if the person is signed in by then.
 * Signed-in people get true at once. Calling it while the sheet is open reuses that sheet.
 */
export function openSignInSheet(o: SignInSheetOptions = {}): Promise<boolean> {
  if (getAuthState().user) return Promise.resolve(true);
  if (current) {
    if (o.feature) current.setFeature(o.feature);
    return current.promise;
  }

  const configured = getAuthState().configured;
  let mode: SignInMode = o.mode ?? 'signin';
  let busy = false;
  let signedIn = false;

  /* Top: the feature that sent them here, and the not-configured notice. */
  const featureSlot = el('div', { class: 'signin-feature-slot' });
  const setFeature = (feature?: string) => mount(featureSlot, feature ? featureCallout(feature) : null);
  setFeature(o.feature);

  const notice = configured
    ? null
    : el(
        'div',
        { class: 'signin-notice', attrs: { role: 'note' } },
        icon('info', { size: 16 }),
        el(
          'div',
          null,
          el('p', { class: 'signin-notice-title' }, 'Sign-in is not configured yet'),
          el(
            'p',
            { class: 'signin-notice-text' },
            "This site hasn't been connected to its sign-in service yet, so BETA features stay locked for now. Everything else works without an account.",
          ),
        ),
      );

  /* Google */
  const googleBtn = button({ label: 'Continue with Google', variant: 'card', size: 'lg', class: 'signin-google', disabled: !configured });
  const providers = el('div', { class: 'signin-providers' }, googleBtn);
  const orRule = el('p', { class: 'signin-or' }, 'or');

  /* Email and password */
  const emailId = uid('signin-email');
  const pwId = uid('signin-pw');
  const hintId = uid('signin-pw-hint');
  const msgId = uid('signin-msg');

  const emailInput = el('input', {
    class: 'input',
    id: emailId,
    type: 'email',
    name: 'email',
    placeholder: 'you@example.com',
    disabled: !configured,
    attrs: { autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false' },
  });
  const pwInput = el('input', {
    class: 'input',
    id: pwId,
    type: 'password',
    name: 'password',
    disabled: !configured,
    attrs: { autocomplete: 'current-password' },
  });
  const reveal = iconButton({
    icon: 'eye',
    title: 'Show password',
    size: 'sm',
    active: false,
    class: 'signin-reveal',
    disabled: !configured,
    onClick: () => {
      const show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      setPressed(reveal, show);
      reveal.replaceChildren(icon(show ? 'eye-off' : 'eye', { size: 14 }));
    },
  });
  const forgotBtn = el('button', { class: 'signin-link', type: 'button' }, 'Forgot password?');
  const pwHint = el('p', { class: 'field-hint', id: hintId }, `At least ${MIN_PASSWORD} characters.`);

  const emailField = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field-label', htmlFor: emailId }, 'Email'),
    el('div', { class: 'signin-input' }, icon('mail', { size: 16 }), emailInput),
  );
  const pwField = el(
    'div',
    { class: 'field' },
    el('div', { class: 'field-row' }, el('label', { class: 'field-label', htmlFor: pwId }, 'Password'), forgotBtn),
    el('div', { class: 'signin-input has-reveal' }, icon('key', { size: 16 }), pwInput, reveal),
    pwHint,
  );

  const msg = el('p', { class: 'signin-msg', id: msgId, attrs: { 'aria-live': 'polite' } });
  const submitBtn = button({ label: MODES[mode].submit, icon: MODES[mode].icon, variant: 'primary', size: 'lg', class: 'signin-submit', disabled: !configured });
  (submitBtn as HTMLButtonElement).type = 'submit';

  const form = el('form', { class: 'signin-form', noValidate: true }, emailField, pwField, msg, submitBtn);

  /* Switching between sign in, create account and reset */
  const switchRow = el('p', { class: 'signin-switch' });
  const modeLink = (label: string, to: SignInMode, glyph?: IconName) => {
    const b = el('button', { class: 'signin-link', type: 'button' }, glyph && icon(glyph, { size: 14 }), label);
    b.addEventListener('click', () => setMode(to));
    return b;
  };

  const note = el('p', { class: 'signin-note' }, icon('lock', { size: 14 }), el('span', null, NOTE));

  const content = el('div', { class: 'signin' }, featureSlot, notice, providers, orRule, form, switchRow, note);

  const sh = sheet({
    title: MODES[mode].title,
    description: MODES[mode].desc,
    content,
    width: 420,
    onClose: () => {
      off();
      current = null;
      resolveOpen(getAuthState().user !== null);
    },
  });
  const titleEl = sh.el.querySelector<HTMLElement>('.sheet-title');
  const descEl = sh.el.querySelector<HTMLElement>('.sheet-desc');

  /* Messages */
  const clearMsg = () => {
    msg.className = 'signin-msg';
    msg.replaceChildren();
    for (const input of [emailInput, pwInput]) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
    if (mode === 'create') pwInput.setAttribute('aria-describedby', hintId);
  };
  const showMsg = (text: string, kind: 'error' | 'ok') => {
    msg.className = `signin-msg is-${kind}`;
    msg.replaceChildren(icon(kind === 'error' ? 'alert' : 'check', { size: 16 }), el('span', null, text));
    if (kind === 'error') {
      // Point the field that most likely needs fixing at the message.
      const bad = /password/i.test(text) && mode !== 'reset' ? pwInput : emailInput;
      bad.setAttribute('aria-invalid', 'true');
      bad.setAttribute('aria-describedby', mode === 'create' && bad === pwInput ? `${msgId} ${hintId}` : msgId);
    }
  };

  /* Modes */
  function setMode(next: SignInMode, focus = true): void {
    mode = next;
    const copy = MODES[next];
    if (titleEl) titleEl.textContent = copy.title;
    if (descEl) descEl.textContent = copy.desc;
    providers.hidden = next === 'reset';
    orRule.hidden = next === 'reset';
    pwField.hidden = next === 'reset';
    forgotBtn.hidden = next !== 'signin';
    pwHint.hidden = next !== 'create';
    pwInput.setAttribute('autocomplete', next === 'create' ? 'new-password' : 'current-password');
    submitBtn.querySelector('.btn-label')!.textContent = copy.submit;
    setButtonBusy(submitBtn, false, copy.icon);
    if (next === 'signin') mount(switchRow, 'New here? ', modeLink('Create an account', 'create'));
    else if (next === 'create') mount(switchRow, 'Have an account? ', modeLink('Sign in', 'signin'));
    else mount(switchRow, modeLink('Back to sign in', 'signin', 'arrow-left'));
    clearMsg();
    if (focus && configured) emailInput.focus();
  }
  forgotBtn.addEventListener('click', () => setMode('reset'));

  /* Working */
  const controls = [emailInput, pwInput, reveal, googleBtn as HTMLButtonElement, submitBtn as HTMLButtonElement];
  const setBusy = (on: boolean, btn: HTMLElement, idleIcon: IconName | null) => {
    busy = on;
    for (const c of controls) c.disabled = on || !configured;
    // No switching between sign in, create account and reset while a request is out.
    forgotBtn.disabled = on;
    switchRow.toggleAttribute('inert', on);
    setButtonBusy(btn, on, idleIcon);
  };

  const finish = (res: AuthResult) => {
    if (signedIn) return;
    if (!res.ok) showMsg(res.error ?? "That didn't work. Try again.", 'error');
    else if (res.message && mode === 'reset') showMsg(res.message, 'ok');
  };

  googleBtn.addEventListener('click', () => {
    if (busy || !configured) return;
    clearMsg();
    setBusy(true, googleBtn, null);
    // Firebase was preloaded when the sheet opened, so signInWithGoogle opens the pop-up before its
    // first await and the browser still counts this click as the gesture that allows it.
    void signInWithGoogle().then((res) => {
      setBusy(false, googleBtn, null);
      finish(res);
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy || !configured) return;
    clearMsg();
    const which = mode;
    setBusy(true, submitBtn, MODES[which].icon);
    const run =
      which === 'signin'
        ? signInWithEmail(emailInput.value, pwInput.value)
        : which === 'create'
          ? createAccount(emailInput.value, pwInput.value)
          : resetPassword(emailInput.value);
    void run.then((res) => {
      setBusy(false, submitBtn, MODES[mode].icon);
      finish(res);
    });
  });

  /* Signing in anywhere (this sheet, a pop-up, another tab) closes the sheet. */
  const off = onAuthChange((s) => {
    if (!s.user || signedIn) return;
    signedIn = true;
    toast(SIGNED_IN_MESSAGE, { tone: 'success' });
    sh.close();
  });

  let resolveOpen: (signedIn: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    resolveOpen = resolve;
  });
  current = { promise, setFeature };

  setMode(mode, false);
  sh.open();
  // Load Firebase now, so "Continue with Google" can open its pop-up straight from the click.
  if (configured) void ready();
  return promise;
}
