# Features

This is Northstar's feature list. Features are grouped into areas (`F1`,
`F2`, ...), and each area holds its individual features (`F1.1`, `F1.2`, ...).
Every feature lists the tests that cover it. The test IDs are defined in
[testing_log.md](testing_log.md), and the reasoning behind the IDs is in
[testing_strategy.md](testing_strategy.md).

A feature marked **No automated test** works in the app but has no test yet.
Those rows are the coverage gaps.

## Summary

| Area | Features | With tests | Without tests |
| --- | --- | --- | --- |
| F1 Tabs | 10 | 8 | 2 |
| F2 Navigation and the address bar | 6 | 4 | 2 |
| F3 Workspaces | 8 | 7 | 1 |
| F4 Bookmarks | 4 | 3 | 1 |
| F5 History | 4 | 1 | 3 |
| F6 Find in page | 4 | 3 | 1 |
| F7 Ad blocking and tracking protection | 4 | 4 | 0 |
| F8 Annotation tools | 7 | 0 | 7 |
| F9 PDF viewer | 7 | 0 | 7 |
| F10 Markdown notes | 11 | 11 | 0 |
| F11 Terminal | 2 | 1 | 1 |
| F12 Window and chrome | 9 | 5 | 4 |
| F13 Page export | 2 | 0 | 2 |
| F14 Security and privacy controls | 6 | 2 | 4 |
| **Total** | **84** | **49** | **35** |

---

## F1 Tabs

| ID | Feature | Tests |
| --- | --- | --- |
| F1.1 | **Open a new tab.** The "+" button opens a home tab and puts the cursor in the address bar. | E2E-TAB-01 |
| F1.2 | **Close a tab.** The × button or Ctrl+W closes the tab. Closing a workspace's last tab replaces it with a fresh home tab. Ctrl+W never closes the window, even when the sidebar has focus. | E2E-TAB-02, E2E-TAB-03, E2E-TAB-04, E2E-TAB-05, E2E-MSL-04 |
| F1.3 | **Switch tabs.** Click a tab, or use Ctrl+← / Ctrl+→. | E2E-MSL-02 |
| F1.4 | **Reorder tabs by dragging.** A live preview shows the new order while you drag, and a multi-selection moves together. | UT-PTO-01, UT-PTO-02, UT-PTO-03, UT-PTO-04, UT-PTO-05 |
| F1.5 | **Select several tabs.** Ctrl+click adds or removes one tab. Shift+click selects a range. A plain click ends the selection. | E2E-MSL-01, E2E-MSL-02, E2E-MSL-03, E2E-MSL-04, E2E-MSL-05, E2E-MSL-06 |
| F1.6 | **Tear a tab off into its own window.** Drag a tab out of the strip to open it in a new window that follows the cursor. Drop it on another window's tab strip or a workspace to move it there. A window's only tab moves the whole window. | E2E-TRO-01, E2E-TRO-02, E2E-TRO-03, E2E-TRO-04, E2E-TRO-05, E2E-TRO-06, E2E-TRO-07, E2E-MSL-06 |
| F1.7 | **Tab limit.** A workspace holds at most 8 tabs. The "+" button hides at the limit, and the main process refuses a ninth tab even if the button is bypassed. | E2E-LIM-01, E2E-LIM-02, E2E-LIM-03 |
| F1.8 | **Reopen a closed tab** (Ctrl+T or Ctrl+Shift+T). | No automated test |
| F1.9 | **Duplicate a tab** (Ctrl+Shift+D). | No automated test |
| F1.10 | **Tab search** (Ctrl+K). A modal lists every tab in every workspace, filters as you type, and jumps to the chosen tab, switching workspace if needed. | E2E-TSR-01, E2E-TSR-02, E2E-TSR-03, E2E-TSR-04, E2E-TSR-05, E2E-TSR-06 |

## F2 Navigation and the address bar

| ID | Feature | Tests |
| --- | --- | --- |
| F2.1 | **Address or search.** Text that looks like an address (a dotted domain, `localhost`, `northstar:`) is opened, with `https://` added if needed. Anything else becomes a Google search. | UT-URL-01, UT-URL-02, UT-URL-03, UT-URL-04, UT-URL-05, UT-URL-06, UT-URL-07, UT-URL-08, UT-URL-09, UT-URL-10 |
| F2.2 | **Back, forward, reload, stop.** The tab title, address bar and back/forward buttons follow the page. | E2E-TAB-06 |
| F2.3 | **Page label.** When the address bar isn't focused, a bubble shows the bookmark name or the site's domain. The tab shows the same text. | UT-URL-14, UT-URL-15, UT-URL-16, E2E-BKM-03 |
| F2.4 | **Address suggestions.** Matching bookmarks and history appear in a dropdown while you type. | No automated test |
| F2.5 | **Home page** (`northstar://home`). A blank new-tab page served by the app with no script. | E2E-LCH-01 |
| F2.6 | **Page zoom** (25%–200%) with Ctrl+=, Ctrl+-, Ctrl+0, Ctrl+wheel, or by typing a percentage. | No automated test |

