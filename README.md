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

## License and privacy

Northstar is free for noncommercial use under the
[PolyForm Noncommercial License 1.0.0](LICENSE). You may use, copy, modify,
and share it for any noncommercial purpose, but you may not sell it or use it
commercially. Copyright (c) 2026 Joshua H. Kirby.

- [`PRIVACY.md`](PRIVACY.md): what Northstar stores and what it sends over
  the network (short version: no telemetry, and everything stays local).
- [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt): licenses of the
  open-source components bundled into the app. Regenerate it with
  `npm run notices`. `npm run dist` does this automatically.

All three files are copied next to the executable in packaged builds (see
`extraFiles` in `electron-builder.yml`).
