// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/**
 * The content-security-policy of the app's own pages — the chrome window and
 * every overlay, terminal, History and PDF page. (The Markdown page has its
 * own, stricter one: see `markdown/csp.ts`.)
 *
 * None of these pages renders untrusted markup, but the PDF page parses
 * untrusted files and every page has a privileged preload API, so this is
 * the backstop: only the app's own script runs, and nothing is framed,
 * embedded or posted anywhere.
 *
 * - `img-src https:` — the chrome shows websites' favicons by their URL.
 * - `blob:` images and workers, `data:` fonts — pdf.js decodes into blobs and
 *   may hand a PDF's embedded fonts over as `data:` URLs.
 * - Dev only: inline script for React Fast Refresh's preamble.
 * @param isDev Whether the page is served by the Vite dev server.
 */
export function buildAppPageCsp(isDev: boolean): string {
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
