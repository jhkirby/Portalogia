# Editing, PDF and chrome polish — build checklist

Started 2026-10-17. Ten requests: two keyboard rules for text boxes, a
Markdown mode split, four chrome visual changes, and three PDF fixes. Each
item lists the files it touches, then a check to confirm it works.

---

## 1. Escape leaves a text box

Pressing Escape while typing in any text box (or in a Markdown note's editor)
takes the caret out of it.

- [x] Every page's preload (`src/preload/index.ts`, `markdown.ts`, `pdf.ts`,
      `tabZoom.ts`) blurs the focused editable element on a plain Escape.
      This runs after the page's own handlers and is skipped if one of them
      called `preventDefault` (closing a completion list or a popup comes
      first). `tabZoom.ts` uses `deepActiveElement`, so the comment and
      text-box tools' shadow roots are covered too.
- [x] The Markdown editor (CodeMirror, `MarkdownEditor.tsx`) binds Escape to
      blur, ordered after the completion keymap so an open completion list
      closes first.
- [x] The tab view's `before-input-event` in main (`TabManager.ts`
      `wireSharedInputHandling`) no longer takes Escape (Focus Mode or pointer
      tools) while the page reports editable focus.
- [x] The chrome's Escape listener (`App.tsx`) ignores Escape that starts in a
      text field.
- [x] Check: the address bar, a Markdown editor, a PDF comment and a web page's
      search box all lose their caret on Escape. A second Escape still exits
      Focus Mode or the pointer tools.

## 2. Text boxes keep their own keys

While the caret is in a text box, no app shortcut takes a key the box would
use. After Escape (item 1), the shortcuts work again.

- [x] Add `isTextEditingChord(input, context)` in a new pure module,
      `src/main/browser/textEditingChords.ts`, with unit tests in
      `tests/unit/textEditingChords.spec.ts`. It covers Ctrl/Alt (+Shift) with
      the arrow keys, Home, End, Page Up/Down, Backspace and Delete;
      Ctrl+A/C/V/X/Z/Y and Ctrl+Shift+Z/V; in the note editor, CodeMirror's
      own Windows chords (Ctrl+/ comment, Ctrl+[ ] indent, Ctrl+Enter, Ctrl+M);
      and in a web page's rich editor, Ctrl+B/I/U. The preloads report
      `'plain'` or `'rich'` focus to `editableFocus.ts`.
      *Found while testing:* CodeMirror's select-line is Alt+L on Windows,
      not Ctrl+L, so Ctrl+L stays the app's Toggle Sidebar everywhere and its
      menu accelerator stays registered.
- [x] The tab view's `before-input-event` (`wireSharedInputHandling`) returns
      early for those chords while the view has editable focus. That covers
      Ctrl+Z/Y with a tool on, Ctrl+↑/↓ and Alt+←/→.
- [x] The chrome window's `before-input-event` (`TabManager` constructor) does
      the same for the chrome's own text fields. It also takes over the menu
      items whose accelerators conflict with editing.
- [x] In `buildMenu.ts`, Back/Forward (Alt+←/→), Next/Previous Workspace
      (Ctrl+↓/↑), Laser Pointer (Ctrl+I) and Focus Address Bar (Ctrl+/)
      become display-only (`registerAccelerator: false`). `TabManager`'s input
      handlers dispatch them instead, so they can stand aside for a text box.
      The laser overlay handles Ctrl+I itself (turns the pointer off) while it
      has focus.
- [x] `formatMarkdown` only sends Ctrl+B/I/Shift+U/L/K to the editor while
      the editor actually has the caret. After Escape, Ctrl+B bookmarks again.
- [x] Check: in the Markdown editor, Ctrl+→ jumps a word instead of switching
      tabs. After Escape, Ctrl+→ switches tabs again.

## 3. Markdown: View/Edit and Raw/Formatted toggles

Two independent switches. View/Edit sets whether the note can be edited.
Raw/Formatted sets whether you see the exact characters or the rendered note.
Edit + Formatted edits the rendered note in place, like Obsidian's live
preview. New tabs start as View + Formatted.

- [x] `src/shared/tab-state.ts`: add `display: 'formatted' | 'raw'` to
      `MarkdownTabState`, next to `mode`.
- [x] IPC: add a `MarkdownSetDisplay` request (`ipc-contract.ts`,
      `ipc-schemas.ts`, `registerMarkdownIpc.ts`, `preload/index.ts`) and a
      `MarkdownDisplay` push to the page (`preload/markdown.ts` `onDisplay`).
- [x] `TabManager`: `setMarkdownDisplay`, push the display on load and on
      adopt, reset to formatted on close, and keep it in the saved session.
- [x] `useTabs.ts` / `App.tsx`: wire `setMarkdownDisplay` to the toolbar.
- [x] `MarkdownToolbar.tsx`: a second segmented switch, Raw | Formatted,
      next to View | Edit.
