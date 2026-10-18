# Testing Strategy

This document describes how Northstar is tested: what each kind of test is
for, how to write one, and how tests trace back to features. The full list
of tests is in [testing_log.md](testing_log.md), and the features they cover
are in [features.md](features.md).

## Goals

1. **Catch regressions in behavior users can see.** Tabs, workspaces,
   windows and navigation must keep working as the main process is
   refactored.
2. **Prove the security-relevant logic.** Code that decides what is allowed
   (URL schemes, file names, remote fetches, untrusted files) must be tested
   with hostile input, not just the expected case.
3. **Stay fast and dependable.** Tests never depend on the internet, the
   developer's own profile or timing luck.
4. **Trace every test to a feature.** Then you can see which features have
   no test.

## Test layers

```
          ┌──────────────┐
          │     E2E      │  44 tests: real app, real windows, real shell
          ├──────────────┤
          │     Unit     │  124 tests: pure logic, plus Node-side modules
          └──────────────┘    using real temp files and child processes
     Static checks: TypeScript (3 projects) and ESLint
```

### Static checks

Before any test runs, `npm run typecheck` checks the main, preload and
renderer projects separately, and `npm run lint` runs ESLint with the React
Hooks rules. `build.ps1` refuses to package if the typecheck fails. Strict
types do much of the work a test would otherwise do. For example, the IPC
contract can't drift between preload and main without a compile error.

### Unit tests (`tests/unit/`)

**Purpose:** check logic in isolation, especially edge cases and hostile
input that would be slow or awkward to reach through the interface.

**What qualifies:** any module that can be imported without Electron:

- Pure helpers in `src/shared/` (`url`, `find`, `history`, the Markdown
  parser and plain-text export).
- Renderer helpers in `src/renderer/lib/` (editor formatting, LaTeX
  completion, the drag-reorder preview).
- Main-process modules that only need Node (`AdBlockStore`,
  `WorkspaceImageStore`, `MarkdownVault`, `MarkdownDocuments`,
  `MarkdownCodeRunner`, `snapZones`).

**How:**

- Use Playwright's test runner (`@playwright/test`) for both layers, so there
  is one runner, one config and one reporter.
- Put one `test.describe` per function or class under test.
- Write test titles as plain sentences describing behavior, such as
  "a corrupt or hostile file falls back to defaults", so a failure reads as
  a broken promise.
- **Prefer real dependencies to mocks.** Stores write to a fresh
  `mkdtempSync` folder that `afterEach` deletes. The code runner really runs
  `node`. The vault tests build a small throwaway folder of notes. A stand-in
  is used only where the real thing would reach the internet: the
  `fetchRemoteImageDataUrl` tests pass in a fake `fetch`, which the function
  accepts as a parameter for exactly this purpose.
- Design for testability. A module that needs I/O takes it as a parameter
  (a file path, a `fetch` function, a display list) instead of reaching for
  globals. That is what makes most of main testable without Electron.

### End-to-end tests (`tests/e2e/`)

**Purpose:** check what the user actually does, across the real process
boundary: chrome page to IPC to `TabManager` to native views to state push to
re-render.

**How the harness works** (`tests/e2e/fixtures.ts` and
`tests/global-setup.ts`):

- **Build first.** `globalSetup` runs `npm run build` once per test run, so
  the tests drive the same `out/` bundle a real install runs, never a stale
  one.
- **Fresh profile per test.** The `electronApp` fixture launches
  `out/main/index.js` with `--user-data-dir` set to a new temp folder, and
  deletes it afterward. No test can see another's session, bookmarks or
  history, or the developer's own.
- **No internet.** The `server` fixture serves a few static pages
  (`/widgets`, `/gadgets`), each with its own `<title>`, from a local HTTP
  server on a random port.
- **Find the right window.** Playwright counts every `WebContents` as a
  window, overlays included, so `findChromeWindow` waits for the page whose
  URL ends in `index.html` instead of trusting `firstWindow()`.
- **Menu shortcuts.** Playwright's keyboard drives the page, not the OS menu,
  so `clickMenuItem` runs a menu item by its label. That covers Ctrl+W,
  Ctrl+Alt+W and the rest.
- **A settled start.** The `window` fixture waits for the first tab to exist
  and its spinner to clear before handing over, so tests never race the
  initial state push.

**Conventions:**