## F3 Workspaces

| ID | Feature | Tests |
| --- | --- | --- |
| F3.1 | **Create and switch workspaces.** A new workspace opens with a fresh home tab, and each workspace shows only its own tabs. | E2E-WSP-01, E2E-WSP-02 |
| F3.2 | **Rename and edit a workspace.** Double-click to rename. The Edit Workspace popup (Ctrl+Shift+E) also sets its color and icon. | E2E-WSP-03 |
| F3.3 | **Remove a workspace.** Only possible while more than one exists. | E2E-WSP-04, E2E-LIM-04 |
| F3.4 | **Select several workspaces.** Ctrl+click and Shift+click, then Close Workspace (Ctrl+Alt+W) removes them all. | E2E-MSL-07, E2E-MSL-08 |
| F3.5 | **Move tabs between workspaces.** Drop a tab (or a selection) on a workspace pill, or on "New workspace" to make one around it. A full workspace refuses the drop. | E2E-MSL-05, E2E-LIM-03, E2E-TRO-02, E2E-TRO-03 |
| F3.6 | **Workspace limit.** At most 20 workspaces. The "New workspace" button hides at the limit. | E2E-LIM-04 |
| F3.7 | **Workspace images** (Ctrl+Shift+S). Save a workspace's tabs as a named snapshot, then reopen, rename or delete it later. | UT-WSI-01, UT-WSI-02, UT-WSI-03, UT-WSI-04, UT-WSI-05 |
| F3.8 | **Workspaces shared across windows.** Every window sees the same workspaces and tabs. "Open Tab in New Window" (Ctrl+Shift+O) opens a linked copy of the active tab in a new window. | No automated test |

## F4 Bookmarks

| ID | Feature | Tests |
| --- | --- | --- |
| F4.1 | **Bookmark a page.** The star (or Ctrl+B) opens a popup to name and save it. Pressing it on a saved page removes the bookmark at once. | E2E-BKM-01 |
| F4.2 | **The blank home page can't be bookmarked.** | E2E-BKM-02 |
| F4.3 | **Bookmark names in the chrome.** A saved page shows its bookmark name on its tab and in the address bar bubble. | E2E-BKM-03 |
| F4.4 | **Bookmark PDFs and notes**, and reopen them from the address bar suggestions. | No automated test |

## F5 History

| ID | Feature | Tests |
| --- | --- | --- |
| F5.1 | **Record history.** Pages, PDFs and notes are recorded with title and time, capped at 50,000 entries. | No automated test |
| F5.2 | **History tab** (Ctrl+Shift+H). Lists entries, filters by search text, and deletes or copies single entries. | No automated test |
| F5.3 | **Clear history by time range.** Choose hours, days, weeks, months or all time. Months are calendar months. | UT-HIS-01, UT-HIS-02, UT-HIS-03 |
| F5.4 | **Reopen a PDF or note from history.** Only paths already in history are accepted. | No automated test |

## F6 Find in page

| ID | Feature | Tests |
| --- | --- | --- |
| F6.1 | **Search options.** Match Case, Whole Word and Regular Expression. Plain text is always matched literally, and a broken regex is reported, not thrown. | UT-FND-01, UT-FND-02, UT-FND-03, UT-FND-04, UT-FND-05, UT-FND-06, UT-FND-07, UT-FND-08, UT-FND-09, UT-FND-10 |
| F6.2 | **Match counting.** Matches never overlap, empty matches can't hang the search, results stop at a cap, and Unicode works. | UT-FND-11, UT-FND-12, UT-FND-13, UT-FND-14, UT-FND-15, UT-FND-16 |
| F6.3 | **Step through matches.** Enter and Shift+Enter loop past either end, and typing a match number jumps to it. | UT-FND-17, UT-FND-18, UT-FND-19, UT-FND-20, UT-FND-21, UT-FND-22, UT-FND-23, UT-FND-24, UT-FND-25 |
| F6.4 | **One find bar for every tab kind.** The same bar (Ctrl+F) searches web pages, PDFs, notes and terminals. | No automated test |

