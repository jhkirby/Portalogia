// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { ipcRenderer } from 'electron';

// Hardcoded rather than imported from `@shared/ipc-contract` — same reason
// `tabZoom.ts`/`terminal.ts` hardcode `zoom:apply`: this module is folded
// into `tabZoom.ts`'s own single Rollup preload entry (see
// `electron.vite.config.ts`), and a runtime value shared with any other
// entry gets split into a chunk the sandboxed CJS loader can't `require()`.
// `HighlighterController` (main-process) hardcodes the exact same strings —
// keep the two in sync by hand.
const HighlighterState = 'highlighter:state';
const HighlighterOp = 'highlighter:op';
const HighlighterApplyOp = 'highlighter:apply-op';
const HighlighterRestore = 'highlighter:restore';
const HighlighterClear = 'highlighter:clear';

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface HighlightQuote {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

interface HighlightRecord {
  readonly id: string;
  readonly quote: HighlightQuote;
  readonly color: RgbColor;
}

/** How many characters of surrounding context a quote captures on each side — enough to disambiguate most repeated phrases without the prefix/suffix search itself becoming expensive. */
const QUOTE_CONTEXT_CHARS = 32;

const MARK_CLASS = 'northstar-highlight';
const MARK_ID_ATTR = 'data-nsh-id';
/** Applied to every mark sharing the currently-hovered highlight's id, lightening it — the visual cue that hovering it (and pressing D/Delete) would remove it. */
const MARK_HOVER_CLASS = 'northstar-highlight--hovered';

/** A finished highlight's own background alpha. */
const MARK_ALPHA = 0.55;
/** How much a highlight lightens on hover (`MARK_HOVER_CLASS`) — reused for the drag-selection preview below, since both are "a lighter version of what this highlight would look like." */
const HOVER_OPACITY = 0.5;

/** Name registered with `CSS.highlights` for the live drag preview — see `updateSelectionPreview`. */
const PREVIEW_HIGHLIGHT_NAME = 'northstar-highlighter-preview';

let active = false;
let currentColor: RgbColor = { r: 26, g: 115, b: 232 };
let hoveredHighlightId: string | null = null;
let cursorStyleEl: HTMLStyleElement | null = null;
let previewHighlight: Highlight | null = null;

function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/**
 * The color tool cursors are drawn in (percent-encoded for a data-URI SVG):
 * light in dark mode, dark in light mode, so they stay visible against the
 * app theme. `tabPen.ts`/`tabComments.ts` import this too.
 */
export function toolInk(): string {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? '%23f2f2f2' : '%23222';
}

/** A small pen-nib cursor, encoded as a data URI — shown in place of the ordinary pointer while the highlighter tool is active. */
function highlighterCursorCss(): string {
  const ink = toolInk();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M9.7 15.3 15.3 9.7l4 4-5.6 5.6a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 0 1 0-1.4Z" fill="' + ink + '"/>' +
    '<path d="m15.3 9.7 4.6-4.6a1.7 1.7 0 0 1 2.4 2.4l-4.6 4.6-2.4-2.4Z" fill="none" stroke="' + ink + '" stroke-width="1.6"/>' +
    '<path d="m9.5 15.5-5 5 2 2 5-5" fill="none" stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  // Single-quoted `url(...)` wrapper — the embedded SVG's own XML attributes
  // are double-quoted, and matching that outer delimiter would let the
  // SVG's very first `"` terminate the CSS string early, silently dropping
  // the whole `cursor` declaration as invalid.
  return `url('data:image/svg+xml,${svg}') 2 22, text`;
}

/** Re-paints every existing `<mark>` to `color` — a highlight's color is never frozen at creation time; it always tracks whatever the current accent is, the same way its cursor and hover states do. */
function repaintAllHighlights(color: RgbColor): void {
  document.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
    (mark as HTMLElement).style.backgroundColor = rgba(color, MARK_ALPHA);
  });
}

