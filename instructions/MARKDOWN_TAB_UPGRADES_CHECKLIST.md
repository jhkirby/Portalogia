# Markdown tab upgrades — build checklist

Started 2026-11-21. Tracks `instructions/MARKDOWN_TAB_UPGRADES.md` plus the
decisions made while clarifying it (listed under "Decisions" below, which are
part of the spec). Edit + Formatted becomes a Google Docs–style editor that
still reads and writes plain Markdown; Raw stays the CodeMirror source editor,
and View + Formatted stays the existing reader. Work through the sections in
order — later ones depend on earlier ones. Each section lists the files it
touches, then a check to confirm it works.

**Decisions (from clarification):**

- Formatted editing is rebuilt on ProseMirror (TipTap is acceptable), not the
  CodeMirror live preview. Markdown is parsed into a document and serialized
  back, preserving the note's own style wherever it wasn't edited.
- In Formatted mode, typing never creates an element — inline marks included.
  `**`, `` ` ``, `[[`, `$`, `==`, `- `, `# `, `> ` and `---` are literal
  characters (escaped in the file). Elements come only from the toolbar,
  shortcuts and the right-click menu.
- New tools: callout (dropdown type picker), bullet list, numbered list,
  checklist, divider, heading, raw HTML and image.
- Lists keep document-editor keys: Enter continues, Tab / Shift+Tab nest and
  un-nest, Enter on an empty item leaves the list.
- Images link to the picked file where it is, written **relative to the
  note**. They render, drag to resize, and when clicked offer "change link"
  and an ✕.
- Links and `[[wikilinks]]` share one edit popup (URL or note target with
  note-name autocomplete, heading, alias).
- Math opens a LaTeX box with live preview when clicked.
- Raw HTML is an editable block that renders (sanitized) once the caret
  leaves it, with an ✕.
- Shortcuts follow Google Docs: Ctrl+Alt+1–6 for headings (Ctrl+Alt+0 for
  normal text), Ctrl+Shift+7 / 8 / 9 for numbered / bullet / checklist. Newly
  picked: Ctrl+Alt+C callout, Ctrl+Alt+D divider, Ctrl+Alt+H raw HTML,
  Ctrl+Alt+I image (checked against the app's existing chords in section 4).

**Assumptions to confirm before starting** (each is restated where it
applies):

- A. **Images outside the vault.** `readImageDataUrl`
  (`src/main/browser/MarkdownVault.ts`) only reads pictures inside the note's
  search roots (`isWithinRoots`). A picked file elsewhere would never render.
  Plan: main keeps a persisted allowlist of image paths the user picked
  through the dialog, and `readImageDataUrl` also accepts those paths. A note
  from elsewhere still can't reach outside its vault on its own.
- B. **Different drive.** A relative path is impossible across Windows
  drives, so a picked image on another drive is written as an absolute path.
- C. **`#tags`** stay plain text that is *styled* as a tag (a decoration, not
  an element), because they have no toolbar tool and turning them off would
  lose a feature.
- D. **Image width** for a non-embed image is written the Obsidian way,
  `![alt|300](path)`. `![[x.png|300]]` embeds keep their own form.

---

## 1. Dependencies and the editor's document model

The Formatted editor's node and mark set, defined once and shared by the
parser, the serializer and the editor.

- [x] Add the ProseMirror stack to `package.json` at exact, current, ≥2-week-old
      versions: `prosemirror-model`, `-state`, `-view`, `-transform`,
      `-commands`, `-keymap`, `-history`, `-tables`, `-dropcursor`,
      `-gapcursor` (or the TipTap equivalents if TipTap is chosen; record the
      choice in `docs/architecture.md`). Do **not** add
      `prosemirror-inputrules` or TipTap's input/paste rules (Decision 2).
      Run `npm run notices` to refresh the third-party notices.
      *Done:* ProseMirror directly (no TipTap), 11 packages pinned to exact versions released before 2026-11-07.
- [x] Create `src/renderer/lib/markdown/formatted/schema.ts`. **Nodes:**
      `doc`, `paragraph`, `heading` (level 1–6), `blockquote`, `callout`
      (type, title, fold `''|'+'|'-'`), `bullet_list`, `ordered_list`
      (start), `list_item`, `task_item` (checked), `code_block` (language),
      `math_block` (tex), `html_block` (html), `horizontal_rule`, `table` /
      `table_row` / `table_header` / `table_cell` (via
      `prosemirror-tables`' `tableNodes`, with column alignment), `image`
      (src, alt, width, `embed: boolean`), `hard_break`, `text`. **Inline
      atoms:** `math_inline` (tex, display), `wikilink` (target, heading,
      alias, embed). **Marks:** `strong`, `em`, `strike`, `code`,
      `highlight`, `link` (href, title).
- [x] Every node and mark that has more than one Markdown spelling carries a
      `style` attribute recording the spelling it was read with (`*` vs `_`
      emphasis, `-` / `*` / `+` bullets, `.` vs `)` ordered markers, ``` vs ~~~
      fences and their length, `---` / `***` / `___` rules, ATX vs setext
      headings, table column widths as written). New nodes get the
      defaults of the existing `editorFormat.ts` helpers (`**`, `*`, `-`,
      ```` ``` ````, `---`).
- [x] Check: `tests/unit/markdownFormattedSchema.spec.ts` builds a document
      with every node and mark and validates it against the schema.

## 2. Markdown ⇄ document round trip

Pure, unit-tested conversion that reuses the existing parser so the reader,
main and the editor agree on what a note means.

- [x] Create `src/renderer/lib/markdown/formatted/fromMarkdown.ts`: walks the
      tokens from `createMarkdownEngine().lex()` (`src/shared/markdown/parser.ts`),
      including the `wikilink`, `math`, `mathInline` and `highlight`
      extensions, into the schema. Callouts are recognized the same way
      `enhance.ts` recognizes them (`> [!type]±? title`), using the same
      `CALLOUT_KINDS` table, which moves to `src/shared/markdown/callouts.ts` so
      both import it. Raw HTML tokens (`html` block) become `html_block`.
- [x] Each top-level block records its source `[from, to)` range and raw text.
- [x] Create `src/renderer/lib/markdown/formatted/toMarkdown.ts`: serializes
      a document back to Markdown. A top-level block whose content is
      unchanged since it was read is written **byte for byte from its
      recorded raw text**, so opening and saving an untouched note changes
      nothing. Edited blocks are written from the node, using its `style`
      attribute.
- [x] Literal text is escaped so it can't be read back as markup: `\*`, `\_`,
      `` \` ``, `\[\[`, `\$`, `\=\=`, `\~~`, a leading `#`, `>`, `-`/`+`/`*`
      plus space, `1.` and `---`, a leading `|` in a table cell and `|` inside
      cells. Put the escaping in a pure helper, `escapeMarkdownText(text, at)`,
      with its own tests.
- [x] Extend `parser.ts` to read `![alt|300](path)` as an image with
      `width=300` (Assumption D), and make the reader's renderer honor the
      width the same way `embedWidth` does for `![[…|300]]`.
- [x] Check: `tests/unit/markdownRoundTrip.spec.ts`
      - (a) the "Lighthouse" sample note, and every fixture in
        `tests/unit/markdown.spec.ts`, round-trips byte for byte when nothing
        is edited;
      - (b) editing one paragraph changes only that paragraph's bytes;
      - (c) typed text containing every escapable sequence above round-trips
        as the same literal text and renders literally in the reader;
      - (d) callouts of every `CALLOUT_KINDS` type, with `+`/`-` folds and
        custom titles, survive;
      - (e) `listCodeBlocks` returns the same blocks before and after.

## 3. The Formatted editor component

Replaces the CodeMirror live preview in Edit + Formatted. Raw keeps CodeMirror.

- [x] Create `src/renderer/components/MarkdownViewer/FormattedEditor.tsx`
      (props mirror `MarkdownEditor`: `source`, `onChange`, `readOnly`,
      `onViewReady`), using sections 1–2. Changes go through the same
      `queueSave` path in `MarkdownViewer.tsx`.
- [x] In `MarkdownViewer.tsx`, render `FormattedEditor` when
      `mode === 'edit' && display === 'formatted'`, and `MarkdownEditor`
      (raw only) otherwise. Replace `editorViewRef` with a small
      `NoteEditorHandle` interface (`runFormat`, `scrollDOM`, `focus`,
      `selectionOffset`, `find…`) that both editors implement, so `runFormat`,
      `useMarkdownFind` and the scroll/jump code don't branch on which editor
      is mounted.
- [x] Switching Raw ↔ Formatted keeps the caret at the closest matching
      source offset, using the recorded block ranges from section 2.
- [x] Remove the formatted branch from `MarkdownEditor.tsx`
      (`previewCompartment`, `livePreview`, `markupDecorations`,
      `syncRenderedBlocksFocus`) and delete `livePreview.ts`,
      `livePreviewBlocks.ts` and `livePreviewTable.ts` once nothing imports
      them. Move anything the new editor reuses (the task-checkbox and
      bullet-by-depth styling) into `formatted/`.
- [x] No active-line highlight and no raw markers anywhere in Formatted mode.
      Bullets draw as the reader's discs/circles/squares, numbers as numbers,
      tasks as checkboxes, rules as rules, and code blocks show no fences.
- [x] Keymap (`formatted/keymap.ts`): base editing, history (Ctrl+Z / Y /
      Shift+Z), Escape blurs (as in the 2026-10-17 checklist, item 1). In
      lists, Enter splits the item, Enter on an empty item lifts it out,
      Tab / Shift+Tab sink and lift. Backspace at the start of an item or
      heading turns it back into a paragraph. No input rules (Decision 2).
- [x] Paste: pasting plain text inserts it literally. Pasting HTML (from a
      web page) goes through DOMPurify and the schema's `parseDOM` rules, so
      bold, links and lists survive and anything else becomes text.
      *Changed:* pasted HTML is parsed only into the editor's own schema (a detached document, so nothing in it runs), not through DOMPurify — anything the schema has no node for becomes text.
- [x] Task checkboxes toggle on click and serialize back to `[x]` / `[ ]`.
- [x] Find (`useMarkdownFind`, `editorFind.ts`): implement search and
      highlight over the ProseMirror document (a decoration plugin) behind
      the same interface the CodeMirror version uses.
      *Changed:* the formatted editor draws as `.md-reader`, so find uses the reader's DOM search and CSS highlights rather than a decoration plugin.
- [x] Check: open the sample note in Edit + Formatted. The caret line isn't
      highlighted and no `**`, `-`, ```` ``` ````, `>` or `$` is visible. Type
      `**hi**`, `- x`, `# y` and `[[z]]` and each stays literal text. In Raw
      it reads `\*\*hi\*\*`, `\- x`, `\# y` and `\[\[z]]`, and the reader
      shows them literally.

## 4. Format actions: shortcuts, menu and toolbar plumbing

Wires the new tools through main the way bold/italic already go
(`TabManager.formatMarkdown` / `applyMarkdownFormat` → `IpcChannel.MarkdownFormat`
→ `runFormat`).

- [x] Extend `MarkdownFormatAction` in `src/shared/ipc-contract.ts` with
      `'callout' | 'bulletList' | 'orderedList' | 'taskList' | 'divider' |
      'heading' | 'html' | 'image'`, plus a payload for the variants that need
      one. Either make the action an object (`{ kind: 'heading', level: 0–6 }`,
      `{ kind: 'callout', type }`) or add separate actions — pick one and
      update `useTabs.ts`, `preload/index.ts`, `preload/markdown.ts` and the
      IPC validators to match.
- [x] Before binding anything, re-run a shortcut inventory (`buildMenu.ts`
      accelerators, `TabManager` input handlers around lines 7000–8340, and
      `textEditingChords.ts`). As of 2026-11-21, Ctrl+Alt+{1–6,0,C,D,H,I} and
      Ctrl+Shift+{7,8,9} are free. Ctrl+Alt is AltGr on some layouts
      (`TabManager.ts` ~6957), so match on `input.code` (`Digit1`, `KeyC`)
      rather than `input.key`.
- [x] In `TabManager`'s tab input handler, route those chords to
      `formatMarkdown(id, …)` (which already no-ops unless the note is being
      edited and has the caret), and fall through when it returns `false`.
- [x] Add the new chords to `isTextEditingChord` so they reach the note
      editor while it has focus, with cases in `tests/unit/textEditingChords.spec.ts`.
      *Not needed:* `handleMarkdownFormatShortcut` runs right after the window shortcuts, before the text-editing early return, so the chords never reach that check.
- [x] `buildMenu.ts`: add a Format submenu (or extend the existing note
      items) listing each tool with its accelerator as `registerAccelerator:
      false`, matching how Back/Forward are shown.
- [x] Add icons for the eight tools in the existing icons folder (same
      stroke and size as `BoldIcon` and `TableIcon`).
- [x] `App.tsx` `noteSections.formatting`: add the eight `format(…)` entries
      with tooltips that use `formatShortcut` / a Ctrl+Alt formatter. Order:
      Heading, Bold, Italic, Link, Bullets, Numbered, Checklist, Callout,
      Divider, Code block, LaTeX block, Table, Image, Raw HTML.
- [x] `ToolsBar.tsx`: support an action with a dropdown (heading level and
      callout type). If `ToolsBarAction` has no such variant, add a `menu?:
      readonly { id; name; icon?; onClick }[]` field rendered as a popover.
      The callout menu lists every `CALLOUT_KINDS` type with its color.
      *Changed:* the picker opens in the note page at the caret (Heading sizes, callout types) instead of a chrome dropdown, which would sit under the tab's view.
- [x] Right-click menu (`MarkdownEditorMenus.tsx`): add the same tools.
- [x] Check: `tests/unit/toolShortcuts.spec.ts` covers each new chord, and
      `tests/e2e/tool-shortcuts.spec.ts` presses each one in an edited note
      and finds the element in the saved file.

## 5. Shared floating popup

One component for every "caret is in X" popup and ✕ button, so all the
element controls look and behave alike.

- [x] Create `src/renderer/components/MarkdownViewer/formatted/NodePopup.tsx`:
      anchored to a node's DOM rect, flips above or below to stay on screen
      (reuse the placement logic from `tooltipPlacement`), closes on Escape or
      when the caret leaves the node, and is keyboard reachable.
- [x] Create `src/renderer/styles/components/formatted-editor.css` (modular
      per the `css-modular` skill), using the color and size tokens in
      `styles/tokens/`. Accent surfaces use `--color-accent-rgb`.
- [x] A generic "remove element" ✕ helper deletes a node and leaves the
      caret where it was.

## 6. Element components

Each element is a ProseMirror node view with its controls. Inserting comes
from the section 4 actions.

- [x] **Headings** — `heading` action: plain toolbar click / Ctrl+Alt+1–6 sets
      the level and Ctrl+Alt+0 makes normal text. While the caret is in a
      heading, `NodePopup` shows H1…H6 / Normal buttons with the current
      level selected.
- [x] **Lists and checklists** — toggle wrap/unwrap on the selection's
      blocks. Switching type (bullet ↔ numbered ↔ checklist) converts in
      place.
- [x] **Callouts** — insert with the chosen type (default `note`), wrapping
      the selection. Draw them with the reader's callout styles (family
      colors). Caret-in popup: type select, title field, fold
      (none / open / closed) and ✕ (✕ unwraps and keeps the content).
- [x] **Divider** — inserts `horizontal_rule` after the current block and
      puts the caret in a fresh paragraph below. Selecting it shows ✕.
- [ ] **Code blocks** — node view with an editable monospace body, syntax
      colors from the reader's highlighter, a language field in its header,
      the existing Run control (`CodeBlockControls.tsx`) for
      `isRunnableName` languages, and ✕. The `code` action wraps the
      selection as before.
      *Partly:* language field, Copy and ✕ are there; syntax colours and the Run button stay in View mode only.
- [ ] **Math** — `math_inline` and `math_block` render with KaTeX
      (`typesetMath` settings: `throwOnError: false`, `trust: false`). Click,
      or Enter while selected, opens a `NodePopup` with a TeX textarea, a live
      KaTeX preview and ✕. The existing LaTeX autocomplete
      (`latexCompletionSource` / `latexCommands.ts`) is reused there if
      feasible. Empty TeX on close removes the node. The `latex` action
      inserts a block, or converts the selected text to TeX.
      *Partly:* the TeX box and live preview work; LaTeX autocomplete inside the box is not done yet.
- [ ] **Links and wikilinks** — a small edit (pencil) icon appears beside a
      link while the caret is in it. Clicking it opens one popup with: text,
      target (a URL, or a note with autocomplete from `listNotes`), heading
      (with autocomplete from that note's outline) and, for wikilinks,
      alias. A toggle switches the target between web link and note link.
      Unlink and ✕ (remove link and text) sit there too. Validate URLs with
      the existing `isWebAddress` and reject `javascript:` / `data:`.
      Ctrl+click still follows the link. The `link` action opens the same
      popup for the selection.
      *Partly:* everything except autocomplete for the heading field.
- [x] **Tables** — `prosemirror-tables` with `columnResizing` off (Markdown
      can't store widths). While the caret is in the table, `NodePopup`
      shows add row above/below, add column left/right, delete row, delete
      column, column alignment and ✕ (delete table). Drag selects a cell
      range (`CellSelection`), and Shift+click and Shift+arrows extend it.
      Selected cells use `rgba(var(--color-accent-rgb), 0.25)`, not the
      browser's blue. Tab and Shift+Tab move between cells, and Tab in the
      last cell adds a row. The `table` action keeps its rows × columns size
      picker.
- [x] **Images** — the `image` action asks main for a picture (section 7)
      and inserts it at the caret. The node view loads it through
      `window.portalogiaMarkdown.readImage` (remote images keep the reader's
      click-to-load placeholder). Drag handles on the corners resize while
      keeping the aspect ratio, writing `width`. Clicking the image selects it
      and shows `NodePopup` with "Change image…" (reopens the picker), alt
      text and ✕.
- [x] **Raw HTML** — `html_block` node view: while the caret is inside, a
      monospace editable box. When the caret leaves, it renders the HTML
      through the **same** DOMPurify configuration and hooks as
      `renderNote.ts` (export a `sanitizeNoteHtml` helper from there rather
      than duplicating the config). Click to edit again, and ✕ to remove.
- [x] **Highlight / strike / inline code** — the existing bold and italic
      commands become mark toggles. Add ==highlight== and inline code to the
      right-click menu (no new toolbar buttons were asked for).
      *Done:* Highlight and Inline code are in the right-click menu and the Format menu (no shortcut).
- [x] **Embeds** — `![[Note]]` (non-image) draws as the reader's embed link
      chip, editable through the link popup.
- [x] Check: the section 10 checks for every element.

## 7. Images in main

Picking, path writing and reading permission (Assumptions A and B).

- [x] New IPC `MarkdownPickImage` in `ipc-contract.ts`,
      `registerMarkdownIpc.ts` and `preload/markdown.ts`: main shows
      `dialog.showOpenDialog` (follow the pattern at `TabManager.ts` ~1158)
      filtered to `IMAGE_EXTENSION_PATTERN`'s types. It returns the path
      relative to the tab's note, using `/` separators and encoding spaces as
      `%20`, or an absolute path when the image is on another drive.
- [x] Persist picked image paths in a small store (e.g.
      `src/main/browser/PickedImageStore.ts`, JSON under `userData`). Make
      `readImageDataUrl` also accept a resolved path that is in that store,
      still subject to the type and size caps.
- [x] Update `docs/security.md` with why the allowlist exists and why it
      doesn't let a note read arbitrary files.
- [x] Check: `tests/unit/markdownMain.spec.ts` covers relative path math
      (same folder, sibling folder, parent, spaces, other drive),
      allowlisted reads succeeding, and non-allowlisted paths outside the
      vault still returning `null`.

## 8. Reader parity

What the editor writes must look the same in View + Formatted.

- [x] The reader honors `![alt|300](path)` widths (from section 2).
- [x] Share the callout, task, bullet-depth and code-block styles between
      `.md-reader` and the Formatted editor in `markdown-viewer.css` /
      `formatted-editor.css` instead of duplicating them.
- [x] Check: put the sample note in View and in Edit + Formatted side by side
      (split screen). Headings, lists, callouts, tables, math, code and images
      line up visually.

## 9. Docs

- [x] `docs/user_guide.md` (Markdown section, ~line 270): replace the "You
      type / You get" table with a "Tool / Shortcut / What it adds" table
      covering every tool. Explain that Formatted editing never turns typed
      symbols into formatting and that Raw is where to type Markdown.
      Describe the popups (heading size, link edit, table controls, image,
      math, callout) and the ✕ buttons.
- [x] `docs/features.md` and `docs/architecture.md`: the Formatted editor's
      design (ProseMirror, round trip with untouched-block passthrough,
      shared parser).
- [x] Update `Last Modified` headers on every touched file.

## 10. Verification

- [x] Opening any existing note in Edit + Formatted and closing it without
      edits leaves the file byte-identical (check the mtime and hash).
- [x] Typing every Markdown trigger (`**`, `*`, `` ` ``, `[[`, `$`, `==`,
      `~~`, `- `, `1. `, `# `, `> `, `---`, `- [x] `, `|a|b|`) in Formatted
      creates no element. Each shows literally in Formatted, Raw (escaped)
      and View.
- [x] Each toolbar button and each shortcut inserts its element. Toolbar
      clicks work with the caret in the editor and also after focus moved to
      the chrome (`applyMarkdownFormat`).
- [x] Heading popup appears with the caret in a heading and changes its
      level. Ctrl+Alt+0 returns it to text.
- [x] Lists: Enter continues, empty Enter exits, Tab / Shift+Tab nest and
      un-nest, and bullets render as discs/circles/squares by depth.
- [x] Callout dropdown inserts each type, and the popup changes type, title
      and fold. ✕ unwraps it.
- [x] Code block shows no fences, edits in place, runs (if runnable) and ✕
      removes it.
- [x] Clicking a formula opens the TeX box with a live preview, and invalid
      TeX shows red without breaking the note.
- [x] Link edit icon appears only with the caret in a link, and the popup edits
      URL, note target, heading and alias. `javascript:` is refused.
- [x] Table popup adds and deletes rows and columns and ✕ deletes the table.
      Drag-selecting cells highlights them in the accent color (change the
      accent color and confirm it follows).
- [x] Image: the picker inserts a relative path that renders, even when the
      file is outside the vault. Resizing saves `|width` and the reader shows
      the same size. "Change image…" swaps it and ✕ removes it. A note from
      elsewhere pointing at `../../secret.png` outside its vault still won't
      load.
- [x] Raw HTML renders after leaving it, and `<script>` and `onerror=` are
      stripped (same result as the reader).
- [ ] Raw ↔ Formatted switching keeps the caret near the same spot and loses
      no edits. Undo and redo work across element inserts.
      *Not yet checked by a test* (caret mapping is unit-tested in `markdownRoundTrip.spec.ts`).
- [ ] Find (Ctrl+F) works in Edit + Formatted.
      *Not yet checked by a test.*
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit` and
      `npm run test:e2e` (`markdown-editor.spec.ts` extended for the above)
      all pass.