- [x] `MarkdownViewer.tsx` renders by (mode, display):
  - [x] View + Formatted: the rendered reader (as today; marks and tools work).
  - [x] View + Raw: CodeMirror, read-only, showing the source characters.
  - [x] Edit + Raw: CodeMirror, editable (today's Edit).
  - [x] Edit + Formatted: CodeMirror with a live-preview extension.
- [x] New `src/renderer/lib/markdown/livePreview.ts`: a CodeMirror extension
      that hides Markdown syntax marks (`#`, `**`, `*`, `` ` ``, `>`, link
      brackets and URLs) except on lines the selection touches. It styles
      headings by level, bold, italic, strikethrough, inline code, quotes and
      links. It draws `- [x]` as a checkbox that toggles on click, and `---`
      as a rule.
- [x] `MarkdownEditor.tsx` takes `readOnly` and `livePreview` props, applied
      through compartments, so switching keeps the undo history.
- [x] Styles for the live preview in `markdown-viewer.css`, matching the
      reader's heading sizes.
- [x] Ctrl+Shift+G still toggles View/Edit. The menu entry is unchanged.
      Raw/Formatted has no shortcut.
- [x] Marking tools (pen, highlighter, comment) are available only in
      View + Formatted (`canEnableTool` in main, `annotationToolsLocked` in
      `App.tsx`).
- [x] Check: all four combinations, switching back and forth keeps scroll and
      undo, and a new tab opens as View + Formatted.

## 4. Collapsed sidebar: no star on hover

- [x] `workspace-bar.css`: under `.sidebar--hidden`, a hovered or focused pill
      keeps its glyph and never shows `.workspace-bar__star`.
- [x] Check: collapse with Ctrl+L, hover a workspace, and the icon stays
      visible and clickable. Expanded, the star still appears.

## 5. Laser strokes never join

- [x] `LaserPointerOverlayView.tsx`: tag each trail point with a stroke
      number that increments on every press, and only draw segments between
      points of the same stroke.
- [x] Check: draw, release, press somewhere else, and no line joins the two.

## 6. Smaller hover circles that grow and shrink

- [x] New shared stylesheet `styles/components/hover-grow.css` with a
      `.hover-grow` class. Its hover background is a `::before` layer that
      scales from small to full size on hover and back down on release. The
      colour comes from `--hover-grow-bg`; reduced motion turns the scale off.
- [x] `.tab-bar__new`: the circle drops from 28px to 21px (about 75%), and
      the button uses `hover-grow`.
- [x] Every button whose hover only fills a background moves to
      `hover-grow`, with its old `:hover { background }` rule removed. That
      is: tab close, sidebar toggle, workspace new / images / edit / remove,
      nav controls, page actions, address-bar star, Markdown and PDF toolbar
      buttons and stars, the Markdown mode segments, find-bar buttons, the
      bookmark popup close and cancel, split-indicator exit, tab-search
      remove and rename, history row actions and clear, window controls, the
      Markdown panel toggle and code-block buttons. List rows and menu items
      are not buttons in this sense and keep their plain highlight.
- [x] Check: hover each one and see the circle grow; move away and see it
      shrink.

## 7. Ripple when a tab is clicked

- [x] `TabBar.tsx`: a plain left-click on a tab (not on its close button, and
      not a Ctrl- or Shift-click) adds a ripple at the press point. It is
      removed when its animation ends.
- [x] `tab-bar.css`: a `.tab-bar__ripple` layer clipped to the tab's shape,
      in the accent colour, that scales out and fades. Reduced motion skips it.
- [x] Check: clicking a tab ripples from the cursor, and fast repeated clicks
      don't leave stray elements behind.

## 8. No white flash opening a PDF (dark mode)

- [x] `TabManager.ts`: app-owned tab views (PDF, Markdown, History) get
      `setBackgroundColor` set to the theme's chrome background when they
      are created. It updates on `nativeTheme` `updated`.
- [x] Check: in dark mode, Ctrl+Shift+P opens a tab that is dark from the
      first frame.

## 9. Panning doesn't move the pointer on release

- [x] `PdfViewer.tsx`: drop the pointer-lock and stand-in hand. Pan with
      pointer capture instead, so the real pointer stays where it is and is
      exactly where you let go. Remove `.pdf-viewer__grab-hand`.
- [x] Check: drag-pan and release, and the pointer stays under your hand.

## 10. PDF Pan and Select modes

- [x] `PdfTabState` gets `pointerMode: 'pan' | 'select'` (default `pan`),
      with `PdfSetPointerMode` IPC from the toolbar and a `PdfPointerMode`
      push to the page (`preload/pdf.ts` `onPointerMode`).
- [x] `PdfToolbar.tsx`: two icon buttons, a hand (Pan) and a text cursor
      (Select), with the active one pressed. New icons go in
      `components/icons`.
- [x] `PdfPage.tsx`: a link layer built from the page's `Link` annotations.
      Internal links scroll to their page, and web links open in a new tab.
      Links only take clicks in Select mode.
- [x] `PdfViewer.tsx`:
  - [x] Pan: dragging pans, the text can't be selected, and links ignore the
        pointer.
  - [x] Select: dragging selects text, links work, and there's no panning.
  - [x] Both: a press on the scroll bars is never captured, so the scroll
        bars drag normally with the normal pointer.
- [x] Check: switch modes and confirm selection, links and panning in each,
      and drag a scroll bar in both.

---

## Wrap-up

- [x] `npm run typecheck` passes.
- [x] `npm run lint` on the changed files: no new findings. The 3 that remain
      were already in untouched lines: `useTabs.ts` `prefer-const`, plus two
      unused-variable warnings. The whole-repo lint also flags the root
      `_drive_tmp*.mjs` scratch scripts.
- [x] `npm run test:unit` passes, including the 12 new chord tests.
- [x] Drove the built app with Playwright: 23 of 23 checks pass, covering
      items 1–4 and 6–10. Item 5 (laser) was checked by reading the code
      only, since a canvas trail can't be read back.

---

# Round 2 — follow-ups (2026-10-17)

## R2-1. Line highlight only with a caret

- [x] `editorTheme.ts`: `.cm-activeLine` (and its gutter number) is only
      tinted while the editor is focused.
- [x] `livePreview.ts`: the caret's lines show raw Markdown only while
      focused (`view.hasFocus`, rebuilt on `focusChanged`).

## R2-2. Line numbers in Raw

- [x] `MarkdownEditor.tsx` `previewExtensions(false)`: `lineNumbers()`,
      `highlightActiveLineGutter()`, and a `cm-raw` class. In Raw the text
      starts at the left edge beside the numbers, VS Code-style, instead of
      in the centred reading column.

## R2-3. Equal-width switch halves

- [x] `markdown-toolbar.css`: `.markdown-toolbar__modes` is a grid of
      `1fr` columns.

## R2-4. Markdown status bar

- [x] Pure helpers in `src/shared/markdown/structure.ts`: `wordStarts`,
      `wordIndexAt`, `countCharacters` (code points) and `fileByteSize`
      (UTF-8, with the file's own line ending). Tested in
      `tests/unit/markdownStructure.spec.ts`.
- [x] Main sends each note's line ending (`MarkdownFileData.lineEnding`), so
      the byte count is the file's real size.
- [x] `MarkdownStatusBar.tsx`: Ln *n*/total, Col *n*, Word *n*/total,
      characters, links and bytes. Line, column and word are boxes you can
      type a number into and press Enter to jump. Alt+G, Alt+C and Alt+W go to
      them (the window has no menu bar, so Alt+letters are free, and the
      editor binds none of these). The current line and the line count share
      one fraction. In the reader (View + Formatted) there's no caret, so the
      positions show a dash.
- [x] `MarkdownEditor` reports the caret (`onSelection`).

## R2-5. Side panel: Outline, Backlinks, Outbound

- [x] `extractHeadings` and `extractOutboundLinks` work from the text, so the
      outline and links update on every edit, in every mode. Fenced and
      inline code are skipped; links cover wikilinks, Markdown links,
      autolinks and bare URLs, but not images.
- [x] `MarkdownSidePanel.tsx`: three tabs. Each list scrolls in
      `.md-panel__body` while the tabs stay put. A heading jumps to the
      reader's heading or the editor's line. A link follows; Ctrl+click opens
      it in a new tab; `#heading` links stay in the note.

## R2-6. Edit + Formatted looks like View + Formatted

- [x] `livePreviewBlocks.ts`: every top-level block the caret isn't in is a
      block widget drawn by the reader's own pipeline (`renderNote`,
      callouts, KaTeX, tasks, tags, link marks, local images, missing-note
      dimming). With no focus, every block is drawn. A press places the caret
      at the matching source offset; a task checkbox ticks; Ctrl+click
      follows a link.
- [x] Reader spacing: each block keeps its margins inside itself so
      CodeMirror can measure it, and the `blockSpacing` plugin pulls each
      block up by the overlap the reader's margin collapsing would remove.
      Measured: headings and list items sit at exactly the reader's pixel
      positions.
- [x] Font size in live preview is the reader's `1rem`, not the source
      editor's size.

## R2-7. Tabs grow in and shrink out

- [x] `useTabTransitions.ts`: a single new tab gets `--entering`; a closed
      tab is kept as an `--exiting` stand-in in its old slot until its shrink
      ends. Live tabs use even CSS `order` slots and a closing tab the odd
      slot before them. Switching workspace or restoring many tabs at once
      doesn't animate.

## R2-8. Reordered tabs slide

- [x] FLIP in `useTabTransitions.ts`: on a pure reorder (same tabs, new
      order), each moved tab animates from its old `offsetLeft`. This covers
      drag previews, Ctrl+Space nudges and drops.

## R2-9. Pan and Select beside the tools

- [x] Moved from `PdfToolbar` to `PageActions`, just left of the laser
      pointer.
- [x] Pressed only while no tool is on. Picking one turns off the laser
      pointer, pen, highlighter, comments, text box and crop
      (`TabManager.turnOffPointerTools`).

## R2-10. Tab hover fill rises from the bottom

- [x] `.tab-bar__hover-fill` in the tab's effects layer scales up from the
      bottom edge. Tab content is positioned so it paints above the layer
      without a stacking context, which would trap the close button's
      tooltip.

## R2-11. Pan/Select keyboard commands

- [x] Ctrl+1 for Pan (Okular's Browse key) and Ctrl+2 for Select, handled in
      `TabManager` for both the tab view and the chrome, and only on PDF tabs.
      The View menu entries are display-only. Both are in the tooltips.

## R2-12. Looping pan restored

- [x] `PdfViewer.tsx`: the pointer lock and the wrapping stand-in hand are
      back.
- [x] On release, `warpPointer` asks main to put the real pointer where the
      hand was, because Chromium would put it back where the drag began.
      `src/main/platform/CursorWarper.ts` runs a long-lived Windows PowerShell
      helper that calls `SetCursorPos` (per-monitor DPI aware, by full path,
      numbers only). It starts when a PDF is first opened. Main clamps the
      point to the view and converts DIP to physical pixels. Tested in
      `tests/unit/cursorWarper.spec.ts`.
- [x] Measured in the app: after a 1,800px looping drag the OS pointer is
      within 0px of the hand.

## Round 2 wrap-up

- [x] `npm run typecheck` passes.
- [x] `npm run test:unit`: 156 pass.
- [x] Lint on the changed files: no new findings.
- [x] Drove the built app: round-two checks 26 of 26; round-one checks
      re-run, 23 of 23.

## Fix (2026-10-18): Ctrl+Left/Right switched tabs from the editor

- [x] Switching to Edit (toolbar, Ctrl+Shift+G) focused the editor inside the
      note page but left the window's keyboard in the chrome, whose shortcuts
      can't see the caret. `TabManager.giveKeyboardToMarkdownEditor` moves
      the keyboard into the note's page whenever its editor takes the caret.

## Fix (2026-10-18): the pan hand jumped on release

- [x] The looping pan no longer locks the pointer behind a stand-in hand (the
      real pointer had to be moved to the hand on release, and Chromium moving
      it back to where the drag began could win, so it jumped). The real
      pointer pans; at an edge of the view `warpPointer` sends it to just
      inside the opposite edge, as Okular does, and the landing move doesn't
      scroll. Letting go leaves it exactly where it is. Edge maths in
      `PdfViewer/panWrap.ts`, tested in `tests/unit/panWrap.spec.ts`.
- [x] The pointer-lock permission is no longer granted to any page.
- [x] Pan mode uses the app's own hand cursors (open while hovering, closed
      while dragging), white with a black edge, never the OS's grab cursors.

## Fix (2026-10-18): PDF text selection was blue

- [x] pdf.js colours `.textLayer ::selection` with the system accent (Windows'
      blue). `pdf-viewer.css` overrides it with the app's accent, as every
      other page's selection already uses.

## Change (2026-10-18): tabs spring up and sink away

- [x] A new tab springs up out of the toolbar (rising like the hover colour,
      overshooting about 2px before it settles) while its neighbours make
      room. A closed tab sinks into the toolbar until it's gone, then the gap
      closes. No fade. The part below the tab's resting edge is clipped, so it
      never covers the toolbar. `TabBar` finishes on the last animation of each.

## Fix (2026-10-18): dragged tabs flipped back and forth

- [x] A drag read its target from which half of the hovered tab the pointer
      was in, using where that tab was drawn mid-slide. The preview moved tabs
      under a still pointer, so the target kept changing. `tabDropTargetAt`
      reads the laid-out positions instead: the dragged tab passes a neighbour
      when the pointer crosses its middle, and only crossing it again goes
      back. Tested in `tests/unit/tabDropTarget.spec.ts`; a drag in from
      another window is unchanged.

## Change (2026-10-18): no hover grey on the window's drag strip

- [x] The strip along the top edge no longer turns grey on hover (it still
      darkens while dragging the window). `GripHoverWatcher`, which polled the
      cursor only to report that hover while maximized, is removed, with its
      IPC channel and the shared grip height.
