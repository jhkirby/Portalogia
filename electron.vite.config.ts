// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { buildAppPageCsp } from './src/shared/csp';
import { buildMarkdownCsp } from './src/shared/markdown/csp';

// Shared alias so main, preload, and renderer all import the IPC contract
// and domain types from one place instead of duplicating them.
const sharedAlias = {
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        // `terminal`, `suggestions`, `tooltip`, `colorPicker`, and
        // `tabZoom` are narrower preloads for a terminal tab's, the
        // address bar's suggestions overlay's, the collapsed sidebar's
        // tooltip overlay's, the accent color picker's overlay's, and a
        // browser tab's own `WebContentsView`s (see
        // `src/preload/terminal.ts`, `src/preload/suggestions.ts`,
        // `src/preload/tooltip.ts`, `src/preload/colorPicker.ts`, and
        // `src/preload/tabZoom.ts`) — separate bundles so neither
        // sandboxed renderer ever has the full chrome-facing `PortalogiaApi`
        // in its preload, only the handful of channels each one needs.
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          terminal: resolve(__dirname, 'src/preload/terminal.ts'),
          suggestions: resolve(__dirname, 'src/preload/suggestions.ts'),
          tooltip: resolve(__dirname, 'src/preload/tooltip.ts'),
          colorPicker: resolve(__dirname, 'src/preload/colorPicker.ts'),
          exportMenu: resolve(__dirname, 'src/preload/exportMenu.ts'),
          pdf: resolve(__dirname, 'src/preload/pdf.ts'),
          markdown: resolve(__dirname, 'src/preload/markdown.ts'),
          history: resolve(__dirname, 'src/preload/history.ts'),
          bookmarks: resolve(__dirname, 'src/preload/bookmarks.ts'),
          secrets: resolve(__dirname, 'src/preload/secrets.ts'),
          secretPrompt: resolve(__dirname, 'src/preload/secretPrompt.ts'),
          find: resolve(__dirname, 'src/preload/find.ts'),
          tabZoom: resolve(__dirname, 'src/preload/tabZoom.ts'),
          laserPointer: resolve(__dirname, 'src/preload/laserPointer.ts'),
        },
        // Sandboxed preload scripts are loaded through a synchronous
        // CommonJS loader and can't use `import` — with the package set to
        // "type": "module", the default ESM output produces a `.mjs` file
        // that fails at runtime, so force CJS here explicitly.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: sharedAlias },
    plugins: [
      react(),
      {
        // The packaged build serves pages from `file://`, where a response header isn't a sure thing — so every
        // page carries its policy in the page itself: the Markdown page (untrusted text) its own strict one, the
        // rest the app-page policy. (Under the dev server, whose inline scripts can't live under these policies,
        // the chrome and Markdown pages get theirs as headers from main instead.)
        name: 'page-csp',
        apply: 'build',
        transformIndexHtml(html, context) {
          const csp = context.filename.endsWith('markdown.html') ? buildMarkdownCsp(false) : buildAppPageCsp(false);
          return html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
        },
      },
    ],
    build: {
      rollupOptions: {
        // `terminal`, `suggestions`, `tooltip`, `colorPicker`, and
        // `laserPointer` are additional pages for a terminal tab's, the
        // address bar's suggestions overlay's, the collapsed sidebar's
        // tooltip overlay's, the accent color picker's overlay's, and the
        // laser pointer overlay's own `WebContentsView`s to load — see
        // `TabManager.createTerminalTab`, `SuggestionsOverlay`,
        // `TooltipOverlay`, `ColorPickerOverlay`, and `LaserPointerOverlay`.
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          terminal: resolve(__dirname, 'src/renderer/terminal.html'),
          suggestions: resolve(__dirname, 'src/renderer/suggestions.html'),
          tooltip: resolve(__dirname, 'src/renderer/tooltip.html'),
          colorPicker: resolve(__dirname, 'src/renderer/color-picker.html'),
          exportMenu: resolve(__dirname, 'src/renderer/export-menu.html'),
          pdf: resolve(__dirname, 'src/renderer/pdf.html'),
          markdown: resolve(__dirname, 'src/renderer/markdown.html'),
          history: resolve(__dirname, 'src/renderer/history.html'),
          bookmarks: resolve(__dirname, 'src/renderer/bookmarks.html'),
          secrets: resolve(__dirname, 'src/renderer/secrets.html'),
          secretPrompt: resolve(__dirname, 'src/renderer/secret-prompt.html'),
          find: resolve(__dirname, 'src/renderer/find.html'),
          laserPointer: resolve(__dirname, 'src/renderer/laser-pointer.html'),
        },
      },
    },
  },
});
