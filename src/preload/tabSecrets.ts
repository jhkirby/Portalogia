// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { ipcRenderer } from 'electron';
import type { CapturedLogin, CapturedSecretField, SecretFillPayload } from '@shared/ipc-contract';

// Saving and filling in a web page's logins. Runs in the page's isolated preload world: the page itself never sees
// any of this, nor the channels. Main decides which site a login is for from the tab, never from what's sent here.
//
// Channel names inlined as literals — see `tabZoom.ts` for why. `SecretsController` (main) uses the same strings.
const TabSecretsCaptured = 'tab-secrets:captured';
const TabSecretsFill = 'tab-secrets:fill';

/** Caps matching `capturedLoginSchema`'s: anything longer isn't sent at all. */
const MAX_VALUE_CHARS = 1024;
const MAX_ELEMENT_CHARS = 512;

/** How long after the page is ready its boxes are still watched for, to fill a login form a script draws late. */
const FILL_WATCH_MS = 15_000;

/** Input types a username is typed into. */
const USERNAME_TYPES = new Set(['text', 'email', 'tel', '']);

/** What was last reported, so one login sent by a click and then a submit is offered once. */
let lastReported = '';

// ── Finding the boxes ────────────────────────────────────────────────────

/** Whether an element is a text box this can read or fill. Checked by tag, not `instanceof`, as `tabEditableFocus.ts` explains. */
function isInput(element: Element | null): element is HTMLInputElement {
  return element?.tagName === 'INPUT';
}

/** Whether a box is one a password goes in: a password box, or one marked as holding a password (shown as text by an eye button). */
function isPasswordBox(input: HTMLInputElement): boolean {
  const autocomplete = input.autocomplete.toLowerCase();
  return input.type === 'password' || autocomplete === 'current-password' || autocomplete === 'new-password';
}

/** Whether a box is shown at all: a hidden one is a page's own bookkeeping, not something typed in. */
function isShown(input: HTMLInputElement): boolean {
  return input.type !== 'hidden' && input.getClientRects().length > 0;
}

/**
 * The password box a login is being sent with: the last filled one in the
 * form (on a change-password form, the new password comes after the current
 * one), or on the whole page when the button isn't in a form at all.
 * @param scope The form, or the page.
 */
function filledPasswordIn(scope: ParentNode): HTMLInputElement | null {
  const boxes = Array.from(scope.querySelectorAll('input')).filter(
    (input) => isPasswordBox(input) && isShown(input) && input.value.length > 0,
  );
  return boxes[boxes.length - 1] ?? null;
}

/**
 * The username typed with a password: the last filled text or email box before it in its form (or on the page), or
 * failing that one the page marks as the username.
 * @param password The password box.
 */