- **Locate by role and label** (`getByRole('tablist', { name: 'Open tabs' })`,
  `getByLabel('Search the internet...')`), not by CSS class. This tests
  accessibility for free and survives restyling. Fall back to a class only
  for purely visual state (`.tab-bar__spinner`, `.address-bar__bubble`).
- **Wait for state, not time.** Use `expect(...).toHaveCount()` and
  `toHaveText()`, which retry, instead of fixed sleeps. The one exception is
  proving that something *doesn't* happen (E2E-LIM-02). There, a short wait
  gives a refused action time to show up before the test asserts it didn't.
- **Test the main process's own rules.** A test that only checks a hidden
  button proves nothing about the limit. E2E-LIM-02 calls the API directly
  and checks that main still refuses a ninth tab.
- **Multiple windows.** Tear-off tests use `electronApp.windows()` and
  `electronApp.evaluate()` to inspect `BrowserWindow`s from main. Playwright
  can't drive an OS-level drag, so they dispatch synthetic `DragEvent`s
  that carry a real `DataTransfer`.

## What to test, and how deeply

For each feature, cover these four kinds of case:

| Kind | Example |
| --- | --- |
| **Happy path** | "the new-tab button opens another tab and focuses the address bar" |
| **Boundaries** | the 8-tab and 20-workspace limits, a single find match looping onto itself, an odd-width screen splitting into halves |
| **Failure paths** | a regex that doesn't compile, a failed fetch, a script that never ends |
| **Hostile input** | markup in a wiki-link name, `file:` and `javascript:` URLs, `CON` as a note name, a redirect off https, a corrupt settings file |

Hostile-input tests are required for anything listed in
[security.md](security.md) as a control.

## Traceability

- Every test has an ID of the form `UT-FND-07` or `E2E-TAB-03`. The
  [testing log](testing_log.md#how-ids-are-assigned) explains the scheme.
- Every test lists the feature IDs it covers in the testing log, and every
  feature lists its tests in [features.md](features.md).
- A feature with **No automated test** is a known gap, not an oversight to
  hide.

## Adding a test

1. Find or add the feature in [features.md](features.md).
2. Choose the layer. Use a unit test if the logic can be imported without
   Electron. Use E2E if the behavior crosses the process boundary or depends
   on native views or windows. If both apply, put the edge cases in unit
   tests and keep one E2E test for the wiring.
3. Write the test in the matching spec file, or a new
   `tests/<layer>/<area>.spec.ts` with the standard file header.
4. Run it:

   ```
   npm run test:unit                          # unit tests only (fast)
   npm run test:e2e                           # builds, then runs E2E
   npm test                                   # everything
   npx playwright test tests/unit/url.spec.ts # one file
   npx playwright test -g "closes on Escape"  # by title
   ```

5. Give it the next ID in its file, and add a row to
   [testing_log.md](testing_log.md) with its type and features.
6. Add the ID to the feature's row in [features.md](features.md), and update
   both docs' summary counts.

## CI behavior

`playwright.config.ts` sets:

- `fullyParallel: true`. Tests must not share state, which the per-test
  profile and per-test server make true.
- `forbidOnly` on CI, so a stray `test.only` fails the build.
- One retry on CI, and none locally. A test that needs its retry is flaky,
  and should be fixed rather than tolerated.
- A 30 s timeout per test.

## Current gaps and priorities

From the **No automated test** rows in [features.md](features.md), in order
of risk:

1. **Security controls without tests.** The permission handler (F14.2),
   code-run consent (F14.3), annotation privacy (F14.5) and sender guards.
   These need E2E tests that try the attack, such as a tab page sending a
   chrome IPC channel and the test checking that it is refused.
2. **Annotation tools (F8) and the PDF viewer (F9).** These are large,
   user-visible features with no tests. Start with E2E tests that place a
   mark, restart, and check that it is still there, plus unit tests for
   `PdfCropExporter`'s coordinate mapping.
3. **Persistence.** Session restore (F12.7), history recording (F5.1) and
   bookmarks persistence. Unit-test the stores with temp files, as
   `WorkspaceImageStore` already is.
4. **Markdown export (F10.11)** to PDF and `.md`, and page export (F13).
5. **Remaining tab actions.** Reopen closed tab (F1.8), duplicate (F1.9),
   zoom (F2.6), theme and accent color (F12.5), sidebar (F12.4).