## F7 Ad blocking and tracking protection

| ID | Feature | Tests |
| --- | --- | --- |
| F7.1 | **Ad and tracker blocking.** Uses Ghostery's filter lists, is on by default, and can be turned off app-wide from the View menu. | UT-ADB-06 |
| F7.2 | **Allow a site.** The shield button (Ctrl+Shift+B) allows ads on one site, including its subdomains but not its sibling sites. | UT-ADB-07 |
| F7.3 | **Strip tracking parameters** (such as `utm_*` and `fbclid`) from links, leaving other parameters alone. | UT-ADB-01, UT-ADB-02, UT-ADB-03, UT-ADB-04, UT-ADB-05 |
| F7.4 | **Remember ad-blocker settings** across restarts. A corrupt settings file falls back to safe defaults. | UT-ADB-06, UT-ADB-08, UT-ADB-09 |

## F8 Annotation tools

These work on web pages, and the PDF viewer and Markdown notes provide their
own versions. Marks are saved by the app, never written into the page or file.

| ID | Feature | Tests |
| --- | --- | --- |
| F8.1 | **Highlighter** (Ctrl+J). Highlights selected text in the accent color. | No automated test |
| F8.2 | **Pen** (Ctrl+P). Draws freehand over the page. | No automated test |
| F8.3 | **Comments** (Ctrl+M). Pins a note at a spot on the page. | No automated test |
| F8.4 | **Text boxes** (Ctrl+E). Places text with a chosen size and alignment. | No automated test |
| F8.5 | **Laser pointer** (Ctrl+I). Shows a trailing pointer for presenting. Nothing is saved. | No automated test |
| F8.6 | **Revert annotations** (Ctrl+Shift+R). Removes a page's marks. | No automated test |
| F8.7 | **Undo and redo** for marks, with Ctrl+Z and Ctrl+Y. | No automated test |

## F9 PDF viewer

| ID | Feature | Tests |
| --- | --- | --- |
| F9.1 | **Open a PDF** (Ctrl+Shift+P for a viewer tab, Ctrl+O to pick a file) and close it (Ctrl+Shift+C). | No automated test |
| F9.2 | **Go to a page.** Type a page number, with the page count shown next to it. | No automated test |
| F9.3 | **Pointer modes.** Pan drags the document. Select picks text and lets you click links. | No automated test |
| F9.4 | **Mark up a PDF** with the pen, highlighter, comments and text boxes. Marks are stored apart from the file. | No automated test |
| F9.5 | **Crop** (Ctrl+Shift+X). Draw crop boxes on pages. | No automated test |
| F9.6 | **Export a copy** with crops, drawings, text boxes and highlights burned in. | No automated test |
| F9.7 | **Rename** the open PDF from the toolbar. | No automated test |

## F10 Markdown notes

| ID | Feature | Tests |
| --- | --- | --- |
| F10.1 | **Wiki links.** `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]` and embedded images `![[pic.png\|300]]`. Markup in a link name can't escape. | UT-MD-01, UT-MD-02, UT-MD-03, UT-MD-04, UT-MD-05, UT-MD-06 |
| F10.2 | **Math.** Inline `$…$` and display `$$…$$` LaTeX via KaTeX. Dollar amounts and code spans are left alone. | UT-MD-07, UT-MD-08, UT-MD-09 |
| F10.3 | **Rich rendering.** `==highlights==`, callouts, task lists and syntax-highlighted code blocks, numbered in reading order. | UT-MD-10, UT-MD-11, UT-MD-12, UT-MD-13 |
| F10.4 | **Toggle task checkboxes** in view mode, which writes the change back to the note. | UT-MD-20, UT-MD-21 |
| F10.5 | **Editor formatting.** Bold, italic, LaTeX block and link commands toggle cleanly. | UT-MDF-01, UT-MDF-02, UT-MDF-03, UT-MDF-04, UT-MDF-05, UT-MDF-06, UT-MDF-07, UT-MDF-08, UT-MDF-09, UT-MDF-10, UT-MDF-11, UT-MDF-12 |
| F10.6 | **Vault links and backlinks.** Wiki links find notes anywhere in the vault, ignoring case and extension. Relative links resolve against the note. The side panel lists backlinks. | UT-MDM-01, UT-MDM-02, UT-MDM-03, UT-MDM-04, UT-MDM-05 |
| F10.7 | **Images.** Local images are read only if they are pictures. A web image loads only when clicked, over https only, without cookies, and size-capped. | UT-MDM-06, UT-MDM-07, UT-MDM-08, UT-MDM-09, UT-MDM-10 |
| F10.8 | **Note files.** Create, rename, save and follow links with Back/Forward. Saves keep the file's line endings and refuse stale edits. Names are made safe for the file system. Changes made outside the app are noticed. | UT-MD-19, UT-MDM-11, UT-MDM-12, UT-MDM-13, UT-MDM-14, UT-MDM-15, UT-MDM-16 |
| F10.9 | **Run code blocks** (JavaScript, Python, shell, PowerShell, Ruby, Go and more) after a consent prompt. Shows output and exit code, and stops runaway scripts. | UT-MDM-17, UT-MDM-18, UT-MDM-19, UT-MDM-20 |
| F10.10 | **LaTeX autocomplete** inside `$…$`, skipping code and escaped dollars, with common commands first. | UT-MDM-21, UT-MDM-22 |
| F10.11 | **Export a note** as PDF, Markdown or plain text. | UT-MD-14, UT-MD-15, UT-MD-16, UT-MD-17, UT-MD-18 |

