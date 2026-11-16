# Security

Portalogia's job is to load untrusted content: websites, PDFs and Markdown
notes from anywhere. Its security model starts from that fact. This document
covers:

- what Portalogia protects,
- who might attack it,
- the boundaries between trusted and untrusted code,
- the controls at each boundary, and
- the practices that keep those controls intact as the code changes.

Dated, finding-by-finding reviews are kept in [`security/`](../security/).
The most recent is
[security-report-2026-10-06.md](../security/security-report-2026-10-06.md).

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| The user's computer | Shell, file system, running processes | The terminal and code runner can run commands. A compromise means code running as the user. |
| Browsing data | `history.json`, `session.json`, `bookmarks.json`, cookies and site storage | Reveals what the user reads and where they are signed in |
| Annotations | `comments.json`, `text-boxes.json`, highlight, pen, PDF and note annotation files | The user's private notes about pages and documents |
| User files | PDFs and `.md` notes the user opens | Can be read, overwritten or leaked |
| Site sessions | Cookies in the default Electron session | Signed-in accounts on every site |
| App integrity | The installed app folder | A modified app could do any of the above |

## Adversaries

| ID | Adversary | Capability |
| --- | --- | --- |
| A1 | **Malicious website** | Runs arbitrary JavaScript in a web tab, within Chromium's normal rules |
| A2 | **Compromised renderer** | A website that exploits a Chromium or V8 bug, so it can do anything that renderer process can, including sending raw IPC |
| A3 | **Malicious PDF** | A crafted file that targets pdf.js inside the PDF tab's page |
| A4 | **Malicious Markdown note** | A downloaded `.md` file with raw HTML, hostile links, tracking images or harmful code blocks |
| A5 | **Network attacker** | Watches or tampers with traffic (public Wi-Fi, a hostile proxy) |
| A6 | **Local attacker** | Another program running as the same user, able to edit the profile folder or the app's files |
| A7 | **Supply-chain attacker** | A compromised npm package or a malicious update to one |

## Security boundaries

```
             ┌───────────────────────────────────────────────┐
  TRUSTED    │  Main process (Node.js, full user privileges) │
             └──▲──────────────▲───────────────▲─────────────┘
           B1   │         B2   │          B3   │   B1–B3: IPC, validated with
                │              │               │   zod and checked by sender
   ┌────────────┴──┐  ┌────────┴──────────┐  ┌─┴─────────────────────┐
   │ Chrome page   │  │ App pages that    │  │ Web tab               │
   │ (our code,    │  │ parse untrusted   │  │ (untrusted site)      │
   │ trusted data) │  │ files: PDF, note  │  │                       │
   └───────────────┘  └───────────────────┘  │  B4: isolated world   │
                                             │  page JS ╳ preload    │
  UNTRUSTED ─────────────────────────────────┴───────────────────────┘
   B5 network   ·   B6 files on disk   ·   B7 code execution (terminal, Run)
```

| ID | Boundary | Trusted side | Untrusted side | Main control |
| --- | --- | --- | --- | --- |
| B1 | Chrome page to main | Main | Chrome renderer (our own code, but a renderer process all the same) | zod schemas on every request. `chromeWindowOf` accepts only a window's own chrome page. |
| B2 | App tab page to main | Main | PDF, Markdown, terminal and history pages, two of which parse untrusted files | Each page has its own narrow preload, plus ownership checks (`ownsPdfContents`, `ownsMarkdownContents`, `ownsTerminalContents`) so a page acts only on its own tab |
| B3 | Web tab to main | Main | Any website, possibly with a compromised renderer | No `contextBridge` API for the page. Every chrome channel refuses tab senders. Tab-originated messages are tied to the sending tab. |
| B4 | Page scripts to Portalogia preload | Preload's isolated world | The site's own JavaScript | `contextIsolation`. Annotation UI lives in a closed shadow root. |
| B5 | App to network | App | Websites, filter-list host | Scheme allowlist, Chromium TLS, ad and tracker blocking, no telemetry |
| B6 | App to disk | Main | Profile files, user-chosen PDFs and notes | zod validation on every read. Paths restricted to known files. Name sanitization. |
| B7 | App to code execution | User consent | Code in notes, terminal input | Per-block consent prompt, 30 s timeout. The terminal accepts input only from its own view. |

## Threat model

Each row is a threat, its impact, the controls that address it, and the risk
that remains. The adversary IDs are from the table above.

