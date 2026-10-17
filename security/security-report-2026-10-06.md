# Northstar Security Review

- **Date:** 2026-10-06
- **Branch / commit:** `dev` @ `d2a9aa3`
- **Scope:** the whole repository: `src/main`, `src/preload`, `src/renderer`, `src/shared`, build and packaging config (`package.json`, `package-lock.json`, `electron-builder.yml`, `electron.vite.config.ts`), and root scripts. `node_modules/`, `out/` and build artifacts were left out, except to check installed dependency versions.
- **Method:** I read the code manually, organised by OWASP Top 10 / CWE category. I ran `npm audit` against the lockfile. I also ran a small Electron 33 script to confirm one claim (see SEC-002). No source files were changed.

## Summary

Overall, Northstar's Electron hardening is better than most apps of its kind. Every `BrowserWindow` and `WebContentsView` sets `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` and `webSecurity: true`. Web pages get no `contextBridge` API at all. Every IPC payload is checked against a zod schema. Navigation is limited to an allowlist of schemes, both at the IPC boundary and in `will-navigate`. Untrusted Markdown passes through DOMPurify (with KaTeX `trust: false`) and is shown under a strict CSP. Markdown and PDF file access is limited to paths the main process already knows, and renames reject path separators. So an ordinary malicious web page, PDF or note cannot reach the file system or the shell directly. I found no injection, path-traversal or secrets-in-repo issues.

The two findings that matter most work together. **SEC-001:** the app ships on Electron 33.4.11. Electron 33 is end-of-life, so its Chromium (about M130) has gone more than a year without security fixes, and this app's whole purpose is to render arbitrary websites. A public Chromium renderer exploit is therefore a realistic threat, not a theoretical one. **SEC-002:** that kind of exploit is exactly the threat the sandbox and IPC checks are meant to contain, and here the containment is weaker than the code comments say. Many comments state that `resolveTabManager` "only resolves for a chrome window's own sender, so a tab's page can't send it". I tested this on Electron 33, and it is not true: `BrowserWindow.fromWebContents()` returns the owning window for a mounted tab's `WebContentsView` too. As a result, a compromised web-tab renderer can call every chrome channel. It can create a terminal tab (`tabs:create-terminal`), read its id from `tabs:get-state`, and type commands into the shell through `terminal:input`, which has no sender check at all. Together these turn a sandboxed renderer bug into code execution as the user.

There is one pattern behind SEC-002 and several smaller items. Authorisation for IPC is either keyed on a caller-supplied tab id (`terminal:*`, `pdf:*`, the Markdown toolbar channels, `pdf:save-annotations`) or on `fromWebContents`. Neither of these proves the message came from the chrome page. The Markdown *page* channels are the exception and do it correctly (`ownsMarkdownContents`), and they are the model to copy. The other findings are about consent and exposure, not the IPC boundary. The Markdown "Run code" prompt can hide most of a block, and its trust grant covers blocks the user never saw (SEC-003). User annotations are injected into the visited page's own DOM, where that page's scripts can read them (SEC-004).

Count by severity: **0 Critical, 2 High, 2 Medium, 5 Low.**

## Findings