> F10.11's tests cover the plain-text conversion only. The PDF and `.md`
> exports have no test.

## F11 Terminal

| ID | Feature | Tests |
| --- | --- | --- |
| F11.1 | **Terminal tab** (Ctrl+>). Runs a real shell: Git Bash, then WSL, then PowerShell on Windows, or `$SHELL` elsewhere. | E2E-TRM-01 |
| F11.2 | **Terminal keeps running across windows.** A terminal tab can be moved or torn off without killing its shell. | No automated test |

## F12 Window and chrome

| ID | Feature | Tests |
| --- | --- | --- |
| F12.1 | **Frameless window with a drag strip.** A thin strip above the tabs moves the window and shows hover and pressed states without covering the window buttons. | E2E-GRP-01, E2E-GRP-02 |
| F12.2 | **Snap zones.** Dragging the window to an edge snaps it to a half, a corner or maximized, on whichever display the cursor is on. | UT-SNP-01, UT-SNP-02, UT-SNP-03, UT-SNP-04, UT-SNP-05, UT-SNP-06 |
| F12.3 | **Focus Mode** (Ctrl+Shift+F). Hides the tab and workspace rows so only the page shows. | E2E-FOC-01 |
| F12.4 | **Collapsible sidebar** (Ctrl+L). | No automated test |
| F12.5 | **Light and dark themes** (Ctrl+D) and a custom **accent color**. | No automated test |
| F12.6 | **Launch.** Opens one window with one home tab and one workspace. | E2E-LCH-01 |
| F12.7 | **Session restore.** Open tabs and workspaces come back after a restart. | No automated test |
| F12.8 | **Instant new windows.** A hidden spare window is kept ready so torn-off tabs appear at once, and shortcuts still act on the visible window. | E2E-TRO-05, E2E-MSL-09 |
| F12.9 | **Split view.** Two tabs side by side, with a chip to exit. The main process supports it, but nothing in the interface starts it yet. | No automated test |

## F13 Page export

| ID | Feature | Tests |
| --- | --- | --- |
| F13.1 | **Export a page to PDF** (File > Export Page to PDF…). | No automated test |
| F13.2 | **Save a page's documents.** Saves the HTML plus its stylesheets and scripts to a folder, so it opens offline. | No automated test |

## F14 Security and privacy controls

These are features in their own right, not just implementation details.
[security.md](security.md) explains each one.

| ID | Feature | Tests |
| --- | --- | --- |
| F14.1 | **Scheme allowlist.** Only `http`, `https`, `about` and `northstar` URLs can be opened. `file:` and `javascript:` are refused. | UT-URL-11, UT-URL-12, UT-URL-13 |
| F14.2 | **Site permissions denied.** Camera, microphone, location, notifications and the rest are refused. Only full-screen is granted, to web pages. | No automated test |
| F14.3 | **Code-run consent.** Each code block asks before it first runs, and trust lasts until the app restarts. Changing the code asks again. | No automated test |
| F14.4 | **Untrusted files are validated.** Every settings and data file is checked on read, and a corrupt one is ignored rather than crashing. | UT-ADB-09, UT-WSI-05 |
| F14.5 | **Private annotations.** Comment and text-box text sits in a closed shadow root that the page's scripts can't read. | No automated test |
| F14.6 | **No telemetry.** Nothing is sent to the developer. See [privacy.md](privacy.md). | No automated test |