| # | Threat | Adversary | Impact | Mitigations | Residual risk |
| --- | --- | --- | --- | --- | --- |
| T1 | A web page reaches Node or Electron APIs | A1 | Code execution as the user | `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true` on every window and view. The web-tab preload calls no `contextBridge`. | Low |
| T2 | A compromised renderer sends privileged IPC (for example, opens a terminal and types into it) | A2 | Code execution as the user | `chromeWindowOf` rejects tab senders on chrome channels. Terminal, PDF and Markdown channels check that the sender owns the tab. Every payload is checked by zod. Fixes SEC-002. | Medium. Any IPC handler added without a guard reopens this. |
| T3 | An unpatched Chromium bug is exploited | A2 | Renderer compromise, then T2 | Electron upgraded to 44 (SEC-001). The sandbox is on everywhere. | Medium. Needs continued upgrades. |
| T4 | Navigation to a dangerous scheme (`file:`, `javascript:`) | A1, A4 | Local file read, script injection | `isNavigableUrl` allows only `http`, `https`, `about` and `portalogia`. It is checked at the IPC boundary, in `will-navigate` and in `setWindowOpenHandler`. The chrome page can't navigate or open windows. | Low |
| T5 | Script injection through a Markdown note | A4 | Script runs with the Markdown preload's API | DOMPurify with forbidden tags and attributes. KaTeX with `trust: false`. Heading ids prefixed to prevent DOM clobbering. Strict CSP (`default-src 'none'`, `script-src 'self'`, `connect-src 'none'`). | Low |
| T6 | A note tracks the reader through remote images | A4 | IP address and open time leaked | CSP `img-src 'self' data:`. Web images load only when clicked, through main, over https only, without cookies, size-capped, and refused after a redirect off https (SEC-006). | Low |
| T7 | Harmful code block in a note | A4 | Code execution as the user | Consent prompt showing the block, keyed by a SHA-256 of path, language and code, so other blocks and changed code ask again (SEC-003). Runs time out after 30 s and the whole process tree is killed. Unknown languages are refused. | Medium. Running code is the feature, so the user's judgment is the final control. |
| T8 | Exploit through a malicious PDF | A3 | Script in the PDF page | pdf.js runs in a sandboxed page under the app CSP (`script-src 'self'`, with no `unsafe-eval`), which blocks pdf.js's eval path (SEC-005). The PDF preload exposes only the channels the viewer needs. | Low to medium, depending on pdf.js bugs |
| T9 | A site reads or changes the user's annotations | A1 | Private notes leaked or altered | Comment and text-box UI is in a *closed* shadow root, created by the preload rather than found by id (SEC-004). Annotations are stored by main, not in the page. | Low |
| T10 | A site uses camera, microphone, location or notifications | A1 | Surveillance, spam | The permission handler denies everything except full-screen for http(s) pages and pointer lock for the app's own PDF page | Low |
| T11 | A corrupt or planted profile file | A6 | Crash, or injected state (such as a malicious tab URL) | Every store parses with zod and falls back to defaults on failure. Restored URLs still pass the scheme allowlist. | Low |
| T12 | Path traversal or credential leak through note links and images | A4 | Reading arbitrary files. NTLM hash leak through UNC paths. | Note and PDF reopen accepts only known paths. Renames refuse separators and reserved names. Image reads are limited by extension and size. UNC paths (`\\host`, `//host`) are refused. | Low |
| T13 | Tracking across sites | A1, A5 | Profiling | Ghostery filter lists. Tracking parameters stripped from URLs. No telemetry. | Low |
| T14 | The installed app is tampered with | A6 | Persistent compromise | None yet. Builds are unsigned, no Electron fuses are set, and the app is a plain folder, not an ASAR archive (SEC-008). | **High. Open.** |
| T15 | A dependency is compromised | A7 | Anything | Lockfile with `npm ci`. electron-builder and its vulnerable build tooling removed (SEC-007). License notices generated from the real dependency tree. | Medium |
| T16 | Developer details exposed in the repository | n/a | Information disclosure | Ad-hoc `_drive_*.mjs` scripts with local paths are still in the repository root (SEC-009) | Low. Open. |

## Security controls in the code