| ID | Severity | Location | Category | Summary |
|----|----------|----------|----------|---------|
| SEC-001 | High | `package.json:75` | OWASP A06:2021 – Vulnerable and Outdated Components (CWE-1104) | The browser renders untrusted web content on Electron 33.4.11 (EOL, Chromium ~M130). It has no Chromium/V8 security fixes since EOL; `npm audit` suggests electron@44.5.1. |
| SEC-002 | High | `src/main/ipc/registerTabIpc.ts:481` (also `src/main/index.ts:285`) | OWASP A01:2021 – Broken Access Control (CWE-863, CWE-284) | `terminal:input` writes to any pty named by `id` without checking the sender. `resolveTabManagerForEvent` (verified) also accepts a tab's own `WebContentsView`, so a compromised web renderer can call `tabs:create-terminal` → `tabs:get-state` → `terminal:input` and run shell commands. |
| SEC-003 | Medium | `src/main/browser/TabManager.ts:1246` | OWASP A04:2021 – Insecure Design (CWE-356, CWE-367) | The code-run consent dialog shows only the first 600 characters of the clicked block. The grant then trusts the whole note path until restart, which includes other blocks and later on-disk changes, so they run with no new prompt. |
| SEC-004 | Medium | `src/preload/tabComments.ts:194` (also `src/preload/tabTextBoxes.ts:556`) | OWASP A01:2021 – Broken Access Control (CWE-668) | Comment and text-box textareas holding the user's private notes go into the visited page's light DOM. The page can adopt the root by pre-creating its `id`, and its scripts can read, change or exfiltrate the notes. |
| SEC-005 | Low | `src/renderer/pdf.html:4` (also `src/main/windows/MainWindow.ts:101`) | OWASP A05:2021 – Security Misconfiguration (CWE-693) | Only `markdown.html` carries a CSP `<meta>` in the packaged build. `pdf.html` parses untrusted PDFs with pdf.js (`isEvalSupported` left at default) with no CSP. The chrome's CSP comes only from an `onHeadersReceived` hook, which may never fire for `file://` loads (unverified). |
| SEC-006 | Low | `src/shared/markdown/csp.ts:27` | OWASP A01:2021 – Broken Access Control (CWE-200) | `img-src https:` lets an untrusted note load remote images as soon as it opens. That acts as a tracking beacon and leaks the user's IP and the time the note was opened. |
| SEC-007 | Low | `package.json:76` | OWASP A06:2021 – Vulnerable and Outdated Components (CWE-1104) | `npm audit` reports 3 high and 4 moderate issues in build-time tooling: `app-builder-lib`/`electron-builder` ≤26.14 (GHSA-7g7r-gx96-252g AppImage search path, GHSA-p2f4-r6v6-j797), `tar`, `brace-expansion`, `sprintf-js`. None of these ship in the runtime bundle. |
| SEC-008 | Low | `electron-builder.yml:7` | OWASP A08:2021 – Software and Data Integrity Failures (CWE-347) | Release builds are unsigned, and no Electron fuses are set (`EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`). The installed app can be modified or hijacked with nothing to detect it. |
| SEC-009 | Low | `_drive_find.mjs:5` (also `_drive_tmp*.mjs`) | OWASP A05:2021 – Security Misconfiguration (CWE-540) | Ad-hoc test driver scripts are committed at the repo root. They contain the developer's absolute local paths (Windows username, directory layout, temp and session folders). |

## Finding details

### SEC-001: End-of-life Electron for a web browser
- `package.json:75` declares `"electron": "^33.3.1"`, and the lockfile resolves it to **33.4.11**. Electron supports only the latest three major versions. `npm audit` lists 44.5.1 as current.
- Why it matters more here than in a typical Electron app: tabs load whatever URL the user visits (`TabManager.createBrowserTabState`), so every published Chromium/V8 renderer bug since EOL can be triggered by any website.
- Combined with SEC-002, a renderer exploit leads straight to code execution as the user, with no separate sandbox-escape bug needed.

### SEC-002: IPC sender is not authenticated (renderer compromise → shell)
- **Verified claim:** I ran a minimal Electron 33.4.11 script. It created a `BrowserWindow`, added a `WebContentsView` to `contentView`, then called `BrowserWindow.fromWebContents(view.webContents)`. It returned the window (`same true`). So `resolveTabManagerForEvent` (`src/main/index.ts:285`) and `isChrome` (`src/main/ipc/registerMarkdownIpc.ts:140`) resolve for **any mounted tab**, not only the chrome page. The comments at `registerTabIpc.ts:345-351`, `:373-375` and `registerMarkdownIpc.ts:85` are wrong.
- **Chain:** a compromised web-tab renderer can call `ipcRenderer` directly. It invokes `tabs:create-terminal` and then `tabs:get-state`, which returns every tab id including the new terminal's. It then sends `terminal:input` `{ id, data: "<command>\r" }`. `registerTabIpc.ts:481` forwards that to `TerminalManager.write` with no check on `event.sender`.
- **Same pattern, lower impact:** these channels also act on any tab id from any renderer: `terminal:resize` (unbounded `cols`/`rows`, `ipc-schemas.ts:462`), `pdf:open-file`, `pdf:export`, `pdf:rename`, `pdf:close-file`, `pdf:go-to-page`, `pdf:open-bookmark`, `pdf:page-info`, `pdf:save-annotations` (overwrites saved marks for any document hash), the Markdown toolbar channels in `invokeForTab` (`registerMarkdownIpc.ts:150`), `adblock:set-enabled` / `adblock:set-site-allowed`, `accent-color:set` and `theme:set`. Every chrome-only channel (history search and clear, bookmarks, navigation, window close) is also reachable from a tab for the reason above.
- **Correct pattern already in the codebase:** the Markdown page channels check `manager.ownsMarkdownContents(tabId, event.sender)`.

