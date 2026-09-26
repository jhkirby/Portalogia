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

let active = false;
let currentColor: RgbColor = { r: 26, g: 115, b: 232 };
let hoveredHighlightId: string | null = null;
let cursorStyleEl: HTMLStyleElement | null = null;

function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** A small pen-nib cursor, encoded as a data URI — shown in place of the ordinary pointer while the highlighter tool is active. */
function highlighterCursorCss(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M9.7 15.3 15.3 9.7l4 4-5.6 5.6a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 0 1 0-1.4Z" fill="%23222"/>' +
    '<path d="m15.3 9.7 4.6-4.6a1.7 1.7 0 0 1 2.4 2.4l-4.6 4.6-2.4-2.4Z" fill="none" stroke="%23222" stroke-width="1.6"/>' +
    '<path d="m9.5 15.5-5 5 2 2 5-5" fill="none" stroke="%23222" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  // Single-quoted `url(...)` wrapper — the embedded SVG's own XML attributes
  // are double-quoted, and matching that outer delimiter would let the
  // SVG's very first `"` terminate the CSS string early, silently dropping
  // the whole `cursor` declaration as invalid.
  return `url('data:image/svg+xml,${svg}') 2 22, text`;
}

function setActive(nextActive: boolean, color: RgbColor): void {
  active = nextActive;
  currentColor = color;
  if (active) {
    if (!cursorStyleEl) {
      cursorStyleEl = document.createElement('style');
      cursorStyleEl.setAttribute('data-northstar', 'highlighter-cursor');
      cursorStyleEl.textContent = `html, html * { cursor: ${highlighterCursorCss()} !important; }`;
    }
    if (!cursorStyleEl.isConnected) {
      (document.head ?? document.documentElement).appendChild(cursorStyleEl);
    }
  } else if (cursorStyleEl?.isConnected) {
    cursorStyleEl.remove();
  }
}

/** The nearest block-level ancestor of a node, or `null` for a node not attached to a rendered element at all. Used to reject a selection that crosses block boundaries — see this file's own module doc comment for why v1 scopes to single-block selections. */
function closestBlock(node: Node): Element | null {
  let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el) {
    const display = window.getComputedStyle(el).display;
    if (display !== 'inline' && display !== 'inline-block' && display !== 'inline-flex') {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/** Text immediately before a point, up to `QUOTE_CONTEXT_CHARS`, scoped to `within` so this never has to stringify content far outside the highlighted block. */
function textBefore(within: Node, node: Node, offset: number): string {
  try {
    const range = document.createRange();
    range.setStart(within, 0);
    range.setEnd(node, offset);
    return range.toString().slice(-QUOTE_CONTEXT_CHARS);
  } catch {
    return '';
  }
}

/** Text immediately after a point, up to `QUOTE_CONTEXT_CHARS` — see `textBefore`. */
function textAfter(within: Node, node: Node, offset: number): string {
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
  // A `TreeWalker` never visits its own root via `nextNode()`, only that
  // root's descendants — and `commonAncestorContainer` is itself a `Text`
  // node (with no children at all) whenever a selection lands entirely
  // inside one, the single most common case of all. Walking from its parent
  // element instead always includes it as a descendant; `intersectsNode`
  // below still correctly excludes any sibling text the range doesn't
  // actually cover.
  const commonAncestor = range.commonAncestorContainer;
  const root = commonAncestor.nodeType === Node.TEXT_NODE ? (commonAncestor.parentNode ?? commonAncestor) : commonAncestor;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
    mark.style.backgroundColor = rgba(color, 0.55);
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

/** User-initiated removal (hover + D/Delete) — unlike `removeFromDom` alone, this also reports the op to main so it lands in the undo/redo stack and the on-disk store. */
function removeAndReport(id: string): void {
  removeFromDom(id);
  ipcRenderer.send(HighlighterOp, { kind: 'remove', id });
}

/** Highlights the current selection, if any and if it's a plain single-block one — see `closestBlock`. Reports the new highlight to main on success. */
function highlightSelection(): void {
  if (!active) {
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return;
  }
  const startBlock = closestBlock(range.startContainer);
  const endBlock = closestBlock(range.endContainer);
  if (!startBlock || startBlock !== endBlock) {
    // Crosses more than one block — out of scope for v1 (see this file's
    // module doc comment). Left unselected/unhighlighted rather than
    // guessing at a partial wrap.
    return;
  }

  const exact = range.toString();
  if (!exact.trim()) {
    return;
  }
  const id = crypto.randomUUID();
  const prefix = textBefore(startBlock, range.startContainer, range.startOffset);
  const suffix = textAfter(startBlock, range.endContainer, range.endOffset);

  if (!wrapRange(range, id, currentColor)) {
    return;
  }
  selection.removeAllRanges();
  ipcRenderer.send(HighlighterOp, { kind: 'add', id, quote: { exact, prefix, suffix }, color: currentColor });
}

/** Concatenates every text node under `document.body` into one string, alongside a lookup back from a character offset to its owning node/local offset — built fresh per restore call, which only ever runs a handful of times per page load. */
function buildBodyTextIndex(): { fullText: string; map: Array<{ node: Text; start: number }> } {
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

/** Maps an absolute character offset into `document.body`'s concatenated text back to a `(node, localOffset)` pair. */
function resolveOffset(
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

/** Best-effort re-anchor: finds `quote.exact` in the current document (preferring an occurrence whose surrounding text matches `quote.prefix`/`quote.suffix`) and wraps it exactly like a fresh selection would be. A silent no-op if it can't be found — expected on a page that's changed since the highlight was made. */
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
    wrapRange(range, highlight.id, highlight.color);
  } catch {
    // The computed offsets can land outside a node's current length if the
    // document changed between building the index and here (unlikely for a
    // synchronous call, kept as a safety net) — nothing to clean up.
  }
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

document.addEventListener('mouseup', () => highlightSelection());

document.addEventListener('mousemove', (event) => {
  if (!active) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const mark = target?.closest(`.${MARK_CLASS}`);
  hoveredHighlightId = mark?.getAttribute(MARK_ID_ATTR) ?? null;
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
