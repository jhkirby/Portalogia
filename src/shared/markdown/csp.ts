// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/**
 * The content-security-policy of a Markdown tab's page (`markdown.html`).
 *
 * A note is untrusted text — one downloaded from anywhere can hold raw HTML —
 * and its page can run code blocks and write the note back. The page
 * sanitizes what it renders, and this is the second wall: nothing but the
 * app's own script runs, nothing can be fetched or connected to, and a
 * picture may only come from the page itself or `data:` — a note's own
 * images, and web pictures the user clicked to load, are both read by main.
 * No web address loads by itself (an `<img>` or a CSS `url()`), so opening a
 * note can't tell anyone it was opened.
 *
 * The dev server's page needs inline script (React Fast Refresh's preamble)
 * and a websocket back to itself; the packaged build has neither.
 * @param isDev Whether the page is served by the Vite dev server.
 */
export function buildMarkdownCsp(isDev: boolean): string {
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
  const connectSrc = isDev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'none'";
  return [
    "default-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    connectSrc,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
