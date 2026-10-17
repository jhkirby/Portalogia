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

## Building and installing on Windows

The scripts in `scripts/windows/` build a standalone app and install it for
the current user. They need only Node.js and npm, with no administrator
rights or extra packaging tools.

```
npm run package:win   # build release\Northstar-win32-x64
npm run install:win   # install that build
```

To run the scripts directly, pass `-ExecutionPolicy Bypass`, because Windows
blocks unsigned scripts by default:

```
powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1
powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1 -Build -DesktopShortcut
```

**`build.ps1`** typechecks, regenerates `THIRD_PARTY_NOTICES.txt`, runs
`electron-vite build`, and assembles `release\Northstar-win32-x64`. That folder
holds Electron's runtime with `electron.exe` renamed to `Northstar.exe`, plus the
app's code and production dependencies in `resources\app`. You can run
`Northstar.exe` from there without installing.

| Option        | Effect                                                    |
| ------------- | --------------------------------------------------------- |
| `-Clean`      | Reinstall dev dependencies with `npm ci` before building. |
| `-SkipChecks` | Skip the typecheck.                                       |

**`install.ps1`** copies the build to `%LOCALAPPDATA%\Programs\Northstar`,
adds a Start Menu shortcut, and adds an entry under Settings > Apps > Installed
apps. Running it again upgrades in place. Close Northstar first, because the
script won't replace files that are in use.

| Option             | Effect                                                     |
| ------------------ | ---------------------------------------------------------- |
| `-Build`           | Run `build.ps1` first.                                     |
| `-DesktopShortcut` | Also add a desktop shortcut.                               |
| `-InstallDir`      | Install somewhere else (must be empty or a Northstar install). |

**`uninstall.ps1`** is copied into the install folder. Settings > Apps runs it
when you uninstall Northstar there. It removes the program files, shortcuts,
and the Installed apps entry. Your browsing data in `%APPDATA%\Northstar` is
kept unless you pass `-RemoveUserData`.

Limitations:

- **Not code-signed, and Electron fuses are not set** (SEC-008 in the security
  report). SmartScreen may warn you the first time the app runs.
- **`Northstar.exe` shows Electron's icon.** Changing an exe's icon needs a
  resource editor, which these scripts don't use. The shortcuts use
  Northstar's icon.
- **The app code is a plain folder, not an `asar` archive.**

These scripts replace electron-builder, which was removed because of its
build-time advisories (SEC-007).

## Current scope

This is a first working scaffold: tabs, navigation, back/forward/reload/stop,
and a minimal application menu. Not yet implemented: bookmarks, history UI,
downloads, findbar, settings, a real permission-request UI (all site
permission requests are denied by default for now), code signing, and
installers for macOS and Linux.

## License and privacy

Northstar is free for noncommercial use under the
[PolyForm Noncommercial License 1.0.0](LICENSE). You may use, copy, modify,
and share it for any noncommercial purpose, but you may not sell it or use it
commercially. Copyright (c) 2026 Joshua H. Kirby.

- [`PRIVACY.md`](PRIVACY.md): what Northstar stores and what it sends over
  the network (short version: no telemetry, and everything stays local).
- [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt): licenses of the
  open-source components bundled into the app. Regenerate it with
  `npm run notices`. `build.ps1` does this automatically.

All three files are copied next to `Northstar.exe` in Windows builds.