| Control | Where |
| --- | --- |
| Hardened `webPreferences` | `src/main/windows/MainWindow.ts`, every `new WebContentsView` in `TabManager.ts` and the overlays |
| Sender guards | `src/main/ipc/senderGuards.ts` (`chromeWindowOf`, `isChromeSender`), and `TabManager.owns*Contents` |
| IPC validation | `src/shared/ipc-schemas.ts`, and the `handle()` wrapper in `registerTabIpc.ts` |
| Errors as values | `IpcResult` returns `error.message` only, never stack traces |
| Scheme allowlist | `isNavigableUrl` in `src/shared/url.ts` |
| Content Security Policy | `src/shared/csp.ts` (app pages), `src/shared/markdown/csp.ts` (notes), the `page-csp` build plugin, and the home page's own CSP header |
| Markdown sanitizing | `src/renderer/lib/markdown/renderNote.ts`, `enhance.ts` |
| Remote image fetch | `fetchRemoteImageDataUrl` in `MarkdownVault.ts` |
| Code-run consent | `TabManager.ts` (`markdownTrustedBlocks`), `MarkdownCodeRunner.ts` |
| Permission handler | `src/main/index.ts` (`setPermissionRequestHandler`) |
| Private annotation UI | `src/preload/tabComments.ts`, `tabTextBoxes.ts` (closed shadow roots) |
| Store validation | Every `*Store.ts` in `src/main/browser/` and `src/main/adblock/` |

## Status of review findings

From [security-report-2026-10-06.md](../security/security-report-2026-10-06.md),
checked against the current code:

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| SEC-001 | High | End-of-life Electron 33 | **Fixed.** Now on Electron 44.5. |
| SEC-002 | High | IPC sender not checked, so a renderer could reach the shell | **Fixed.** `senderGuards.ts` and ownership checks. |
| SEC-003 | Medium | Code-run consent could be bypassed | **Fixed.** Per-block hash. |
| SEC-004 | Medium | Annotations exposed in the page DOM | **Fixed.** Closed shadow root. |
| SEC-005 | Low | Missing CSP on app pages | **Fixed.** A CSP `<meta>` in every built page. |
| SEC-006 | Low | Remote images in notes act as beacons | **Fixed.** Load on click, through main. |
| SEC-007 | Low | Vulnerable build tooling | **Fixed.** electron-builder removed. |
| SEC-008 | Low | Unsigned builds, no fuses | **Open.** |
| SEC-009 | Low | Scratch scripts committed with local paths | **Open.** |

## Best practices for contributors

### Adding an IPC channel

1. Add the channel name to `IpcChannel` and its payload types in
   `src/shared/ipc-contract.ts`.
2. Add a zod schema to `src/shared/ipc-schemas.ts`. Bound every string's
   length and every number's range.
3. In the handler, run `safeParse` before anything else, and drop or refuse
   the message if it fails.
4. **Check the sender.** Chrome-only channels must use `isChromeSender` or
   `chromeWindowOf`. Channels sent by a tab's own page must check that the
   sender owns the tab id (`owns*Contents`). A tab id in the payload is
   never proof of who sent it.
5. Expose the channel only from the preload of the page that needs it. Never
   add it to the web-tab preload's page-facing surface. That preload has none.
6. Return `IpcResult`. Never throw across the boundary, and never include a
   stack trace.

### Creating a window or view

- Always set `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, `webSecurity: true`,
  `allowRunningInsecureContent: false`.
- For app-owned pages, block `will-navigate` and deny `window.open`.
- Add the page to the `page-csp` plugin's inputs so it gets a CSP. Don't add
  `'unsafe-eval'` or remote script sources.

### Handling untrusted content

- Run any HTML that comes from a file or the network through DOMPurify
  before rendering it. Don't use `dangerouslySetInnerHTML` on anything else.
- Fetch remote resources in main, not in the page, with no cookies, a size
  cap and https only.
- Treat every file read from disk, including the app's own profile files,
  as untrusted, and validate it with zod.
- Accept file paths only when main already knows them. Never build a path
  from a renderer string without sanitizing it. Refuse UNC paths.

### Code that runs commands

- Anything that runs code needs explicit, informed user consent that shows
  exactly what will run.
- Always set a timeout and kill the whole process tree.

### Dependencies and releases

- Keep Electron on a supported major version. It is the browser engine, so
  security updates matter more here than in a typical Electron app.
- Run `npm audit` before a release. Install with `npm ci`.
- Regenerate `license/THIRD_PARTY_NOTICES.txt` (`npm run notices`).
  `build.ps1` does this for you.
- Don't commit scratch scripts, local paths, `.env` files or credentials.

### Reviews

Run a full security review after any change to IPC, preloads, window
creation, CSP or file access, and save the report as
`security/security-report-YYYY-MM-DD.md`.
