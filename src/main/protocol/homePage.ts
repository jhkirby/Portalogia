// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    min-height: 100vh;
    box-sizing: border-box;
    background: light-dark(#ffffff, #202124);
    /* A light/dark switch fades, like the app's own pages (THEME_FADE_MS), with the fluid moving on through it. */
    transition: background-color 600ms ease-in-out;
  }
`;

/**
 * Builds Portalogia's home page / new-tab page. Served by the `portalogia://home`
 * protocol handler in `main/index.ts` — a plain server-rendered page with
 * no script.
 * @returns A complete HTML document.
 */
export function buildHomePageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>New Tab</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
</body>
</html>`;
}
