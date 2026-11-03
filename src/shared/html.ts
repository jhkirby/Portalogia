// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

/**
 * Escapes text for safe interpolation into HTML markup. Used anywhere a
 * string we don't control (a page's title, a failed URL, a bookmark's
 * title) is embedded into HTML we generate ourselves — a malicious page
 * could otherwise set its title to `<script>...</script>` and have it
 * execute wherever that title is later rendered as raw HTML (e.g. the
 * bookmarked-page list on the home page).
 * @param text Raw text to escape.
 * @returns Text safe to place inside HTML markup (attributes or content).
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
