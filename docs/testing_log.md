# Testing Log

Every test in the suite, with its ID, its type, and the features it covers.
There are **168 tests**: **124 unit** tests in `tests/unit/` and **44
end-to-end** tests in `tests/e2e/`. Feature IDs link to
[features.md](features.md). How the tests are written is covered in
[testing_strategy.md](testing_strategy.md).

## How IDs are assigned

A test ID is `<type>-<file code>-<number>`:

- **`UT`** is a unit test and **`E2E`** is an end-to-end test.
- The **file code** names the spec file (see the table below).
- The **number** is the test's position in that file, top to bottom.

The IDs live only in these docs, not in the test code. When you add a test,
give it the next number in its file. When you remove one, retire its ID
rather than renumbering the rest, so links in [features.md](features.md)
stay valid.

| Code | Spec file | Type | Tests |
| --- | --- | --- | --- |
| ADB | `tests/unit/adblock.spec.ts` | Unit | 9 |
| FND | `tests/unit/find.spec.ts` | Unit | 25 |
| HIS | `tests/unit/history.spec.ts` | Unit | 3 |
| MD | `tests/unit/markdown.spec.ts` | Unit | 21 |
| MDF | `tests/unit/markdownFormat.spec.ts` | Unit | 12 |
| MDM | `tests/unit/markdownMain.spec.ts` | Unit (with temp files and child processes) | 22 |
| PTO | `tests/unit/previewTabOrder.spec.ts` | Unit | 5 |
| SYS | `tests/unit/systemStatus.spec.ts` | Unit | 13 |
| URL | `tests/unit/url.spec.ts` | Unit | 16 |
| WSI | `tests/unit/workspaceImages.spec.ts` | Unit (with temp files) | 5 |
| BKM | `tests/e2e/bookmarks.spec.ts` | E2E | 3 |
| FOC | `tests/e2e/focus-mode.spec.ts` | E2E | 1 |
| LCH | `tests/e2e/launch.spec.ts` | E2E | 1 |
| MSL | `tests/e2e/multi-select.spec.ts` | E2E | 9 |
| LIM | `tests/e2e/tab-limit.spec.ts` | E2E | 4 |
| TAB | `tests/e2e/tabs.spec.ts` | E2E | 6 |
| TSR | `tests/e2e/tab-search.spec.ts` | E2E | 6 |
| TRO | `tests/e2e/tab-tear-off.spec.ts` | E2E | 7 |
| TRM | `tests/e2e/terminal.spec.ts` | E2E | 1 |
| TDR | `tests/e2e/titlebar-drag.spec.ts` | E2E | 2 |
| WSP | `tests/e2e/workspaces.spec.ts` | E2E | 4 |

---

## Unit tests

