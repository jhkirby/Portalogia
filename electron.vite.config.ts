// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-11

import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

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
        // sandboxed renderer ever has the full chrome-facing `NorthstarApi`
        // in its preload, only the handful of channels each one needs.
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          terminal: resolve(__dirname, 'src/preload/terminal.ts'),
          suggestions: resolve(__dirname, 'src/preload/suggestions.ts'),
          tooltip: resolve(__dirname, 'src/preload/tooltip.ts'),
          colorPicker: resolve(__dirname, 'src/preload/colorPicker.ts'),
          exportMenu: resolve(__dirname, 'src/preload/exportMenu.ts'),
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
    plugins: [react()],
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
          laserPointer: resolve(__dirname, 'src/renderer/laser-pointer.html'),
        },
      },
    },
  },
});
