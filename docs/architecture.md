# Architecture

Portalogia is a desktop web browser built on Electron, with a React interface
written in TypeScript. This document covers how the code is put together:
the processes, how the window is assembled, how the parts talk to each other,
where state lives, and how the app is built. For the reasons behind the
interface, see [design.md](design.md). For the security model, see
[security.md](security.md).

## Technology stack

| Layer | Technology |
| --- | --- |
| Runtime | Electron 44 (Chromium and Node.js) |
| Language | TypeScript 5, strict, ES modules |
| Interface | React 19 |
| Build | electron-vite 5 (Vite 6) |
| Validation | zod, for every IPC request and every file read from disk |
| Markdown | marked, DOMPurify, KaTeX, highlight.js, CodeMirror 6 |
| PDF | pdf.js (viewing), pdf-lib (exporting) |
| Terminal | xterm.js (display), node-pty (shell process) |
| Ad blocking | `@ghostery/adblocker-electron` |
| Tests | Playwright, for both unit and end-to-end tests |

## Process model

Electron runs one **main process** (Node.js, full system access) and many
**renderer processes** (Chromium pages, sandboxed). Portalogia adds a firm
rule: **the main process owns all state and all privileged work.** Each
renderer is a view that shows state and asks main to change it.

```
┌──────────────────────────── Main process (Node) ─────────────────────────────┐
│ index.ts (composition root)                                                  │
│   ├─ SharedTabRegistry  ── tabs, workspaces, views (shared by every window)  │
│   ├─ TabManager × N     ── one per window: active tab, layout, overlays      │
│   ├─ Stores             ── bookmarks, history, session, annotations, ...     │
│   ├─ Controllers        ── highlighter, comments, pen, text boxes, history   │
│   ├─ AdBlocker          ── owns the session's request/header hooks           │
│   ├─ TerminalManager    ── node-pty shells                                   │
│   └─ ipc/register*.ts   ── validated IPC handlers                            │
└──────────────▲───────────────────────▲────────────────────────▲──────────────┘
               │ IPC (zod-validated)   │                        │
     ┌─────────┴─────────┐   ┌─────────┴──────────┐   ┌─────────┴──────────┐
     │ Chrome page       │   │ App tab pages      │   │ Web tab            │
     │ index.html        │   │ pdf / markdown /   │   │ any website        │
     │ preload: index    │   │ terminal / history │   │ preload: tabZoom   │
     │ (React UI)        │   │ (own preloads)     │   │ (annotation tools) │
     └───────────────────┘   └────────────────────┘   └────────────────────┘
```

Every renderer runs with `contextIsolation: true`, `sandbox: true` and
`nodeIntegration: false`. A renderer reaches main only through the narrow API
its preload script exposes with `contextBridge`. There are 12 preload bundles,
one per kind of page, so each page gets only the channels it needs. A web
page's preload gives the page's own scripts no API at all.

## How a window is assembled

A Portalogia window is not one web page. It is a stack of native views.

1. **The chrome page.** The `BrowserWindow`'s own `webContents` loads
   `src/renderer/index.html`. This is the React interface: tab
   strip, toolbar, address bar and workspace sidebar. The window is
   frameless (`frame: false`), so the chrome draws its own title bar and
   window buttons.
2. **Tab views.** Each tab's content is a separate `WebContentsView` that
   `TabManager` adds to the window's `contentView` and positions over the
   chrome's empty content area. The React tree never renders page content.
   It leaves a hole, and main fills it with a native view. Split view mounts
   a second view beside the first.
3. **Overlay views.** A native view always draws above the DOM, so a React
   dropdown could never appear over a page. Anything that has to float over
   page content therefore gets its own small, transparent `WebContentsView`
   stacked on top:

| Overlay | Page | Main-process owner |
| --- | --- | --- |
| Address suggestions | `suggestions.html` | `SuggestionsOverlay` |
| Sidebar tooltips | `tooltip.html` | `TooltipOverlay` |
| Accent color picker | `color-picker.html` | `ColorPickerOverlay` |
| Export menu | `export-menu.html` | `ExportMenuOverlay` |
| Find bar | `find.html` | `FindOverlay` |
| Laser pointer | `laser-pointer.html` | `LaserPointerOverlay` |

The chrome sends each overlay its contents and position through a `sync*`
call (for example `syncAddressSuggestions`). Main forwards that to the
overlay's page, and the overlay reports user actions back the same way.

Because content sits in native views, a few chrome features have to step
around them. When tab search opens over a page, `beginTabPreview` captures a
still image of the tab and the chrome shows a blurred copy, since a DOM modal
can't cover a live native view.

## Tab kinds

`TabState` in `src/shared/tab-state.ts` is a discriminated union. Each kind
loads its own page with its own preload:

