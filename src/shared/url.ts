// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { NORTHSTAR_SCHEME, SEARCH_URL_TEMPLATE } from '@shared/constants';

/** Schemes a tab is ever allowed to navigate to. Everything else is refused. */
const ALLOWED_NAVIGATION_SCHEMES = new Set(['http:', 'https:', 'about:', `${NORTHSTAR_SCHEME}:`]);

/**
 * Builds the candidate URL `normalizeUrlOrSearch`/`looksLikeUrl` would
 * navigate to for some free-text input, adding a `https://` prefix first if
 * no scheme was typed. Doesn't validate it — callers do that.
 * @param trimmed Already-trimmed address bar text.
 */
function buildCandidateUrl(trimmed: string): string {
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  return hasScheme ? trimmed : `https://${trimmed}`;
}

/**
 * Decides whether free-text input should be treated as a URL to navigate to
 * (true) or a search query (false). Northstar's own `northstar:` pages always count
 * as a URL; anything else must parse and have a host that looks real
 * (a dot-separated domain, or `localhost`).
 * @param input Raw text typed into the address bar.
 */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const url = new URL(buildCandidateUrl(trimmed));
    if (url.protocol === `${NORTHSTAR_SCHEME}:`) {
      return true;
    }
    return url.hostname === 'localhost' || /\.[a-z]{2,}$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Turns free-text address bar input into a navigable URL: passes through
 * anything `looksLikeUrl` accepts (adding a `https://` prefix first if no
 * scheme was typed), and falls back to a search query for anything that
 * doesn't look like a host. Pure and deterministic so it can be unit-tested
 * without Electron.
 * @param input Raw text typed into the address bar.
 * @returns A URL string safe to pass to `navigate`.
 */
export function normalizeUrlOrSearch(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return 'about:blank';
  }

  if (looksLikeUrl(trimmed)) {
    return new URL(buildCandidateUrl(trimmed)).toString();
  }

  return `${SEARCH_URL_TEMPLATE}${encodeURIComponent(trimmed)}`;
}

/**
 * Re-validates a URL a tab is about to be told to load. Called on the main
 * process side of the IPC boundary too, since the renderer is treated as
 * untrusted — a compromised renderer must not be able to make a tab load a
 * `file:` or `javascript:` URL.
 * @param url The URL to check.
 * @returns True if the URL's scheme is one tabs are allowed to load.
 */
export function isNavigableUrl(url: string): boolean {
  try {
    return ALLOWED_NAVIGATION_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