### `adblock.spec.ts`: ad blocking

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-ADB-01 | Unit | stripTrackingParams | removes tracking parameters and keeps the rest, in order | [F7.3](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-02 | Unit | stripTrackingParams | returns null when there is nothing to strip | [F7.3](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-03 | Unit | stripTrackingParams | drops the ? when every parameter was tracking | [F7.3](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-04 | Unit | stripTrackingParams | ignores non-http(s) and malformed URLs | [F7.3](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-05 | Unit | stripTrackingParams | does not touch look-alike parameters | [F7.3](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-06 | Unit | AdBlockStore | defaults to on with no allowed sites | [F7.1](features.md#f7-ad-blocking-and-tracking-protection), [F7.4](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-07 | Unit | AdBlockStore | allowing a site covers its subdomains but not its siblings | [F7.2](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-08 | Unit | AdBlockStore | persists across instances after a flush | [F7.4](features.md#f7-ad-blocking-and-tracking-protection) |
| UT-ADB-09 | Unit | AdBlockStore | a corrupt or hostile file falls back to defaults | [F7.4](features.md#f7-ad-blocking-and-tracking-protection), [F14.4](features.md#f14-security-and-privacy-controls) |

### `find.spec.ts`: find in page

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-FND-01 | Unit | buildFindPattern | an empty query has nothing to look for | [F6.1](features.md#f6-find-in-page) |
| UT-FND-02 | Unit | buildFindPattern | plain text is matched literally, never as a pattern | [F6.1](features.md#f6-find-in-page) |
| UT-FND-03 | Unit | buildFindPattern | ignores case by default, and respects it when asked | [F6.1](features.md#f6-find-in-page) |
| UT-FND-04 | Unit | buildFindPattern | whole word skips matches inside a longer word | [F6.1](features.md#f6-find-in-page) |
| UT-FND-05 | Unit | buildFindPattern | whole word treats digits and underscores as part of a word | [F6.1](features.md#f6-find-in-page) |
| UT-FND-06 | Unit | buildFindPattern | whole word applies to a phrase as a unit, and to every alternative of a regex | [F6.1](features.md#f6-find-in-page) |
| UT-FND-07 | Unit | buildFindPattern | regex mode uses the query as a pattern | [F6.1](features.md#f6-find-in-page) |
| UT-FND-08 | Unit | buildFindPattern | regex mode honours case sensitivity too | [F6.1](features.md#f6-find-in-page) |
| UT-FND-09 | Unit | buildFindPattern | ^ and $ match at line breaks | [F6.1](features.md#f6-find-in-page) |
| UT-FND-10 | Unit | buildFindPattern | a regex that does not compile is reported, not thrown | [F6.1](features.md#f6-find-in-page) |
| UT-FND-11 | Unit | findMatches | matches never overlap | [F6.2](features.md#f6-find-in-page) |
| UT-FND-12 | Unit | findMatches | a pattern that can match nothing neither hangs nor reports empty matches | [F6.2](features.md#f6-find-in-page) |
| UT-FND-13 | Unit | findMatches | empty text has no matches | [F6.2](features.md#f6-find-in-page) |
| UT-FND-14 | Unit | findMatches | stops at the cap and says so | [F6.2](features.md#f6-find-in-page) |
| UT-FND-15 | Unit | findMatches | can be run again with the same pattern (no state left over from the last scan) | [F6.2](features.md#f6-find-in-page) |
| UT-FND-16 | Unit | findMatches | finds unicode text | [F6.2](features.md#f6-find-in-page) |
| UT-FND-17 | Unit | stepIndex | moves forward and back | [F6.3](features.md#f6-find-in-page) |
| UT-FND-18 | Unit | stepIndex | loops past either end | [F6.3](features.md#f6-find-in-page) |
| UT-FND-19 | Unit | stepIndex | a single match loops onto itself | [F6.3](features.md#f6-find-in-page) |
| UT-FND-20 | Unit | stepIndex | with no matches there is nowhere to go | [F6.3](features.md#f6-find-in-page) |
| UT-FND-21 | Unit | stepIndex | steps on from "no current match" to the first or last | [F6.3](features.md#f6-find-in-page) |
| UT-FND-22 | Unit | clampOccurrence | turns a 1-based number into a 0-based position | [F6.3](features.md#f6-find-in-page) |
| UT-FND-23 | Unit | clampOccurrence | clamps out-of-range numbers to the nearest end | [F6.3](features.md#f6-find-in-page) |
| UT-FND-24 | Unit | clampOccurrence | drops a fraction, and refuses what is not a number | [F6.3](features.md#f6-find-in-page) |
| UT-FND-25 | Unit | clampOccurrence | with no matches there is nothing to land on | [F6.3](features.md#f6-find-in-page) |

### `history.spec.ts`: clearing history

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-HIS-01 | Unit | historyCutoff | all time reaches back to nothing | [F5.3](features.md#f5-history) |
| UT-HIS-02 | Unit | historyCutoff | hours, days and weeks count back exactly | [F5.3](features.md#f5-history) |
| UT-HIS-03 | Unit | historyCutoff | months are calendar months | [F5.3](features.md#f5-history) |

### `markdown.spec.ts`: Markdown parsing and rendering

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-MD-01 | Unit | wiki links | a plain link names the note and shows its name | [F10.1](features.md#f10-markdown-notes) |
| UT-MD-02 | Unit | wiki links | an alias is what is shown, a heading is kept in the target | [F10.1](features.md#f10-markdown-notes) |
| UT-MD-03 | Unit | wiki links | an embedded image becomes an image to be loaded by main, with its width | [F10.1](features.md#f10-markdown-notes) |
| UT-MD-04 | Unit | wiki links | markup in a link name can not break out of its attribute | [F10.1](features.md#f10-markdown-notes) |
| UT-MD-05 | Unit | wiki links | splitWikiTarget separates the note from the heading and drops the alias | [F10.1](features.md#f10-markdown-notes) |
| UT-MD-06 | Unit | wiki links | slugifyHeading lowercases, drops punctuation and joins words with dashes | [F10.1](features.md#f10-markdown-notes) |
| UT-MD-07 | Unit | math | inline and display formulas keep their TeX source | [F10.2](features.md#f10-markdown-notes) |
| UT-MD-08 | Unit | math | dollar amounts in prose are not math | [F10.2](features.md#f10-markdown-notes) |
| UT-MD-09 | Unit | math | a formula inside a code span is left alone | [F10.2](features.md#f10-markdown-notes) |
| UT-MD-10 | Unit | code blocks | are numbered in reading order in the rendering | [F10.3](features.md#f10-markdown-notes) |
| UT-MD-11 | Unit | code blocks | are listed by main in that same order | [F10.3](features.md#f10-markdown-notes) |
| UT-MD-12 | Unit | code blocks | the numbering restarts on every render | [F10.3](features.md#f10-markdown-notes) |
| UT-MD-13 | Unit | highlights | ==text== becomes a mark | [F10.3](features.md#f10-markdown-notes) |
| UT-MD-14 | Unit | markdownToPlainText | drops the markers and keeps the words | [F10.11](features.md#f10-markdown-notes) |
| UT-MD-15 | Unit | markdownToPlainText | writes lists with their bullets, numbers and task boxes | [F10.11](features.md#f10-markdown-notes) |
| UT-MD-16 | Unit | markdownToPlainText | shows a wiki link as the name it displays and keeps formulas as written | [F10.11](features.md#f10-markdown-notes) |
| UT-MD-17 | Unit | markdownToPlainText | writes a callout as its title, not its marker | [F10.11](features.md#f10-markdown-notes) |
| UT-MD-18 | Unit | markdownToPlainText | keeps code as written and tables as rows | [F10.11](features.md#f10-markdown-notes) |
| UT-MD-19 | Unit | line endings | are detected by majority and restored on save | [F10.8](features.md#f10-markdown-notes) |
| UT-MD-20 | Unit | toggleTask | flips the nth checkbox, counting only real ones | [F10.4](features.md#f10-markdown-notes) |
| UT-MD-21 | Unit | toggleTask | a checkbox past the end is not found | [F10.4](features.md#f10-markdown-notes) |

### `markdownFormat.spec.ts`: Markdown editor formatting

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-MDF-01 | Unit | bold and italic | wrap the selection and keep it selected | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-02 | Unit | bold and italic | a second press takes the markers off again | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-03 | Unit | bold and italic | with nothing selected a pair goes down with the cursor between | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-04 | Unit | bold and italic | italic is not fooled by the stars of bold | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-05 | Unit | bold and italic | a selection that includes its own markers is unwrapped | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-06 | Unit | blocks | a LaTeX block gets lines of its own around a mid-line selection | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-07 | Unit | blocks | with nothing selected the block is empty and the cursor is inside it | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-08 | Unit | blocks | a whole selected line is wrapped without extra blank lines | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-09 | Unit | links | web addresses and note names are told apart | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-10 | Unit | links | a web link wraps the text, adding https:// when it is missing | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-11 | Unit | links | a note link is a wikilink, aliased when the text differs from the name | [F10.5](features.md#f10-markdown-notes) |
| UT-MDF-12 | Unit | links | applyLink replaces the selected range | [F10.5](features.md#f10-markdown-notes) |

### `markdownMain.spec.ts`: Markdown vault, files and code runner (main process)

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-MDM-01 | Unit | vault: finding notes | a wikilink finds a note by name in another folder, ignoring case and extension | [F10.6](features.md#f10-markdown-notes) |
| UT-MDM-02 | Unit | vault: finding notes | an ordinary link resolves relative to the note, and only to notes that exist | [F10.6](features.md#f10-markdown-notes) |
| UT-MDM-03 | Unit | vault: finding notes | backlinks find both wikilinks and relative links | [F10.6](features.md#f10-markdown-notes) |
| UT-MDM-04 | Unit | vault: finding notes | outside a marked vault, a note is still found one folder up | [F10.6](features.md#f10-markdown-notes) |
| UT-MDM-05 | Unit | vault: finding notes | note names for completion leave out the open note | [F10.6](features.md#f10-markdown-notes) |
| UT-MDM-06 | Unit | vault: finding notes | images are read only if they are pictures | [F10.7](features.md#f10-markdown-notes) |
| UT-MDM-07 | Unit | fetchRemoteImageDataUrl | an https picture comes back as a data URL, fetched without cookies | [F10.7](features.md#f10-markdown-notes) |
| UT-MDM-08 | Unit | fetchRemoteImageDataUrl | anything but https is refused before any request is made | [F10.7](features.md#f10-markdown-notes) |
| UT-MDM-09 | Unit | fetchRemoteImageDataUrl | a redirect away from https, a non-picture, an error status or an oversized body gives nothing | [F10.7](features.md#f10-markdown-notes) |
| UT-MDM-10 | Unit | fetchRemoteImageDataUrl | a failed request gives nothing rather than throwing | [F10.7](features.md#f10-markdown-notes) |
| UT-MDM-11 | Unit | toNoteFileName | keeps only the last segment, strips forbidden characters and adds .md | [F10.8](features.md#f10-markdown-notes) |
| UT-MDM-12 | Unit | toNoteFileName | refuses names that are nothing, dots, or Windows devices | [F10.8](features.md#f10-markdown-notes) |
| UT-MDM-13 | Unit | MarkdownDocuments | saves keep the file's CRLF endings and refuse a stale generation | [F10.8](features.md#f10-markdown-notes) |
| UT-MDM-14 | Unit | MarkdownDocuments | following links builds Back and Forward; stepping returns through them | [F10.8](features.md#f10-markdown-notes) |
| UT-MDM-15 | Unit | MarkdownDocuments | create never overwrites an existing note, and rename refuses paths and clashes | [F10.8](features.md#f10-markdown-notes) |
| UT-MDM-16 | Unit | MarkdownDocuments | a change made on disk is noticed | [F10.8](features.md#f10-markdown-notes) |
| UT-MDM-17 | Unit | running code blocks | the page's list of runnable languages is the runner's | [F10.9](features.md#f10-markdown-notes) |
| UT-MDM-18 | Unit | running code blocks | JavaScript runs, in the note's folder, and reports its output and exit code | [F10.9](features.md#f10-markdown-notes) |
| UT-MDM-19 | Unit | running code blocks | a failing script reports its exit code, and an endless one is stopped | [F10.9](features.md#f10-markdown-notes) |
| UT-MDM-20 | Unit | running code blocks | an unknown language is refused without running anything | [F10.9](features.md#f10-markdown-notes) |
| UT-MDM-21 | Unit | LaTeX completion | math context follows $ and $$, skipping code and escapes | [F10.10](features.md#f10-markdown-notes) |
| UT-MDM-22 | Unit | LaTeX completion | commands are matched by prefix, common ones first | [F10.10](features.md#f10-markdown-notes) |

### `previewTabOrder.spec.ts`: drag-reorder preview

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-PTO-01 | Unit | previewTabOrder | moves the dragged tab before or after the target | [F1.4](features.md#f1-tabs) |
| UT-PTO-02 | Unit | previewTabOrder | leaves the order alone with no target, or when hovering a dragged tab | [F1.4](features.md#f1-tabs) |
| UT-PTO-03 | Unit | previewTabOrder | ignores a target that is not in the strip | [F1.4](features.md#f1-tabs) |
| UT-PTO-04 | Unit | previewTabOrder | moves a multi-selection together, keeping its internal order | [F1.4](features.md#f1-tabs) |
| UT-PTO-05 | Unit | previewTabOrder | never loses or duplicates a tab | [F1.4](features.md#f1-tabs) |

### `systemStatus.spec.ts`: titlebar Wi-Fi, battery and temperature

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-SYS-01 | Unit | parseWlanInterfaces | reads the signal of a connected adapter | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-02 | Unit | parseWlanInterfaces | a disconnected adapter has no signal | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-03 | Unit | parseWlanInterfaces | no wireless adapter (or unreadable output) is unavailable | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-04 | Unit | parseWlanInterfaces | a garbled signal counts as 0, and one out of range is clamped | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-05 | Unit | WifiMonitor | reports only changes, and a failed read as unavailable | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-06 | Unit | wifiBars | lights the arcs in thirds, at least one for any signal | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-07 | Unit | WeatherMonitor | finds the location by IP, then reports the temperature rounded to whole degrees Fahrenheit | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-08 | Unit | WeatherMonitor | looks the location up once an hour, not on every refresh | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-09 | Unit | WeatherMonitor | a failed fetch keeps the last temperature instead of blanking it | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-10 | Unit | WeatherMonitor | falls back to the second location service when the first refuses (ipapi.co rate-limits) | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-11 | Unit | WeatherMonitor | no location, or a malformed answer, fails without throwing | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-12 | Unit | battery | a desktop with no battery is recognized, so the icon hides | [F12.10](features.md#f12-window-and-chrome) |
| UT-SYS-13 | Unit | battery | colors the fill: charging always green, then red at 10% or less and orange at 30% or less | [F12.10](features.md#f12-window-and-chrome) |

### `url.spec.ts`: URL handling

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-URL-01 | Unit | looksLikeUrl | accepts a dot-domain host, with or without a scheme | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-02 | Unit | looksLikeUrl | accepts localhost, bare or with a port | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-03 | Unit | looksLikeUrl | accepts the app's own portalogia: scheme | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-04 | Unit | looksLikeUrl | rejects blank input | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-05 | Unit | looksLikeUrl | rejects free text that looks like a search query | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-06 | Unit | looksLikeUrl | rejects a bare word with no dot, since it cannot be a real host | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-07 | Unit | normalizeUrlOrSearch | adds https:// to a bare domain | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-08 | Unit | normalizeUrlOrSearch | leaves an explicit scheme alone | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-09 | Unit | normalizeUrlOrSearch | falls back to a Google search URL for non-URL text | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-10 | Unit | normalizeUrlOrSearch | blank input goes to about:blank | [F2.1](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-11 | Unit | isNavigableUrl | allows http, https, about, and portalogia | [F14.1](features.md#f14-security-and-privacy-controls) |
| UT-URL-12 | Unit | isNavigableUrl | refuses file: and javascript: URLs | [F14.1](features.md#f14-security-and-privacy-controls) |
| UT-URL-13 | Unit | isNavigableUrl | refuses unparseable input instead of throwing | [F14.1](features.md#f14-security-and-privacy-controls) |
| UT-URL-14 | Unit | domainOfUrl | returns the hostname, without a leading www. | [F2.3](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-15 | Unit | domainOfUrl | keeps non-www subdomains | [F2.3](features.md#f2-navigation-and-the-address-bar) |
| UT-URL-16 | Unit | domainOfUrl | is null for non-web pages, blank input, and garbage | [F2.3](features.md#f2-navigation-and-the-address-bar) |

### `workspaceImages.spec.ts`: workspace images

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| UT-WSI-01 | Unit | WorkspaceImageStore | saves an image with its tabs in order and lists it for the chrome | [F3.7](features.md#f3-workspaces) |
| UT-WSI-02 | Unit | WorkspaceImageStore | saving never overwrites: a changed workspace is a different image | [F3.7](features.md#f3-workspaces) |
| UT-WSI-03 | Unit | WorkspaceImageStore | removing deletes it, and images survive a restart | [F3.7](features.md#f3-workspaces) |
| UT-WSI-04 | Unit | WorkspaceImageStore | renaming changes the name, ignores a blank one, and persists | [F3.7](features.md#f3-workspaces) |
| UT-WSI-05 | Unit | WorkspaceImageStore | a corrupt or malformed file is ignored rather than crashing | [F3.7](features.md#f3-workspaces), [F14.4](features.md#f14-security-and-privacy-controls) |

---

## End-to-end tests

Each of these launches the built app (`out/main/index.js`) in Electron with a
fresh, throwaway profile folder, and drives it through Playwright.

### `bookmarks.spec.ts`: bookmarks

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-BKM-01 | E2E | bookmarks | the star opens a popup to add a bookmark, and removes it instantly once already saved | [F4.1](features.md#f4-bookmarks) |
| E2E-BKM-02 | E2E | bookmarks | the blank default page cannot be bookmarked | [F4.2](features.md#f4-bookmarks) |
| E2E-BKM-03 | E2E | bookmarks | a bookmarked page shows its saved name in a bubble until the address bar is focused | [F4.3](features.md#f4-bookmarks), [F2.3](features.md#f2-navigation-and-the-address-bar) |

### `focus-mode.spec.ts`: Focus Mode

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-FOC-01 | E2E | focus mode | toggling focus mode hides the workspace/tab row and back | [F12.3](features.md#f12-window-and-chrome) |

### `launch.spec.ts`: app launch

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-LCH-01 | E2E | app launch | opens the Portalogia chrome with one home tab and one workspace | [F12.6](features.md#f12-window-and-chrome), [F2.5](features.md#f2-navigation-and-the-address-bar) |

### `multi-select.spec.ts`: selecting several tabs or workspaces

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-MSL-01 | E2E | multi-selecting tabs | Ctrl+click selects along with the active tab, without switching to it | [F1.5](features.md#f1-tabs) |
| E2E-MSL-02 | E2E | multi-selecting tabs | a plain click switches tabs and ends the selection | [F1.5](features.md#f1-tabs), [F1.3](features.md#f1-tabs) |
| E2E-MSL-03 | E2E | multi-selecting tabs | Shift+click selects every tab between the active one and the clicked one | [F1.5](features.md#f1-tabs) |
| E2E-MSL-04 | E2E | multi-selecting tabs | Ctrl+W (Close Tab) closes every selected tab at once | [F1.5](features.md#f1-tabs), [F1.2](features.md#f1-tabs) |
| E2E-MSL-05 | E2E | multi-selecting tabs | dropping one selected tab onto a workspace moves them all | [F1.5](features.md#f1-tabs), [F3.5](features.md#f3-workspaces) |
| E2E-MSL-06 | E2E | multi-selecting tabs | tearing a selected tab out moves the whole selection into one new window | [F1.5](features.md#f1-tabs), [F1.6](features.md#f1-tabs) |
| E2E-MSL-07 | E2E | multi-selecting workspaces | Ctrl+click and Shift+click select workspaces, and Ctrl+Alt+W (Close Workspace) removes them all | [F3.4](features.md#f3-workspaces) |
| E2E-MSL-08 | E2E | multi-selecting workspaces | a plain click on a workspace switches to it and ends the selection | [F3.4](features.md#f3-workspaces) |
| E2E-MSL-09 | E2E | keyboard shortcuts with the hidden spare window present | Ctrl+W and Ctrl+Alt+W act on the visible window | [F12.8](features.md#f12-window-and-chrome) |

### `tab-limit.spec.ts`: tab and workspace limits

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-LIM-01 | E2E | tabs per workspace limit | the "+" disappears at the limit and returns when a tab closes | [F1.7](features.md#f1-tabs) |
| E2E-LIM-02 | E2E | tabs per workspace limit | the main process refuses a ninth tab even when the button is bypassed | [F1.7](features.md#f1-tabs) |
| E2E-LIM-03 | E2E | tabs per workspace limit | another workspace still has room, and a full one rejects a dragged-in tab | [F1.7](features.md#f1-tabs), [F3.5](features.md#f3-workspaces) |
| E2E-LIM-04 | E2E | tabs per workspace limit | the "New workspace" button disappears at 20 workspaces and returns when one is removed | [F3.6](features.md#f3-workspaces), [F3.3](features.md#f3-workspaces) |

### `tabs.spec.ts`: tabs and navigation

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-TAB-01 | E2E | tabs | the new-tab button opens another tab and focuses the address bar | [F1.1](features.md#f1-tabs) |
| E2E-TAB-02 | E2E | tabs | closing a tab removes it and leaves the other active | [F1.2](features.md#f1-tabs) |
| E2E-TAB-03 | E2E | tabs | closing the only tab in a workspace replaces it with a fresh home tab | [F1.2](features.md#f1-tabs) |
| E2E-TAB-04 | E2E | tabs | Ctrl+W closes only the tab, never the window, even with one tab left | [F1.2](features.md#f1-tabs) |
| E2E-TAB-05 | E2E | tabs | Ctrl+W with focus on the sidebar (not tab content) never closes the window | [F1.2](features.md#f1-tabs) |
| E2E-TAB-06 | E2E | tabs | navigating updates the tab title, the address bar, and back/forward state | [F2.2](features.md#f2-navigation-and-the-address-bar) |

### `tab-search.spec.ts`: tab search

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-TSR-01 | E2E | tab search | opens via the search button and closes on Escape | [F1.10](features.md#f1-tabs) |
| E2E-TSR-02 | E2E | tab search | is a modal over the page: blurred still of the tab behind it | [F1.10](features.md#f1-tabs) |
| E2E-TSR-03 | E2E | tab search | lists every tab with its workspace, and filters as you type | [F1.10](features.md#f1-tabs) |
| E2E-TSR-04 | E2E | tab search | Up/Down move the highlight and Enter jumps to that tab | [F1.10](features.md#f1-tabs) |
| E2E-TSR-05 | E2E | tab search | clicking a row jumps to that tab | [F1.10](features.md#f1-tabs) |
| E2E-TSR-06 | E2E | tab search | reaches tabs in other workspaces and switches to their workspace | [F1.10](features.md#f1-tabs) |

### `tab-tear-off.spec.ts`: dragging tabs between windows

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-TRO-01 | E2E | dragging a tab out of the tab strip | a tab over the sidebar column can be pulled straight down and out | [F1.6](features.md#f1-tabs) |
| E2E-TRO-02 | E2E | dragging a tab out of the tab strip | dropping onto a workspace moves the tab there and discards the new window, without errors | [F1.6](features.md#f1-tabs), [F3.5](features.md#f3-workspaces) |
| E2E-TRO-03 | E2E | dragging a tab out of the tab strip | dropping back onto the original workspace removes the scratch workspace and re-appends the tab | [F1.6](features.md#f1-tabs), [F3.5](features.md#f3-workspaces) |
| E2E-TRO-04 | E2E | dragging a tab out of the tab strip | a window's only tab dragged onto another window's tab strip moves, and the emptied window closes | [F1.6](features.md#f1-tabs) |
| E2E-TRO-05 | E2E | dragging a tab out of the tab strip | opens the new window right away, not after a delay | [F1.6](features.md#f1-tabs), [F12.8](features.md#f12-window-and-chrome) |
| E2E-TRO-06 | E2E | dragging a tab out of the tab strip | does not tear off while the cursor stays within the tab strip | [F1.6](features.md#f1-tabs) |
| E2E-TRO-07 | E2E | dragging a tab out of the tab strip | releasing over empty space leaves the new window open with the tab in it | [F1.6](features.md#f1-tabs) |

### `terminal.spec.ts`: terminal

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-TRM-01 | E2E | terminal | a real shell runs `ls` and its output actually renders | [F11.1](features.md#f11-terminal) |

### `titlebar-drag.spec.ts`: title bar drag region

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-TDR-01 | E2E | title bar drag region | the empty part of the tab row is an OS drag region | [F12.1](features.md#f12-window-and-chrome) |
| E2E-TDR-02 | E2E | title bar drag region | tabs, the new-tab button and the window controls opt out of it | [F12.1](features.md#f12-window-and-chrome) |

### `workspaces.spec.ts`: workspaces

| ID | Type | Group | Test | Features |
| --- | --- | --- | --- | --- |
| E2E-WSP-01 | E2E | workspaces | creating a workspace switches to it with a fresh home tab | [F3.1](features.md#f3-workspaces) |
| E2E-WSP-02 | E2E | workspaces | switching workspaces shows only that workspace's tabs | [F3.1](features.md#f3-workspaces) |
| E2E-WSP-03 | E2E | workspaces | double-clicking a workspace pill renames it | [F3.2](features.md#f3-workspaces) |
| E2E-WSP-04 | E2E | workspaces | a workspace can only be removed once there is more than one | [F3.3](features.md#f3-workspaces) |

---

## Coverage by feature area

| Area | Unit | E2E | Total |
| --- | --- | --- | --- |
| F1 Tabs | 5 | 27 | 32 |
| F2 Navigation and the address bar | 13 | 3 | 16 |
| F3 Workspaces | 5 | 11 | 16 |
| F4 Bookmarks | 0 | 3 | 3 |
| F5 History | 3 | 0 | 3 |
| F6 Find in page | 25 | 0 | 25 |
| F7 Ad blocking and tracking protection | 9 | 0 | 9 |
| F8 Annotation tools | 0 | 0 | 0 |
| F9 PDF viewer | 0 | 0 | 0 |
| F10 Markdown notes | 55 | 0 | 55 |
| F11 Terminal | 0 | 1 | 1 |
| F12 Window and chrome | 6 | 6 | 12 |
| F13 Page export | 0 | 0 | 0 |
| F14 Security and privacy controls | 5 | 0 | 5 |

A test that covers features in two areas is counted in both, so this table
adds up to more than 168.