/**
 * The cursor/hover/preview rules, rebuilt fresh against whichever color is
 * current — called every time `setActive` runs (toggle, tab activation, or
 * a live accent-color change), not just once, so the drag preview and hover
 * lightening never go stale after a color change the way a finished
 * highlight almost did (see `repaintAllHighlights`).
 */
function buildStyleRuleText(color: RgbColor): string {
  const previewColor = rgba(color, MARK_ALPHA * HOVER_OPACITY);
  return (
    `html, html * { cursor: ${highlighterCursorCss()} !important; } ` +
    `.${MARK_HOVER_CLASS} { opacity: ${HOVER_OPACITY}; } ` +
    // Native selection stays fully invisible the whole time this tool is on
    // (and overrides `pageSelectionAccent.ts`'s own `::selection` rule,
    // which has no `!important` of its own) — the drag preview is painted
    // separately via `::highlight()` below instead, specifically so a
    // *real* native selection is never the thing a person sees as
    // "highlighted." Leaving a real selection visibly active (or even just
    // active at all past the drag that made it) is what let a later
    // mousedown on that same text get misread by Chromium as "drag this
    // selection to move it" rather than starting a fresh one — seen
    // firsthand once a rejected multi-block selection was left selected
    // instead of cleared. `updateSelectionPreview`/`highlightSelection` now
    // both clear the real selection unconditionally instead.
    '::selection { background-color: transparent !important; background: transparent !important; } ' +
    `::highlight(${PREVIEW_HIGHLIGHT_NAME}) { background-color: ${previewColor}; }`
  );
}

function setActive(nextActive: boolean, color: RgbColor): void {
  const colorChanged = color.r !== currentColor.r || color.g !== currentColor.g || color.b !== currentColor.b;
  active = nextActive;
  currentColor = color;
  if (colorChanged) {
    repaintAllHighlights(color);
  }
  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.setAttribute('data-northstar', 'highlighter-cursor');
  }
  cursorStyleEl.textContent = buildStyleRuleText(color);
  if (active) {
    if (!cursorStyleEl.isConnected) {
      (document.head ?? document.documentElement).appendChild(cursorStyleEl);
    }
  } else if (cursorStyleEl.isConnected) {
    cursorStyleEl.remove();
  }
  if (!active) {
    setHoveredHighlight(null);
    clearSelectionPreview();
  }
}

/** The registered `Highlight` object backing `::highlight(northstar-highlighter-preview)`, created on first use. */
function ensurePreviewHighlight(): Highlight {
  if (!previewHighlight) {
    previewHighlight = new Highlight();
    CSS.highlights.set(PREVIEW_HIGHLIGHT_NAME, previewHighlight);
  }
  return previewHighlight;
}

/** Clears the drag preview, if anything is currently shown. */
function clearSelectionPreview(): void {
  previewHighlight?.clear();
}

/**
 * Re-paints the live drag preview from the browser's own current selection
 * — called on every `selectionchange`, which fires continuously while a
 * mouse drag is extending it. Uses the CSS Custom Highlight API
 * (`::highlight()`) rather than `::selection` itself: a `Highlight` is a
 * purely visual overlay, entirely decoupled from `window.getSelection()`,
 * so painting it never risks the native selection being mistaken for
 * something the browser should let a person drag around (see
 * `buildStyleRuleText`'s own comment). Shows nothing at all for a selection
 * that `highlightSelection` would reject anyway (crosses more than one
 * block, or overlaps an existing highlight) — honest feedback about what
 * will actually happen on release, not just "something is selected."
 */
function updateSelectionPreview(): void {
  const highlight = ensurePreviewHighlight();
  if (!active) {
    highlight.clear();
    return;
  }
  const selection = window.getSelection();
  highlight.clear();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (!range.collapsed && isHighlightable(range)) {
    highlight.add(range);
  }
}

