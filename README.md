# Northstar

A Chromium-based desktop browser built with Electron, React, and TypeScript.

## Architecture

- **`src/main/`** — the Electron main process. `windows/MainWindow.ts` creates
  the single top-level window with secure defaults baked in. `browser/TabManager.ts`
  owns one `WebContentsView` per tab, positioned below the chrome, and is the
  only place that talks to Electron's tab-content APIs directly. `ipc/` and
  `menu/` wire IPC and the application menu to it.
- **`src/preload/`** — the `contextBridge` bridge. Exposes a small
  `window.northstar` API (see `NorthstarApi` in `src/shared/ipc-contract.ts`) instead of
  any raw Electron primitive.
- **`src/renderer/`** — the React chrome: tab bar, address bar, back/forward/
  reload. It never touches Node or Electron directly, only `window.northstar`.
  Actual page content is **not** rendered here — it's the native
  `WebContentsView` the main process draws directly beneath this UI.
- **`src/shared/`** — the IPC contract (channel names, zod request schemas,
  the `NorthstarApi` interface) and small pure helpers (URL normalization) used by
  both sides of the process boundary.

## Getting started

```
npm install
npm run dev        # launch in development, with hot reload for the chrome UI
npm run typecheck  # tsc --noEmit across main/preload and renderer
npm run build       # production build
```

## Current scope

This is a first working scaffold: tabs, navigation, back/forward/reload/stop,
and a minimal application menu. Not yet implemented: bookmarks, history UI,
downloads, findbar, settings, a real permission-request UI (all site
permission requests are denied by default for now), and packaging/code
signing for distribution.