function usernameFor(password: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = password.form ?? document;
  const before = Array.from(scope.querySelectorAll('input')).filter(
    (input) =>
      input !== password &&
      !isPasswordBox(input) &&
      USERNAME_TYPES.has(input.type) &&
      isShown(input) &&
      input.value.trim().length > 0 &&
      Boolean(input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  const marked = document.querySelector<HTMLInputElement>('input[autocomplete~="username"]');
  return before[before.length - 1] ?? (marked && marked.value.trim() ? marked : null);
}

/** Whether a selector finds exactly this element. */
function findsOnly(selector: string, element: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === element;
  } catch {
    return false;
  }
}

/** Whether an id looks made up afresh on each load (`:r3:`, `input-8231`), and so can't find the box next time. */
function looksGenerated(id: string): boolean {
  return /[:]|\d{3,}/.test(id);
}

/**
 * A CSS selector that finds a box again on the next visit — what the Secrets
 * table shows as its Element, and what filling looks for. Its name first
 * (the most stable), then its id unless that looks generated, then what the
 * page marks it as, and failing those its place in the page.
 * @param input The box.
 */
function selectorFor(input: HTMLInputElement): string {
  const quoted = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;
  const candidates = [
    input.name ? `input[name=${quoted(input.name)}]` : null,
    input.id && !looksGenerated(input.id) ? `input#${CSS.escape(input.id)}` : null,
    input.autocomplete && !['on', 'off'].includes(input.autocomplete) ? `input[autocomplete=${quoted(input.autocomplete)}]` : null,
    input.type === 'password' ? 'input[type="password"]' : null,
  ];
  for (const candidate of candidates) {
    if (candidate && findsOnly(candidate, input)) {
      return candidate;
    }
  }
  // Its place: each step up to the page's body (or the nearest ancestor with a usable id), by its position there.
  const steps: string[] = [];
  for (let element: Element | null = input; element && element !== document.body; element = element.parentElement) {
    if (element !== input && element.id && !looksGenerated(element.id) && findsOnly(`#${CSS.escape(element.id)}`, element)) {
      steps.unshift(`#${CSS.escape(element.id)}`);
      break;
    }
    const index = element.parentElement ? Array.from(element.parentElement.children).indexOf(element) + 1 : 1;
    steps.unshift(`${element.tagName.toLowerCase()}:nth-child(${index})`);
  }
  return steps.join(' > ');
}

// ── Saving ───────────────────────────────────────────────────────────────

/** A box's value and selector as main takes them, or `null` if either is too long to send. */
function fieldOf(input: HTMLInputElement): CapturedSecretField | null {
  const element = selectorFor(input);
  const value = input.value;
  return value.length > 0 && value.length <= MAX_VALUE_CHARS && element.length > 0 && element.length <= MAX_ELEMENT_CHARS
    ? { value, element }
    : null;
}

/**
 * Tells main a login is being sent, if a password was typed: it offers to save it.
 * @param scope Where the login is: the form being sent, or the page.
 */
function reportLogin(scope: ParentNode): void {
  const passwordBox = filledPasswordIn(scope);
  const password = passwordBox ? fieldOf(passwordBox) : null;
  if (!passwordBox || !password) {
    return;
  }
  const usernameBox = usernameFor(passwordBox);
  const login: CapturedLogin = { username: usernameBox ? fieldOf(usernameBox) : null, password };
  const key = JSON.stringify(login);
  if (key === lastReported) {
    return;
  }
  lastReported = key;
  ipcRenderer.send(TabSecretsCaptured, login);
}

/** Whether a click is on something that sends a form: a submit button, or a button-like element standing in for one. */
function isSendingControl(target: Element): boolean {
  const control = target.closest('button, input[type="submit"], input[type="image"], [role="button"]');
  if (!control) {
    return false;
  }
  // A plain `type="button"` inside a form is usually an eye toggle or a "forgot password" link, not the send.
  return !(control.tagName === 'BUTTON' && (control as HTMLButtonElement).type === 'button' && (control as HTMLButtonElement).form);
}

// Capture phase, so a page's own handlers (which may navigate away at once) can't stop it being seen first.
window.addEventListener('submit', (event) => {
  if (event.target instanceof HTMLFormElement) {
    reportLogin(event.target);
  }
}, true);

// Many logins never send a form: a script reads the boxes when a button is clicked.
window.addEventListener('click', (event) => {
  const target = event.target;
  if (target instanceof Element && isSendingControl(target)) {
    const form = target.closest('form');
    reportLogin(form ?? document);
  }
}, true);

// Enter in a box sends a login too, form or no form.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && isInput(target)) {
    reportLogin(target.form ?? document);
  }
}, true);

// ── Filling ──────────────────────────────────────────────────────────────

/**
 * Puts a value in a box the way typing would, so a page's own script sees it: through the input's own value setter
 * (a framework like React watches the box's value property and would otherwise miss it), then `input` and `change`.
 * @param input The box.
 * @param value What goes in it.
 */
function fillBox(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The secrets waiting to be filled in, by selector; each is let go once filled. */
const pendingFills = new Map<string, string>();

/** Fills every box still waiting whose element is on the page now, if it's still empty: what's typed is never overwritten. */
function fillWaiting(): void {
  for (const [selector, value] of pendingFills) {
    let element: Element | null = null;
    try {
      element = document.querySelector(selector);
    } catch {
      pendingFills.delete(selector);
      continue;
    }
    if (isInput(element) && !element.disabled && !element.readOnly) {
      if (element.value === '') {
        fillBox(element, value);
      }
      pendingFills.delete(selector);
    }
  }
}

ipcRenderer.on(TabSecretsFill, (_event, payload: SecretFillPayload) => {
  // Sent for the origin main saw; the page may have moved on since.
  if (payload.origin !== window.location.origin) {
    return;
  }
  for (const { element, value } of payload.fills) {
    pendingFills.set(element, value);
  }
  fillWaiting();
  if (pendingFills.size === 0) {
    return;
  }
  // A login form drawn by a script after the page is ready: fill it as it appears, for a while.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fillWaiting();
      if (pendingFills.size === 0) {
        observer.disconnect();
      }
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => {
    observer.disconnect();
    pendingFills.clear();
  }, FILL_WATCH_MS);
});