/** Marks every `<mark>` sharing `id` as hovered (or clears it, for `null`), lightening it via `MARK_HOVER_CLASS` — a no-op if `id` is already the currently-hovered one. A highlight can be several marks (see `wrapRange`), so this always operates on all of them together. */
function setHoveredHighlight(id: string | null): void {
  if (id === hoveredHighlightId) {
    return;
  }
  if (hoveredHighlightId) {
    document
      .querySelectorAll(`mark.${MARK_CLASS}[${MARK_ID_ATTR}="${CSS.escape(hoveredHighlightId)}"]`)
      .forEach((el) => el.classList.remove(MARK_HOVER_CLASS));
  }
  hoveredHighlightId = id;
  if (hoveredHighlightId) {
    document
      .querySelectorAll(`mark.${MARK_CLASS}[${MARK_ID_ATTR}="${CSS.escape(hoveredHighlightId)}"]`)
      .forEach((el) => el.classList.add(MARK_HOVER_CLASS));
  }
}

/**
 * The narrowest node guaranteed to contain the entirety of `range` — root
 * for both `wrapRange`'s own text-node walk (via
 * `collectIntersectingTextRanges`) and the prefix/suffix quote context, so
 * neither has to consider content outside the selection itself. A
 * `TreeWalker` never visits its own root via `nextNode()`, only that root's
 * descendants — and `commonAncestorContainer` is itself a leaf `Text` node
 * (with no children at all) whenever a selection lands entirely inside one,
 * the single most common case of all. Walking from its parent instead
 * always includes it as a descendant; `intersectsNode` still correctly
 * excludes any sibling content the range doesn't actually cover, no matter
 * how far out this root ends up being — a selection spanning several
 * paragraphs or list items is walked exactly the same way as one inside a
 * single word, just from a higher root.
 */
function rangeContainer(range: Range): Node {
  const commonAncestor = range.commonAncestorContainer;
  return commonAncestor.nodeType === Node.TEXT_NODE ? (commonAncestor.parentNode ?? commonAncestor) : commonAncestor;
}

/**
 * Text immediately before a point, up to `QUOTE_CONTEXT_CHARS`, scoped to
 * `within` so this never has to stringify content far outside the
 * highlighted block. Exported for `src/preload/tabComments.ts` to reuse for
 * its own point-anchor quotes — both modules only ever get bundled into this
 * same `tabZoom.cjs` preload entry (see that file's own comment), so sharing
 * this across them costs nothing extra.
 */
export function textBefore(within: Node, node: Node, offset: number): string {
  try {
    const range = document.createRange();
    range.setStart(within, 0);
    range.setEnd(node, offset);
    return range.toString().slice(-QUOTE_CONTEXT_CHARS);
  } catch {
    return '';
  }
}

/** Text immediately after a point, up to `QUOTE_CONTEXT_CHARS` — see `textBefore`. Exported for the same reason. */
export function textAfter(within: Node, node: Node, offset: number): string {
  try {
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(within, within.childNodes.length);
    return range.toString().slice(0, QUOTE_CONTEXT_CHARS);
  } catch {
    return '';
  }
}

/**
 * Every text node a range intersects, in document order, each paired with
 * the slice of it (start/end offsets) actually inside the range. Used by
 * both `wrapRange` (what to wrap) and `rangeOverlapsExistingHighlight` (what
 * to check the ancestry of) — the two need to agree exactly on what a
 * selection "covers", so this is the one place that decides it.
 */
function collectIntersectingTextRanges(range: Range): Array<{ node: Text; start: number; end: number }> {
  const walker = document.createTreeWalker(rangeContainer(range), NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });

  const targets: Array<{ node: Text; start: number; end: number }> = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (end > start) {
      targets.push({ node, start, end });
    }
    current = walker.nextNode();
  }
  return targets;
}

/**
 * Wraps every text node a range intersects in its own `<mark>`, splitting
 * boundary text nodes as needed, all sharing one `data-nsh-id` — a highlight
 * that crosses several inline elements (bold, links, spans) inside the same
 * block ends up as several marks, removed/restored together by that shared
 * id. Collected before mutating anything, since splitting a text node while
 * a `TreeWalker` is still iterating the live tree it belongs to would risk
 * skipping or duplicating nodes.
 * @returns Whether at least one mark was created.
 */
