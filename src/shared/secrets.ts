// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

/** The longest name, source and secret that can be kept (the update's caps, see `secretUpdateRequestSchema`). */
export const MAX_SECRET_NAME_CHARS = 200;
export const MAX_SECRET_SOURCE_CHARS = 2048;
export const MAX_SECRET_VALUE_CHARS = 1024;
/** The longest element description a page may report (`tabSecrets.ts` builds it; it's a CSS selector). */
export const MAX_SECRET_ELEMENT_CHARS = 512;

/**
 * Where a secret is kept for: the page's origin and path, without its query
 * or fragment (a login page's address often carries a one-time token or a
 * redirect there, which would only make the same page look like another).
 * @param url The page's address.
 * @returns The source, or `null` for anything but an http(s) address.
 */
export function secretSourceOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * The origin a source belongs to: what decides which pages a secret is filled into.
 * @param source A secret's source (or any http(s) address).
 * @returns `https://host[:port]`, or `null` for anything but an http(s) address.
 */
export function secretOriginOf(source: string): string | null {
  try {
    const parsed = new URL(source);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * The names a login's secrets start with in the save prompt: the site's
 * domain (without a leading `www.`), then what each one is.
 * @param url The page the login was typed into.
 * @returns `example.com - Username` and `example.com - Password`.
 */
export function defaultSecretNames(url: string): { readonly username: string; readonly password: string } {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '') || url;
  } catch {
    // Not an address: the text itself stands in for the domain.
  }
  return { username: `${host} - Username`, password: `${host} - Password` };
}