### SEC-003: Code-run consent can be bypassed in practice
- `TabManager.ts:1249` truncates the preview to 600 characters plus "…". A note can put a harmless first screen ahead of a malicious tail, and the user approves code they cannot see.
- `TabManager.ts:1246/1265` stores trust by note **path**. After one approval, every other block in that note runs with no prompt. So does any new content: notes are re-read from disk (`refreshMarkdownIfChanged`), for example after a sync client or another process rewrites the file.

### SEC-004: User annotations exposed to the page
- `ensureRoot()` first calls `document.getElementById(ROOT_ID)` and reuses whatever element it finds (`tabComments.ts:194`). It then appends `<textarea>`s holding the user's comment text (`:483-513`). `tabTextBoxes.ts:556-568` does the same.
- These live in the page's own DOM, so the site's scripts can read the user's private notes about that site, change them, or send synthetic events that the preload then saves through `comment-tool:op` / `text-tool:op`.

### SEC-005: Missing CSP on app-owned pages
- In packaged builds, `electron.vite.config.ts:72` adds a CSP `<meta>` to `markdown.html` only. `pdf.html`, `terminal.html`, `history.html` and the overlay pages have none.
- `pdf.html` parses attacker-supplied PDFs (`PdfViewer.tsx:197`, `getDocument({ data })` with pdf.js's default `isEvalSupported: true`). The chrome page's CSP is attached through the ad-blocker's `onHeadersReceived` hook for `file://` URLs (`MainWindow.ts:99-110`). The build config's own comment says a response header "isn't a sure thing" for `file://`. **Unverified** whether it applies in the packaged chrome window.
- This is defence in depth: I found no XSS sink in these pages (React escaping, no `dangerouslySetInnerHTML`).

### SEC-006: Remote images in untrusted notes
- `buildMarkdownCsp` allows `img-src https:`, and `isLoadableSource` (`enhance.ts:193`) loads `https:` images directly. Opening a downloaded note can therefore notify a third-party server.

### SEC-007: Vulnerable build tooling (`npm audit`)
- Build-time only (`devDependencies`): `electron-builder` 25.1.8 → `app-builder-lib`, `builder-util-runtime`, `tar`; plus `brace-expansion` and `sprintf-js` (through `@electron/get`). The AppImage search-path advisory affects the Linux artifact this config produces (`electron-builder.yml:34`).

### SEC-008: Unsigned builds, no fuses
- `electron-builder.yml:6-8` notes that signing isn't configured, and `package.json:14` sets `CSC_IDENTITY_AUTO_DISCOVERY=false`. No `@electron/fuses` step exists.
- Note: `RunAsNode` can't be turned off as things stand, because `MarkdownCodeRunner.ts:59` uses `ELECTRON_RUN_AS_NODE` to run JavaScript blocks.

### SEC-009: Committed scratch scripts
- `_drive_find.mjs` and `_drive_tmp*.mjs` are Playwright driver scripts. They hard-code `C:/Users/<username>/…` paths, including Claude scratchpad session folders. They contain no credentials.

## Checked and found sound
- **Window and view hardening:** `contextIsolation`, `sandbox` and `nodeIntegration: false` are set on every window and view. App-owned views deny `will-navigate` and `window.open`.
- **Navigation:** `isNavigableUrl` allows only `http`, `https`, `about` and `northstar` schemes, checked in `navigate`, `will-navigate` and `setWindowOpenHandler`. `file:` and `javascript:` are refused.
- **Permissions:** everything is denied except `fullscreen` (web pages) and `pointerLock` (own PDF page). There is no `certificate-error` override.
- **Markdown rendering:** DOMPurify with forbidden tags and attributes, KaTeX `trust: false`, heading-id prefixing against DOM clobbering, a strict CSP, and `connect-src 'none'`.
- **File access:** `openMarkdownFromHistory` and `openPdfFromHistory` only accept known paths. Renames reject separators and reserved names. Image reads are limited by extension and size, and UNC paths are blocked to prevent NTLM credential leaks.
- **Error page:** `buildErrorPageUrl` HTML-escapes its input. IPC errors return only `error.message`, never stack traces.
- **Secrets:** no secrets or credentials found in tracked files. `.env` is gitignored.