function wrapRange(range: Range, id: string, color: RgbColor): boolean {
  const targets = collectIntersectingTextRanges(range);
  let wrapped = false;
  for (const { node, start, end } of targets) {
    // Node identity is stable across iterations even though each split
    // below mutates the tree — every entry in `targets` refers to a
    // distinct original text node, so splitting one never invalidates the
    // offsets recorded for another.
    let middle = node;
    if (end < middle.data.length) {
      middle.splitText(end);
    }
    if (start > 0) {
      middle = middle.splitText(start);
    }
    if (middle.data.length === 0 || !middle.parentNode) {
      continue;
    }
    const mark = document.createElement('mark');
    mark.className = MARK_CLASS;
    mark.setAttribute(MARK_ID_ATTR, id);
    // Per-property CSSOM assignment, not `setAttribute('style', ...)` or a
    // stylesheet rule — a strict `style-src` CSP blocks parsed style
    // content but not individual property assignment, so this is what
    // keeps a highlight visible (and therefore printable) on hardened sites.
    mark.style.backgroundColor = rgba(color, MARK_ALPHA);
    mark.style.color = 'inherit';
    middle.parentNode.insertBefore(mark, middle);
    mark.appendChild(middle);
    wrapped = true;
  }
  return wrapped;
}

/** Removes every mark sharing `id` from the DOM, restoring the plain text it wrapped. Does not report anything back to main — see `removeAndReport` for the user-initiated path that does. */
function removeFromDom(id: string): void {
  const marks = document.querySelectorAll(`mark.${MARK_CLASS}[${MARK_ID_ATTR}="${CSS.escape(id)}"]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
  if (hoveredHighlightId === id) {
    hoveredHighlightId = null;
  }
}

/** Removes every highlight on the page outright — the "revert page" action's highlight half (`HighlighterClear`, pushed by `HighlighterController.clearTab`). Main already handles the undo/redo/store side of the wipe; this only needs to clear the live DOM and any in-flight hover/preview state. */
function removeAllFromDom(): void {
  document.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  });
  document.body?.normalize();
  hoveredHighlightId = null;
  clearSelectionPreview();
}

/** User-initiated removal (hover + D/Delete) — unlike `removeFromDom` alone, this also reports the op to main so it lands in the undo/redo stack and the on-disk store. */
function removeAndReport(id: string): void {
  removeFromDom(id);
  ipcRenderer.send(HighlighterOp, { kind: 'remove', id });
}

/**
 * Whether any part of `range` falls inside an existing highlight — checked
 * before creating a new one so highlights can never nest or overlap; a
 * sub-selection of an already-highlighted region (or one that only partly
 * overlaps it) is rejected outright rather than layering a second `<mark>`
 * over the first. Answered via ancestry on the exact text nodes `wrapRange`
 * would itself wrap (`collectIntersectingTextRanges`) — the same set both
 * functions agree on — rather than `range.intersectsNode(mark)` against
 * every mark on the page, which checks the mark's own tree *position*
 * rather than whether the selection's actual text sits inside one.
 */
function rangeOverlapsExistingHighlight(range: Range): boolean {
  return collectIntersectingTextRanges(range).some(({ node }) => node.parentElement?.closest(`.${MARK_CLASS}`) != null);
}

/**
 * Whether `range` can become a highlight — the only disqualifier is
 * overlapping an existing one (see `rangeOverlapsExistingHighlight`); a
 * selection is free to span several paragraphs, list items, or any other
 * mix of block-level content; each intersected text node still gets its own
 * `<mark>` sharing one id (see `wrapRange`), it's just more of them. Shared
 * by `updateSelectionPreview` (should this even show a preview?) and
 * `highlightSelection` (should this actually become one?) so the two always
 * agree on exactly the same selections.
 */
function isHighlightable(range: Range): boolean {
  return !rangeOverlapsExistingHighlight(range);
}

/**
 * Highlights the current selection, if any and if it doesn't overlap an
 * existing highlight — see `isHighlightable`. Reports the new highlight to
 * main on success. The native selection itself is *always* cleared before
 * returning, accepted or not — see `buildStyleRuleText`'s own comment for
 * why leaving a rejected one visibly selected turned out to be a real
 * problem, not just a cosmetic one.
 */
function highlightSelection(): void {
  clearSelectionPreview();
  if (!active) {
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    selection.removeAllRanges();
    return;
  }
  if (!isHighlightable(range)) {
    selection.removeAllRanges();
    return;
  }
  const container = rangeContainer(range);

  const exact = range.toString();
  if (!exact.trim()) {
    selection.removeAllRanges();
    return;
  }
  const id = crypto.randomUUID();
  const prefix = textBefore(container, range.startContainer, range.startOffset);
  const suffix = textAfter(container, range.endContainer, range.endOffset);

  if (!wrapRange(range, id, currentColor)) {
    selection.removeAllRanges();
    return;
  }
  selection.removeAllRanges();
  ipcRenderer.send(HighlighterOp, { kind: 'add', id, quote: { exact, prefix, suffix }, color: currentColor });
}

/** Concatenates every text node under `document.body` into one string, alongside a lookup back from a character offset to its owning node/local offset — built fresh per restore call, which only ever runs a handful of times per page load. Exported for `tabComments.ts`'s own quote-based restore — see `textBefore`'s own comment for why sharing this is safe. */
export function buildBodyTextIndex(): { fullText: string; map: Array<{ node: Text; start: number }> } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement;
      if (!parent || parent.closest(`.${MARK_CLASS}`) || parent.closest('script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const map: Array<{ node: Text; start: number }> = [];
  let fullText = '';
  let node = walker.nextNode() as Text | null;
  while (node) {
    map.push({ node, start: fullText.length });
    fullText += node.data;
    node = walker.nextNode() as Text | null;
  }
  return { fullText, map };
}

/** Maps an absolute character offset into `document.body`'s concatenated text back to a `(node, localOffset)` pair. Exported for `tabComments.ts`. */
export function resolveOffset(
  map: Array<{ node: Text; start: number }>,
  offset: number,
): { node: Text; offset: number } | null {
  for (let i = map.length - 1; i >= 0; i--) {
    const entry = map[i]!;
    if (offset >= entry.start) {
      return { node: entry.node, offset: offset - entry.start };
    }
  }
  return null;
}

/**
 * Best-effort re-anchor: finds `quote.exact` in the current document
 * (preferring an occurrence whose surrounding text matches
 * `quote.prefix`/`quote.suffix`) and wraps it exactly like a fresh selection
 * would be. Always painted with the *live* `currentColor`, not
 * `highlight.color` — a highlight's color is never frozen at the moment it
 * was created (or last undone/redone); it always tracks whatever the accent
 * currently is, same as `repaintAllHighlights`. A silent no-op if the text
 * can't be found — expected on a page that's changed since the highlight
 * was made.
 */
function applyStoredHighlight(highlight: HighlightRecord): void {
  if (!document.body || !highlight.quote.exact) {
    return;
  }
  const { fullText, map } = buildBodyTextIndex();
  const withContext = highlight.quote.prefix + highlight.quote.exact + highlight.quote.suffix;
  const matchStart = withContext ? fullText.indexOf(withContext) : -1;
  const exactStart = matchStart !== -1 ? matchStart + highlight.quote.prefix.length : fullText.indexOf(highlight.quote.exact);
  if (exactStart === -1) {
    return;
  }
  const exactEnd = exactStart + highlight.quote.exact.length;
  const start = resolveOffset(map, exactStart);
  const end = resolveOffset(map, exactEnd);
  if (!start || !end) {
    return;
  }
  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    wrapRange(range, highlight.id, currentColor);
  } catch {
    // The computed offsets can land outside a node's current length if the
    // document changed between building the index and here (unlikely for a
    // synchronous call, kept as a safety net) — nothing to clean up.
  }
}

/** Exported for `tabComments.ts`'s own arrow-key-jump gating — see that file for why it needs the same "is this an ordinary editable field" check. */
export function isEditableTarget(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

document.addEventListener('mouseup', () => highlightSelection());

// Fires continuously while a mouse drag is extending the native selection
// (and on any other way it changes) — this is what drives the live drag
// preview, independent of `mouseup`.
document.addEventListener('selectionchange', () => updateSelectionPreview());

/** Elements a click/mousedown should never be allowed to activate while the highlighter tool is on — the whole point of the tool ("the pointer can only highlight text") is defeated if clicking a link or button still navigates or fires the page's own handler. Exported for `tabComments.ts`'s identical need while the comment tool is on. */
export const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="tab"], [onclick]';

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

// Only suppressed on an actually-interactive element — `mousedown`'s
// default action on ordinary text is exactly what starts a selection drag,
// so preventing it unconditionally would break highlighting itself, the one
// thing this tool is supposed to still do.
document.addEventListener(
  'mousedown',
  (event) => {
    if (!active || !isInteractiveTarget(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

// Unlike `mousedown`, a click's default action (link navigation, button
// activation, checkbox/radio toggling, a page's own click handler) never has
// anything to do with starting a text selection, so this blocks it
// unconditionally, regardless of target. Capture phase + `stopImmediatePropagation`
// wins against the page's own listeners no matter where or when they were
// attached — `document`'s capture phase always runs before any descendant's,
// and before any other listener registered on `document` itself after this
// one (attached here at preload time, before the page has run any of its
// own script). Known gap: a native, OS-drawn widget (a `<select>` dropdown,
// a `<input type="color">` picker) can still open on `mousedown` itself,
// beneath the DOM event layer entirely — not fixable from here.
function suppressClick(event: MouseEvent): void {
  if (!active) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}
document.addEventListener('dblclick', suppressClick, true);
document.addEventListener('auxclick', suppressClick, true);

// A plain (primary-button) click gets the same suppression as any other,
// plus one extra behavior: clicking directly on an existing highlight
// removes it — the same action as hovering it and pressing D/Delete, just
// reachable without leaving the mouse. A `click` on a highlight only ever
// happens here as a plain press-release-in-place (no drag), since a real
// drag-selection never fires a collapsed `mouseup` in `highlightSelection`
// in the first place — so there's no ambiguity with creating a highlight.
document.addEventListener(
  'click',
  (event) => {
    suppressClick(event);
    if (!active) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const id = target?.closest(`.${MARK_CLASS}`)?.getAttribute(MARK_ID_ATTR);
    if (id) {
      removeAndReport(id);
    }
  },
  true,
);

document.addEventListener('mousemove', (event) => {
  if (!active) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const mark = target?.closest(`.${MARK_CLASS}`);
  setHoveredHighlight(mark?.getAttribute(MARK_ID_ATTR) ?? null);
});

document.addEventListener(
  'keydown',
  (event) => {
    if (!active || !hoveredHighlightId || isEditableTarget(document.activeElement)) {
      return;
    }
    if (event.key === 'd' || event.key === 'D' || event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      removeAndReport(hoveredHighlightId);
    }
  },
  true,
);

ipcRenderer.on(HighlighterState, (_event, payload: { active: boolean; color: RgbColor }) => {
  setActive(payload.active, payload.color);
});

ipcRenderer.on(HighlighterRestore, (_event, payload: { highlights: HighlightRecord[] }) => {
  for (const highlight of payload.highlights) {
    applyStoredHighlight(highlight);
  }
});

ipcRenderer.on(HighlighterClear, () => removeAllFromDom());

ipcRenderer.on(
  HighlighterApplyOp,
  (_event, payload: { action: 'add'; highlight: HighlightRecord } | { action: 'remove'; id: string }) => {
    if (payload.action === 'add') {
      applyStoredHighlight(payload.highlight);
    } else {
      removeFromDom(payload.id);
    }
  },
);

// The theme can flip while the tool is on; rebuild the cursor rule so it
// doesn't keep the old ink.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setActive(active, currentColor));
