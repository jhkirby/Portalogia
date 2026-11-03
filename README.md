# Portalogia

A Chromium-based desktop browser built with Electron, React, and TypeScript.

## Documentation

All project documentation is in [`docs/`](docs/):

| Document | What it covers |
| --- | --- |
| [User guide](docs/user_guide.md) | How to use Portalogia, written for non-technical users |
| [Features](docs/features.md) | Every feature, grouped by area, each linked to its tests |
| [Design](docs/design.md) | The application's purpose, principles, layout and visual design |
| [Architecture](docs/architecture.md) | Processes, window composition, IPC, state, persistence and the build |
| [Security](docs/security.md) | Threat model, security boundaries, controls and contributor best practices |
| [Testing strategy](docs/testing_strategy.md) | How tests are designed, written and traced to features |
| [Testing log](docs/testing_log.md) | Every test, with its ID, type and the features it covers |
| [Privacy policy](docs/privacy.md) | What Portalogia stores and what it sends over the network |

License files are in [`license/`](license/), and dated security review
reports are in [`security/`](security/).

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full picture. In
brief:

- **`src/main/`** — the Electron main process. `windows/MainWindow.ts` creates
  the single top-level window with secure defaults baked in. `browser/TabManager.ts`
  owns one `WebContentsView` per tab, positioned below the chrome, and is the
  only place that talks to Electron's tab-content APIs directly. `ipc/` and
  `menu/` wire IPC and the application menu to it.
- **`src/preload/`** — the `contextBridge` bridge. Exposes a small
  `window.portalogia` API (see `PortalogiaApi` in `src/shared/ipc-contract.ts`) instead of
  any raw Electron primitive.
- **`src/renderer/`** — the React chrome: tab bar, address bar, back/forward/
  reload. It never touches Node or Electron directly, only `window.portalogia`.
  Actual page content is **not** rendered here — it's the native
  `WebContentsView` the main process draws directly beneath this UI.
- **`src/shared/`** — the IPC contract (channel names, zod request schemas,
  the `PortalogiaApi` interface) and small pure helpers (URL normalization) used by
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
npm run package:win   # build release\Portalogia-win32-x64
npm run install:win   # install that build
```

To run the scripts directly, pass `-ExecutionPolicy Bypass`, because Windows
blocks unsigned scripts by default:

```
powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1
powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1 -Build -DesktopShortcut
```

**`build.ps1`** typechecks, regenerates `license/THIRD_PARTY_NOTICES.txt`, runs
`electron-vite build`, and assembles `release\Portalogia-win32-x64`. That folder
holds Electron's runtime with `electron.exe` renamed to `Portalogia.exe`, plus the
app's code and production dependencies in `resources\app`. You can run
`Portalogia.exe` from there without installing.

| Option        | Effect                                                    |
| ------------- | --------------------------------------------------------- |
| `-Clean`      | Reinstall dev dependencies with `npm ci` before building. |
| `-SkipChecks` | Skip the typecheck.                                       |

**`install.ps1`** copies the build to `%LOCALAPPDATA%\Programs\Portalogia`,
adds a Start Menu shortcut, and adds an entry under Settings > Apps > Installed
apps. Running it again upgrades in place. Close Portalogia first, because the
script won't replace files that are in use.

| Option             | Effect                                                     |
| ------------------ | ---------------------------------------------------------- |
| `-Build`           | Run `build.ps1` first.                                     |
| `-DesktopShortcut` | Also add a desktop shortcut.                               |
| `-InstallDir`      | Install somewhere else (must be empty or a Portalogia install). |

**`uninstall.ps1`** is copied into the install folder. Settings > Apps runs it
when you uninstall Portalogia there. It removes the program files, shortcuts,
and the Installed apps entry. Your browsing data in `%APPDATA%\Portalogia` is
kept unless you pass `-RemoveUserData`.

Limitations:

- **Not code-signed, and Electron fuses are not set** (SEC-008 in the security
  report). SmartScreen may warn you the first time the app runs.
- **`Portalogia.exe` shows Electron's icon.** Changing an exe's icon needs a
  resource editor, which these scripts don't use. The shortcuts use
  Portalogia's icon.
- **The app code is a plain folder, not an `asar` archive.**

These scripts replace electron-builder, which was removed because of its
build-time advisories (SEC-007).

## Current scope

Portalogia has tabs, workspaces and workspace images, bookmarks, history, find
in page, ad blocking, a PDF viewer, Markdown notes, a terminal, and
annotation tools that work across all of them. The full list, and which
features have tests, is in [docs/features.md](docs/features.md).

Not yet implemented: downloads, a settings page, a way to start split view
from the interface, a permission-request prompt (all site permission
requests except full-screen are denied for now), code signing, and
installers for macOS and Linux.

## Testing

```
npm test           # all tests (builds the app first for the E2E suite)
npm run test:unit  # unit tests only
npm run test:e2e   # end-to-end tests only
```

See [docs/testing_strategy.md](docs/testing_strategy.md) and
[docs/testing_log.md](docs/testing_log.md).

## License and privacy

Portalogia is free for noncommercial use under the
[PolyForm Noncommercial License 1.0.0](license/LICENSE). You may use, copy,
modify, and share it for any noncommercial purpose, but you may not sell it or
use it commercially. Copyright (c) 2026 Joshua H. Kirby.

- [`docs/privacy.md`](docs/privacy.md): what Portalogia stores and what it
  sends over the network (short version: no telemetry, and everything stays
  local).
- [`license/THIRD_PARTY_NOTICES.txt`](license/THIRD_PARTY_NOTICES.txt):
  licenses of the open-source components bundled into the app. Regenerate it
  with `npm run notices`. `build.ps1` does this automatically.

All three files are copied next to `Portalogia.exe` in Windows builds.
