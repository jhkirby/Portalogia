# Northstar CodeQL

Static analysis for Northstar. It has two parts: a CodeQL query pack written for this codebase (`northstar/security-queries`), and GitHub's standard `javascript-security-extended` suite, run alongside it as a baseline.

## Running it

```powershell
# from the repo root
powershell -NoProfile -ExecutionPolicy Bypass -File security/codeql/run-analysis.ps1
# reuse an existing database:
powershell -NoProfile -ExecutionPolicy Bypass -File security/codeql/run-analysis.ps1 -SkipDatabase
```

The script finds `codeql` on `PATH`, or otherwise uses the copy that the VS Code CodeQL extension downloads. You can also pass `-CodeQL <path>`. The script then:

1. installs the pack dependencies (`codeql/javascript-all`, `codeql/javascript-queries`);
2. extracts `src/`, `scripts/` and `electron.vite.config.ts` into `databases/northstar-js`. The scope is set in `codeql-config.yml`; tests and build output are left out;
3. writes SARIF and CSV for both suites to `results/`.

`databases/` and `results/` are git-ignored. Summarise each run in `security/reports/security-report-<datetime>.md`.

To run a single query while you work on it:

```powershell
codeql query run queries/IpcToFileSystemPath.ql -d databases/northstar-js -o results/q.bqrs
codeql bqrs decode results/q.bqrs --format=csv --entities=url
```

## What the custom queries look for

They cover the trust boundaries that matter in an Electron browser: renderer → main IPC, main → page script, and untrusted content → DOM.

| Query | Id | Looks for |
|---|---|---|
| `IpcHandlerMissingSenderCheck` | `northstar/ipc-handler-missing-sender-check` | `ipcMain` handlers that never authorise `event.sender` |
| `IpcPayloadNotValidated` | `northstar/ipc-payload-not-validated` | IPC payloads that never reach a zod `parse`/`safeParse` |
| `IpcAttackSurface` | `northstar/ipc-attack-surface` | Inventory of every handler, its shape, and whether it is authorised |
| `IpcToFileSystemPath` | `northstar/ipc-to-filesystem-path` | IPC data → `fs` path argument (CWE-22/73) |
| `IpcToCommandExecution` | `northstar/ipc-to-command-execution` | IPC data → `child_process`, `node-pty` spawn, or pty `write` (CWE-78) |
| `IpcToOutboundRequest` | `northstar/ipc-to-outbound-request` | IPC data → a URL that the main process fetches (SSRF, CWE-918) |
| `IpcToUnvalidatedNavigation` | `northstar/ipc-to-unvalidated-navigation` | IPC data → `loadURL`/`createTab`/`openExternal` without passing `isNavigableUrl` |
| `ElectronInsecureWebPreferences` | `northstar/electron-insecure-webpreferences` | `BrowserWindow`/`WebContentsView` without hardened `webPreferences` |
| `ExecuteJavaScriptDynamicCode` | `northstar/execute-javascript-dynamic-code` | `executeJavaScript` with interpolated text that is neither constant nor JSON-serialised |
| `UnsanitizedHtmlSink` | `northstar/unsanitized-html-sink` | `innerHTML` and similar sinks not provably fed by `DOMPurify.sanitize` |
| `PreloadExposesRawIpc` | `northstar/preload-exposes-raw-ipc` | `contextBridge` APIs that expose raw channels, `ipcRenderer`, or the IPC event |
| `PagePreloadExposesUiToPage` | `northstar/page-preload-ui-exposed` | `tab*` preloads that use open shadow roots, or adopt page-owned elements as containers |
| `WeakContentSecurityPolicy` | `northstar/weak-content-security-policy` | CSP strings with `unsafe-*` or scheme-wide sources |
| `UnvalidatedJsonParse` | `northstar/unvalidated-json-parse` | Main-process `JSON.parse` results that never reach a schema check |

## How the IPC model works

`lib/NorthstarIpc.qll` describes the project's conventions so that the queries can follow them:

- **Handlers** include callbacks passed straight to `ipcMain.on/handle`. They also include the `action` lambdas passed to registration helpers: `handle(channel, schema, action)` in `registerTabIpc.ts`, and `invokeForTab`/`invokeFromPage` in `registerMarkdownIpc.ts`. A function counts as a helper only if it takes the channel as a parameter.
- **Sender guards** are listed by name in `isSenderGuardName`: `chromeWindowOf`, `isChromeSender`, `owns*Contents`, `resolveTabManager*`, and so on. A sender identity comparison (`view.webContents === sender`), reached through calls, also counts. **Add a name there when you introduce a new guard.**
- **Taint** passes through `schema.safeParse(raw).data`. Validation constrains a payload's shape, not its content.
- **Barriers:** `basename`/`toNoteFileName` and `has*Access(path)` sanitise paths. `isNavigableUrl(url)` sanitises navigation.