| Kind | Page | Preload | What it is |
| --- | --- | --- | --- |
| `browser` | any http(s) site or `portalogia://home` | `tabZoom` (also loads `tabHighlighter`, `tabComments`, `tabTextBoxes`, `tabPen`, `tabFind`) | A web page |
| `terminal` | `terminal.html` | `terminal` | xterm.js connected to a node-pty shell |
| `pdf` | `pdf.html` | `pdf` | pdf.js viewer with annotation layers |
| `markdown` | `markdown.html` | `markdown` | Note reader and CodeMirror editor |
| `history` | `history.html` | `history` | Searchable browsing history |

## Main process modules

| Path | Responsibility |
| --- | --- |
| `src/main/index.ts` | Composition root. Builds every shared store and controller, registers the `portalogia:` protocol, the permission handler and all IPC, and creates windows. Also owns cross-window flows: tear-off, the hidden spare window, and opening a tab in a new window. |
| `src/main/windows/` | `MainWindow` creates a hardened `BrowserWindow`. The frameless window is moved by the OS, through the chrome's title-bar drag region. |
| `src/main/browser/TabManager.ts` | One per window. The only code that calls Electron's tab-content APIs. Creates and mounts tab views, lays them out, runs navigation, wires per-tab events, routes keyboard shortcuts, and owns the window's overlays. |
| `src/main/browser/SharedTabRegistry.ts` | The single set of tabs, workspaces and views shared by every window. `mountOwners` records which window is showing each tab, and `notifyAll()` asks every window to push fresh state. |
| `src/main/browser/*Store.ts` | Persistence, one store per kind of data (see [Persistence](#persistence)). |
| `src/main/browser/*Controller.ts` | Cross-window logic for each annotation tool and for history recording. A controller talks to a tab's preload and saves through its store. |
| `src/main/browser/Markdown*.ts` | `MarkdownDocuments` (open files, saves, back/forward), `MarkdownVault` (link resolution, backlinks, images), `MarkdownCodeRunner` (runs code blocks in child processes). |
| `src/main/browser/Pdf*.ts`, `PageDocumentExporter.ts` | PDF crop/annotation export (pdf-lib) and saving a web page's HTML, CSS and JS to a folder. |
| `src/main/adblock/` | `AdBlocker` wraps Ghostery's engine and owns the session's only `onHeadersReceived` listener, which other code (such as the chrome's CSP) registers through. `AdBlockStore` holds settings. `trackingParams` strips tracking query parameters. |
| `src/main/terminal/` | `TerminalManager` owns node-pty processes. `shell.ts` picks the shell. |
| `src/main/ipc/` | One `register*Ipc` module per area. `senderGuards.ts` checks who sent a message. |
| `src/main/menu/buildMenu.ts` | The application menu and every keyboard shortcut. |
| `src/main/protocol/homePage.ts` | The `portalogia://home` page. |

## Shared code

`src/shared/` is imported by main, preload and renderer through the `@shared`
alias. It holds only code that is safe on both sides of the process boundary:

- **`ipc-contract.ts`**: the `IpcChannel` names, every payload type, and the
  `PortalogiaApi` interface that the chrome's preload implements.
- **`ipc-schemas.ts`**: a zod schema for every request main accepts.
- **`tab-state.ts`**: `BrowserState`, the state main pushes to the chrome.
- **`constants.ts`**: layout sizes, limits (8 tabs per workspace, 20
  workspaces, 50,000 history entries) and URLs.
- Pure helpers: `url.ts`, `find.ts`, `history.ts`, `color.ts`, `csp.ts`, and
  `markdown/` (parser, plain-text export, line endings, runnable languages).

Because these helpers are pure, most unit tests target them. See
[testing_strategy.md](testing_strategy.md).

## Inter-process communication

All IPC goes through `src/shared/ipc-contract.ts`. There are three patterns:

1. **Request and reply** (`ipcRenderer.invoke` / `ipcMain.handle`). Used for
   anything that changes state. The reply is an `IpcResult<T>`, either
   `{ ok: true, data }` or `{ ok: false, code, message }`, so errors cross the
   boundary as values instead of thrown exceptions. Most tab channels reply
   with the full `BrowserState`.
2. **Fire and forget** (`send` / `on`). Used for high-frequency or one-way
   messages: terminal keystrokes, overlay syncs, tear-off, drop regions.
3. **Push** (`webContents.send`). Main sends `TabsStateChanged`, ad-block
   state, terminal output, window state and menu commands to whichever page
   needs them.

Each handler follows the same sequence:

```
raw payload ──► zod safeParse ──► resolve the sender ──► act ──► IpcResult
                 (reject bad)      (reject wrong page)
```

Main never trusts who a message claims to come from. It works the target out
from `event.sender`:

- `chromeWindowOf(sender)` accepts only a window's own chrome page. A tab's
  page mounted in that window does not count.
- `resolveTabForContents(sender)` maps a tab page back to its own tab id, so
  a page can act only on itself.
- Markdown page channels check `ownsMarkdownContents(tabId, sender)`.

## State flow

```
user action ─► React handler ─► window.portalogia.x() ─► IPC ─► TabManager
                                                                   │
React re-renders ◄─ useTabs ◄─ onStateChanged ◄─ TabsStateChanged ◄┘
```

Main is the single source of truth. The chrome never updates its own copy of
tab state ahead of main. It renders whatever `BrowserState` main last pushed
(through the `useTabs` hook). Every mutation ends in
`SharedTabRegistry.notifyAll()`, so every window re-renders, and the session
is saved.

Per-window interface state stays in each `TabManager`: the active tab, active
workspace, split view, Focus Mode and sidebar visibility. Everything else is
shared: tabs, workspaces, bookmarks, history and annotations.

## Multi-window design

- **Shared registry.** Tabs and their live views belong to the app, not to a
  window. Moving a tab to another window re-parents its existing
  `WebContentsView`, so the page keeps its scroll position, form contents and
  history.
- **Mount ownership.** A view can be attached to only one window at a time.
  `activateTab` takes the tab from whichever window currently shows it
  (`releaseTab`) before mounting it.
- **Tear-off.** Dragging a tab out gives it a scratch workspace and a window
  that follows the cursor by polling it every 8 ms, because the OS drag owns
  the mouse. Over another window's drop region the follower window hides, so
  that window can receive the drop. When the drag ends, main checks where
  the tab landed and either discards the scratch window or keeps it.
- **Spare window.** A fully loaded, hidden chrome window is kept ready,
  because loading a chrome page from scratch takes hundreds of milliseconds,
  which is too slow for a window that has to appear under the cursor. The
  spare never becomes the active window for menu shortcuts.

## Persistence

All data lives as files in Electron's `userData` folder (`%APPDATA%\Portalogia`
on Windows):

| File | Store |
| --- | --- |
| `session.json` | `SessionStore`: open tabs and workspaces |
| `bookmarks.json` | `BookmarkStore` |
| `history.json` | `HistoryStore` |
| `workspace-images.json` | `WorkspaceImageStore` |
| `highlights.json`, `comments.json`, `text-boxes.json`, `pen-strokes.json` | Web page annotations |
| `pdf-annotations.json` | `PdfAnnotationStore`: marks on PDFs, keyed by document |
| `markdown-annotations.json` | `MarkdownAnnotationStore` |
| `adblock.json`, `adblock-engine.bin` | Ad-blocker settings and cached filter engine |

Stores follow three rules:

1. **Validate on read.** A file on disk is untrusted input, so it is parsed
   with zod. A corrupt or hostile file falls back to defaults instead of
   crashing the app.
2. **Debounce writes.** Frequent changes are batched into one write.
3. **Flush on exit.** `before-quit` and window `closed` handlers flush
   pending writes so the last change isn't lost.

Annotations are never written into the page, PDF or note they belong to.
Notes themselves are ordinary `.md` files wherever the user keeps them.

## Build and packaging

`electron.vite.config.ts` defines three builds, all sharing the `@shared`
alias:

| Target | Entry | Output |
| --- | --- | --- |
| main | `src/main/index.ts` | `out/main/index.js` (ESM, dependencies left external) |
| preload | 12 entries in `src/preload/` | `out/preload/*.cjs`. Sandboxed preloads load through a CommonJS loader, so they are forced to CJS. |
| renderer | 11 HTML pages in `src/renderer/` | `out/renderer/` |

A small `page-csp` plugin writes a Content-Security-Policy `<meta>` into every
built page: the strict Markdown policy for `markdown.html`, and the app-page
policy for every other page.

TypeScript uses three projects (`tsconfig.node.json`, `tsconfig.preload.json`,
`tsconfig.web.json`), so each layer is type-checked against the right
environment. `npm run typecheck` runs all three.

Windows packaging uses PowerShell scripts, not electron-builder:

- `scripts/windows/build.ps1` typechecks, regenerates
  `license/THIRD_PARTY_NOTICES.txt`, builds, and assembles
  `release/Portalogia-win32-x64`. That folder holds Electron's runtime with
  `electron.exe` renamed to `Portalogia.exe`, the app in `resources/app`, and
  the license, privacy policy and notices next to the executable.
- `install.ps1` and `uninstall.ps1` install for the current user, with no
  administrator rights needed.

## Repository layout

```
docs/                 Project documentation (this folder)
license/              LICENSE and THIRD_PARTY_NOTICES.txt
resources/            App icon
scripts/              Notice generator and Windows build/install scripts
security/             Dated security review reports
src/
  main/               Main process (see the table above)
  preload/            One contextBridge script per kind of page
  renderer/
    *.html, *-main.tsx  One entry pair per page
    components/       One folder per component, with an index.ts barrel
    hooks/            useTabs, useTheme, useAccentColor, ...
    lib/              Renderer-only helpers (Markdown editor, shortcuts, ...)
    styles/           tokens/, components/, pages/
  shared/             Code safe for both sides of the process boundary
tests/
  unit/               Pure-logic and Node-side tests
  e2e/                Full-app tests through Playwright's Electron driver
```
