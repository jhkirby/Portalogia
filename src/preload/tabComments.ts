// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { ipcRenderer } from 'electron';
import {
  buildBodyTextIndex,
  isEditableTarget,
  isInteractiveTarget,
  resolveOffset,
  textAfter,
  textBefore,
  toolInk,
} from './tabHighlighter';

// Hardcoded rather than imported from `@shared/ipc-contract` — same reason
// `tabHighlighter.ts` hardcodes its own four channel names: this module is
// folded into `tabZoom.ts`'s single Rollup preload entry (see
// `electron.vite.config.ts`), and a runtime value shared with any other
// entry gets split into a chunk the sandboxed CJS loader can't `require()`.
// `CommentController` (main-process) hardcodes the exact same strings — keep
// the two in sync by hand.
const CommentToolState = 'comment-tool:state';
const CommentToolOp = 'comment-tool:op';
const CommentToolApplyOp = 'comment-tool:apply-op';
const CommentToolRestore = 'comment-tool:restore';
const CommentToolClear = 'comment-tool:clear';

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface CommentQuote {
  readonly prefix: string;
  readonly suffix: string;
}

interface CommentRecord {
  readonly id: string;
  readonly quote: CommentQuote;
  readonly dx: number;
  readonly dy: number;
  readonly text: string;
  readonly color: RgbColor;
}

/** One dropped comment's live DOM presence — an invisible anchor span sitting in the page's own content (so it moves with reflow/scroll, same idea as a highlight's `<mark>`), plus the dot and box drawn relative to it. */
interface CommentPin {
  readonly id: string;
  readonly anchor: HTMLElement;
  readonly dot: HTMLButtonElement;
  readonly box: HTMLDivElement;
  readonly textarea: HTMLTextAreaElement;
  readonly quote: CommentQuote;
  readonly dx: number;
  readonly dy: number;
  /** Never frozen at creation time — always repainted to match the live accent, same as a highlight's own color (see `repaintAllComments`). */
  color: RgbColor;
  text: string;
  /** `false` for a pin just dropped that's never had its first non-empty Enter — never reported to main, and silently discarded (or auto-committed, if it has text) the moment the tool turns off. See `finalizeDraftsOnDeactivate`. */
  committed: boolean;
}

const ROOT_ID = 'northstar-comments-root';
const DOT_CLASS = 'ns-comment-dot';
const BOX_CLASS = 'ns-comment-box';
const INPUT_CLASS = 'ns-comment-input';
const ANCHOR_CLASS = 'ns-comment-anchor';

let active = false;
let currentColor: RgbColor = { r: 26, g: 115, b: 232 };
const comments = new Map<string, CommentPin>();
/** Creation/restore order — what Up/Down arrow jumps step through (see `wireArrowJump`). */
const order: string[] = [];
/** Which comment's box is shown while the tool is *off* — `null` means every comment is just a dot. Irrelevant while `active`, since every box is shown then regardless. */
let openId: string | null = null;
/** Whichever of our own textareas currently has focus, if any — tracks where an Up/Down jump should step from, and gates it (a jump while actually typing would fight the caret). */
let focusedId: string | null = null;

let root: HTMLElement | null = null;
let baseStyleEl: HTMLStyleElement | null = null;
let cursorStyleEl: HTMLStyleElement | null = null;
let repositionScheduled = false;
/**
 * The most recent known cursor position, in viewport coordinates — kept up
 * to date by an always-on `mousemove` listener and seeded directly from a
 * drop's own click coordinates (`dropCommentAt`). Used for a fresh
 * `elementFromPoint` hit-test at the moment D/Delete is pressed
 * (`hoveredDotId`) rather than the CSS `:hover` pseudo-class: Chromium only
 * recomputes `:hover` matching in response to an actual subsequent pointer
 * event, so a dot that just appeared (or moved) directly under an
 * already-stationary cursor — exactly what happens right after dropping or
 * editing a comment with the keyboard, no further mouse movement involved —
 * never picks up `:hover` at all even though the cursor is sitting right on
 * it. `elementFromPoint` performs a genuine synchronous hit-test against the
 * current layout instead, so it's accurate the instant a coordinate is
 * known, with no dependency on any subsequent motion.
 */
let lastMouseX = -1;
let lastMouseY = -1;
document.addEventListener(
  'mousemove',
  (event) => {
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  },
  true,
);

function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** `#rrggbb`, percent-encoded for embedding in a data-URI SVG's `fill`/`stroke` attribute. */
function hexColor(color: RgbColor): string {
  const channel = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `%23${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** A small speech-bubble cursor, encoded as a data URI and colored with the current accent — shown in place of the ordinary pointer while the comment tool is active. Single-quoted `url(...)` wrapper — see `tabHighlighter.ts`'s identical comment for why that matters. */
function commentCursorCss(color: RgbColor): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    `<path d="M3 4.5h16a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H10l-5 4.5V16H3a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" fill="${hexColor(color)}" stroke="${toolInk()}" stroke-width="1.2"/>` +
    '</svg>';
  return `url('data:image/svg+xml,${svg}') 1 22, text`;
}

/**
 * Static CSS for the pin dot/box/textarea, inserted once and left in place
 * regardless of the tool's on/off state — a dot must render even while the
 * tool is off. Only the `cursor`/`user-select` rule (see `updateCursorStyle`)
 * is toggled.
 *
 * `pointer-events: auto` on the dot/box is load-bearing, not decorative:
 * `pointer-events` is an inherited CSS property, so without overriding it
 * here, both would silently inherit `none` from `#northstar-comments-root`
 * (deliberately `none` on the root itself, so its own zero-size box never
 * blocks clicks meant for the page beneath it — see `ensureRoot`). Inherited
 * onto the dot, that made a click on it hit-test straight through to
 * whatever page content sits underneath instead of the dot itself, so
 * `event.target` was never the dot at all — the click-to-open handler on the
 * dot itself never even fired, and while the tool was active it read as an
 * ordinary page click and dropped a fresh comment instead.
 *
 * The hover glow (`:hover`) reads its color from `--ns-comment-glow`, a
 * custom property `createPin` sets per dot from that comment's own color —
 * a plain class rule can't reach into a specific element's own inline color.
 */
function buildBaseStyleText(): string {
  return (
    `.${DOT_CLASS} { position: fixed; width: 16px; height: 16px; margin: 0; padding: 0; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.45); cursor: pointer; z-index: 2147483647; transform: translate(-50%, -50%); pointer-events: auto; transition: box-shadow 120ms ease; } ` +
    `.${DOT_CLASS}:hover { box-shadow: 0 0 0 5px var(--ns-comment-glow, rgba(66,133,244,0.55)), 0 1px 4px rgba(0,0,0,0.45); } ` +
    `.${BOX_CLASS} { position: fixed; z-index: 2147483647; background: #fff; color: #1b1b1b; border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,0.3); padding: 6px; width: 220px; box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, sans-serif; pointer-events: auto; } ` +
    `.${INPUT_CLASS} { display: block; width: 100%; box-sizing: border-box; border: none; outline: none; resize: none; background: transparent; color: inherit; font: inherit; min-height: 42px; } ` +
    `.${ANCHOR_CLASS} { display: inline-block; width: 0; height: 0; overflow: hidden; line-height: 0; }`
  );
}

/** Exported so `tabTextBoxes.ts` can reuse this file's point-anchor helpers, which rely on the `ANCHOR_CLASS` rule this inserts. */
export function ensureBaseStyle(): void {
  if (!baseStyleEl) {
    baseStyleEl = document.createElement('style');
    baseStyleEl.setAttribute('data-northstar', 'comment-tool-base');
    baseStyleEl.textContent = buildBaseStyleText();
  }
  if (!baseStyleEl.isConnected) {
    (document.head ?? document.documentElement).appendChild(baseStyleEl);
  }
}

/** Cursor + a blanket `user-select: none` while active — a comment drop is a plain click, not a drag, and suppressing native text selection keeps an incidental drag from being misread as one (see `tabHighlighter.ts`'s own selection-clearing lesson, applied here up front instead). */
function updateCursorStyle(): void {
  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.setAttribute('data-northstar', 'comment-tool-cursor');
  }
  cursorStyleEl.textContent = `html, html * { cursor: ${commentCursorCss(currentColor)} !important; user-select: none !important; }`;
  if (active) {
    if (!cursorStyleEl.isConnected) {
      (document.head ?? document.documentElement).appendChild(cursorStyleEl);
    }
  } else if (cursorStyleEl.isConnected) {
    cursorStyleEl.remove();
  }
}

function ensureRoot(): HTMLElement {
  ensureBaseStyle();
  if (!root || !root.isConnected) {
    root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.style.position = 'fixed';
      root.style.top = '0';
      root.style.left = '0';
      root.style.width = '0';
      root.style.height = '0';
      // Descendants (the dot/box) still receive clicks despite this —
      // `pointer-events: none` only stops the container itself, not
      // children that don't repeat the declaration.
      root.style.pointerEvents = 'none';
      root.style.zIndex = '2147483647';
    }
    (document.body ?? document.documentElement).appendChild(root);
  }
  return root;
}

function styleAnchor(el: HTMLElement): void {
  el.className = ANCHOR_CLASS;
}

/** Finds the caret position under a viewport point, across the two browsers' incompatible APIs for it. `null` if the point isn't over any text (e.g. an image, empty margin). */
function caretRangeAt(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y);
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) {
      return null;
    }
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function buildQuote(range: Range): CommentQuote {
  return {
    prefix: textBefore(document.body, range.startContainer, range.startOffset),
    suffix: textAfter(document.body, range.startContainer, range.startOffset),
  };
}

/** Builds a fresh anchor span at the caret position under `(x, y)`, or — if there's no text there, or insertion fails — a fixed-position fallback anchored directly at that viewport point (degrades to "floats at a screen position" rather than "tracks page content", same accepted best-effort tradeoff `applyStoredComment`'s own quote search makes). */
export function createLiveAnchor(x: number, y: number): { anchor: HTMLElement; dx: number; dy: number; quote: CommentQuote } {
  const range = caretRangeAt(x, y);
  if (range) {
    try {
      const marker = document.createElement('span');
      styleAnchor(marker);
      const insertion = range.cloneRange();
      insertion.collapse(true);
      insertion.insertNode(marker);
      const rect = marker.getBoundingClientRect();
      return { anchor: marker, dx: x - rect.left, dy: y - rect.top, quote: buildQuote(range) };
    } catch {
      // Falls through to the fixed-position fallback below — some ranges
      // (inside a replaced element, a form control) refuse `insertNode`.
    }
  }
  const marker = document.createElement('span');
  styleAnchor(marker);
  marker.style.position = 'fixed';
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
  (document.body ?? document.documentElement).appendChild(marker);
  return { anchor: marker, dx: 0, dy: 0, quote: { prefix: '', suffix: '' } };
}

/** Re-anchors a stored/synced comment's quote against the current document — see `tabHighlighter.ts`'s `applyStoredHighlight` for the same idea applied to a span instead of a point. Since a comment's quote has no "exact" middle, this looks for wherever `prefix` and `suffix` sit next to each other (or, failing that, wherever either alone can still be found), and treats that junction as the anchor point. A silent best-effort fallback (fixed at the top-left, offset zeroed) if nothing matches — expected on a page that's changed since the comment was made. */
function findQuoteLocation(quote: CommentQuote): { node: Text; offset: number } | null {
  if (!quote.prefix && !quote.suffix) {
    return null;
  }
  const { fullText, map } = buildBodyTextIndex();
  let anchorOffset = -1;
  if (quote.prefix && quote.suffix) {
    const junction = fullText.indexOf(quote.prefix + quote.suffix);
    if (junction !== -1) {
      anchorOffset = junction + quote.prefix.length;
    }
  }
  if (anchorOffset === -1 && quote.prefix) {
    const idx = fullText.indexOf(quote.prefix);
    if (idx !== -1) {
      anchorOffset = idx + quote.prefix.length;
    }
  }
  if (anchorOffset === -1 && quote.suffix) {
    const idx = fullText.indexOf(quote.suffix);
    if (idx !== -1) {
      anchorOffset = idx;
    }
  }
  if (anchorOffset === -1) {
    return null;
  }
  return resolveOffset(map, anchorOffset);
}

export function buildRestoredAnchor(quote: CommentQuote): { anchor: HTMLElement; dx: number; dy: number } {
  const location = findQuoteLocation(quote);
  const marker = document.createElement('span');
  styleAnchor(marker);
  if (location) {
    try {
      const range = document.createRange();
      range.setStart(location.node, location.offset);
      range.collapse(true);
      range.insertNode(marker);
      return { anchor: marker, dx: 0, dy: 0 };
    } catch {
      // Falls through to the fixed fallback below.
    }
  }
  marker.style.position = 'fixed';
  marker.style.left = '12px';
  marker.style.top = '12px';
  (document.body ?? document.documentElement).appendChild(marker);
  return { anchor: marker, dx: 0, dy: 0 };
}

function updatePinVisibility(pin: CommentPin): void {
  pin.textarea.readOnly = !active;
  pin.box.style.display = active || pin.id === openId ? 'block' : 'none';
}

function updateAllVisibility(): void {
  comments.forEach(updatePinVisibility);
}

function scheduleReposition(): void {
  if (repositionScheduled) {
    return;
  }
  repositionScheduled = true;
  requestAnimationFrame(() => {
    repositionScheduled = false;
    repositionAll();
  });
}

function positionPin(pin: CommentPin): void {
  const rect = pin.anchor.getBoundingClientRect();
  const top = rect.top + pin.dy;
  const left = rect.left + pin.dx;
  pin.dot.style.top = `${top}px`;
  pin.dot.style.left = `${left}px`;
  if (pin.box.style.display === 'none') {
    return;
  }
  const boxWidth = pin.box.offsetWidth || 220;
  const boxHeight = pin.box.offsetHeight || 70;
  const clampedLeft = Math.min(left + 14, Math.max(8, window.innerWidth - boxWidth - 8));
  const clampedTop = Math.min(top + 14, Math.max(8, window.innerHeight - boxHeight - 8));
  pin.box.style.left = `${Math.max(8, clampedLeft)}px`;
  pin.box.style.top = `${Math.max(8, clampedTop)}px`;
}

function repositionAll(): void {
  comments.forEach(positionPin);
}

function removePinFromDom(pin: CommentPin): void {
  pin.dot.remove();
  pin.box.remove();
  pin.anchor.remove();
  comments.delete(pin.id);
  const idx = order.indexOf(pin.id);
  if (idx !== -1) {
    order.splice(idx, 1);
  }
  if (openId === pin.id) {
    openId = null;
  }
  if (focusedId === pin.id) {
    focusedId = null;
  }
}

/** Commits the current textarea value: a never-committed pin's first non-empty Enter reports a fresh `add`; an already-committed pin's later Enter reports an `update`; either way, an emptied-out box deletes the pin (reported only if it had ever actually been added). Either way, the textarea is blurred afterward — saving a comment is also meant to end editing it, the same way pressing Enter in most single-purpose text boxes both commits and releases focus. */
function commitOrUpdate(id: string): void {
  const pin = comments.get(id);
  if (!pin) {
    return;
  }
  const text = pin.textarea.value;
  if (!pin.committed) {
    if (!text.trim()) {
      removePinFromDom(pin);
      return;
    }
    pin.committed = true;
    pin.text = text;
    ipcRenderer.send(CommentToolOp, { kind: 'add', id, quote: pin.quote, dx: pin.dx, dy: pin.dy, text, color: pin.color });
    pin.textarea.blur();
    return;
  }
  if (!text.trim()) {
    removePinFromDom(pin);
    ipcRenderer.send(CommentToolOp, { kind: 'remove', id });
    return;
  }
  pin.text = text;
  ipcRenderer.send(CommentToolOp, { kind: 'update', id, text });
  pin.textarea.blur();
}

/** Deletes a comment outright — a never-committed draft is just discarded locally; an already-committed one also reports the removal so it's undone on disk and mirrored to sibling tabs. Shared by the dot's own click handler and the hover+D/Delete keyboard path below, the same two-reachable-paths shape `tabHighlighter.ts` uses for removing a highlight. */
function deletePin(id: string): void {
  const pin = comments.get(id);
  if (!pin) {
    return;
  }
  const wasCommitted = pin.committed;
  removePinFromDom(pin);
  if (wasCommitted) {
    ipcRenderer.send(CommentToolOp, { kind: 'remove', id });
  }
}

function onDotClick(id: string): void {
  if (active) {
    // While the tool is on, the dot itself is the "hover to delete" target
    // (see `hoveredDotId`/the keydown handler below) — clicking it deletes
    // the comment outright, the same action as hovering it and pressing D or
    // Delete, just reachable without a keystroke. Editing happens in the
    // box's own textarea instead, which is always shown open right beside
    // the dot while the tool is on and has its own `stopPropagation`, so
    // this is never in tension with "click in the box to edit".
    deletePin(id);
    return;
  }
  openId = openId === id ? null : id;
  updateAllVisibility();
  scheduleReposition();
  if (openId) {
    comments.get(openId)?.textarea.focus();
  }
}

interface CreatePinParams {
  readonly id: string;
  readonly anchor: HTMLElement;
  readonly quote: CommentQuote;
  readonly dx: number;
  readonly dy: number;
  readonly text: string;
  readonly color: RgbColor;
  readonly committed: boolean;
}

function createPin(params: CreatePinParams): CommentPin {
  ensureRoot();
  const { id, anchor, quote, dx, dy, text, color, committed } = params;

  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = DOT_CLASS;
  dot.setAttribute('data-ncm-id', id);
  dot.style.backgroundColor = rgba(color, 1);
  dot.style.setProperty('--ns-comment-glow', rgba(color, 0.55));
  dot.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  dot.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onDotClick(id);
  });

  const box = document.createElement('div');
  box.className = BOX_CLASS;
  box.setAttribute('data-ncm-id', id);
  box.style.borderLeft = `3px solid ${rgba(color, 1)}`;
  box.addEventListener('mousedown', (event) => event.stopPropagation());
  box.addEventListener('click', (event) => event.stopPropagation());

  const textarea = document.createElement('textarea');
  textarea.className = INPUT_CLASS;
  textarea.rows = 3;
  textarea.placeholder = 'Add a comment…';
  textarea.value = text;
  textarea.readOnly = !active;
  textarea.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitOrUpdate(id);
    }
  });
  textarea.addEventListener('input', () => {
    const pin = comments.get(id);
    if (pin) {
      pin.text = textarea.value;
    }
  });
  textarea.addEventListener('focus', () => {
    focusedId = id;
  });
  textarea.addEventListener('blur', () => {
    if (focusedId === id) {
      focusedId = null;
    }
  });
  box.appendChild(textarea);

  ensureRoot().appendChild(dot);
  ensureRoot().appendChild(box);

  const pin: CommentPin = { id, anchor, dot, box, textarea, quote, dx, dy, color, text, committed };
  comments.set(id, pin);
  order.push(id);
  updatePinVisibility(pin);
  scheduleReposition();
  return pin;
}

function dropCommentAt(x: number, y: number): void {
  // The click that drops a comment is also the most recent known cursor
  // position — see `lastMouseX`/`lastMouseY`'s own comment for why this
  // matters immediately, before any further mouse movement occurs.
  lastMouseX = x;
  lastMouseY = y;
  const { anchor, dx, dy, quote } = createLiveAnchor(x, y);
  const id = crypto.randomUUID();
  const pin = createPin({ id, anchor, quote, dx, dy, text: '', color: currentColor, committed: false });
  pin.textarea.focus();
}

/**
 * Re-applies a stored/synced comment. Always painted with the *live*
 * `currentColor`, not `record.color` — a comment's color is never frozen at
 * the moment it was dropped (or last edited elsewhere); it always tracks
 * whatever the accent currently is, same as `tabHighlighter.ts`'s
 * `applyStoredHighlight`.
 */
function applyStoredComment(record: CommentRecord): void {
  if (comments.has(record.id)) {
    return;
  }
  const { anchor, dx, dy } = buildRestoredAnchor(record.quote);
  createPin({
    id: record.id,
    anchor,
    quote: record.quote,
    dx: record.dx + dx,
    dy: record.dy + dy,
    text: record.text,
    color: currentColor,
    committed: true,
  });
}

/** Re-paints every existing pin's dot/box border to `color` — a comment's color always tracks whatever the current accent is, the same way a highlight's `<mark>` does (see `tabHighlighter.ts`'s `repaintAllHighlights`). */
function repaintAllComments(color: RgbColor): void {
  comments.forEach((pin) => {
    pin.color = color;
    pin.dot.style.backgroundColor = rgba(color, 1);
    pin.dot.style.setProperty('--ns-comment-glow', rgba(color, 0.55));
    pin.box.style.borderLeft = `3px solid ${rgba(color, 1)}`;
  });
}

/** A never-committed pin left over when the tool turns off either gets auto-committed (it has real text — discarding typed-but-unsubmitted work would be the surprising outcome) or removed outright (still empty). */
function finalizeDraftsOnDeactivate(): void {
  for (const pin of Array.from(comments.values())) {
    if (pin.committed) {
      continue;
    }
    if (pin.text.trim()) {
      pin.committed = true;
      ipcRenderer.send(CommentToolOp, {
        kind: 'add',
        id: pin.id,
        quote: pin.quote,
        dx: pin.dx,
        dy: pin.dy,
        text: pin.text,
        color: pin.color,
      });
    } else {
      removePinFromDom(pin);
    }
  }
}

function setActive(nextActive: boolean, color: RgbColor): void {
  const colorChanged = color.r !== currentColor.r || color.g !== currentColor.g || color.b !== currentColor.b;
  const wasActive = active;
  active = nextActive;
  currentColor = color;
  if (colorChanged) {
    repaintAllComments(color);
  }
  updateCursorStyle();
  if (wasActive && !active) {
    finalizeDraftsOnDeactivate();
    openId = null;
  }
  updateAllVisibility();
  scheduleReposition();
}

function isEditingAnything(): boolean {
  return isEditableTarget(document.activeElement);
}

document.addEventListener('scroll', () => scheduleReposition(), { capture: true, passive: true });
window.addEventListener('resize', () => scheduleReposition());

// Up/Down jumps between comments while the tool is on, looping at either
// end — only when focus isn't already inside some editable field (ours or
// the page's own), so it never fights a caret mid-edit or a page's own
// unrelated input. See `isEditableTarget` (shared with `tabHighlighter.ts`).
document.addEventListener(
  'keydown',
  (event) => {
    if (!active || order.length === 0) {
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    if (isEditingAnything()) {
      return;
    }
    event.preventDefault();
    const currentIndex = focusedId ? order.indexOf(focusedId) : -1;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      currentIndex === -1
        ? event.key === 'ArrowDown'
          ? 0
          : order.length - 1
        : (currentIndex + delta + order.length) % order.length;
    const nextId = order[nextIndex];
    const pin = nextId ? comments.get(nextId) : undefined;
    pin?.textarea.focus();
    pin?.box.scrollIntoView({ block: 'nearest' });
  },
  true,
);

/** The dot currently under the mouse, via a fresh hit-test at the last known cursor position — see `lastMouseX`/`lastMouseY`'s own comment for why this, not `:hover`, is what's actually reliable here. */
function hoveredDotId(): string | null {
  if (lastMouseX < 0 || lastMouseY < 0) {
    return null;
  }
  const el = document.elementFromPoint(lastMouseX, lastMouseY);
  return el instanceof Element ? (el.closest(`.${DOT_CLASS}`)?.getAttribute('data-ncm-id') ?? null) : null;
}

// Hovering a comment's dot + D or Delete removes it — the same action as
// clicking the dot directly (see `onDotClick`), just reachable without
// leaving the keyboard.
document.addEventListener(
  'keydown',
  (event) => {
    if (!active) {
      return;
    }
    if (event.key !== 'd' && event.key !== 'D' && event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }
    const id = hoveredDotId();
    if (!id) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    deletePin(id);
  },
  true,
);

// Mirrors `tabHighlighter.ts`'s own interactive-element suppression while
// its tool is on: while the comment tool is active, a click is for dropping
// or opening a comment, never for navigating a link or activating a button.
document.addEventListener(
  'mousedown',
  (event) => {
    if (!active) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`.${DOT_CLASS}, .${BOX_CLASS}`)) {
      return;
    }
    if (isInteractiveTarget(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

function suppressClick(event: MouseEvent): void {
  if (!active) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(`.${DOT_CLASS}, .${BOX_CLASS}`)) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}
document.addEventListener('dblclick', suppressClick, true);
document.addEventListener('auxclick', suppressClick, true);

document.addEventListener(
  'click',
  (event) => {
    if (!active) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`.${DOT_CLASS}, .${BOX_CLASS}`)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    dropCommentAt(event.clientX, event.clientY);
  },
  true,
);

// Closes whichever comment is open for read-only viewing while the tool is
// *off* — a click anywhere outside its own dot/box, same "click outside
// closes it" behavior a plain popover would have. Only relevant while
// `!active`; while the tool is on, every box is shown regardless, so there's
// nothing here to close.
document.addEventListener(
  'mousedown',
  (event) => {
    if (active || !openId) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`.${DOT_CLASS}[data-ncm-id="${CSS.escape(openId)}"], .${BOX_CLASS}[data-ncm-id="${CSS.escape(openId)}"]`)) {
      return;
    }
    openId = null;
    updateAllVisibility();
  },
  true,
);

// Same read-only-view close, via Escape — gated on `!active` so it never
// competes with the tool-level Escape handling in `TabManager.wireSharedInputHandling`
// (which only ever acts when a tool is actually on).
document.addEventListener(
  'keydown',
  (event) => {
    if (active || !openId || event.key !== 'Escape') {
      return;
    }
    event.stopPropagation();
    openId = null;
    updateAllVisibility();
  },
  true,
);

ipcRenderer.on(CommentToolState, (_event, payload: { active: boolean; color: RgbColor }) => {
  setActive(payload.active, payload.color);
});

ipcRenderer.on(CommentToolRestore, (_event, payload: { comments: CommentRecord[] }) => {
  for (const comment of payload.comments) {
    applyStoredComment(comment);
  }
});

// The "revert page" action's comment half (`CommentController.clearTab`) —
// main already handles the persisted/sibling-tab side of the wipe; this only
// needs to tear down every pin's own DOM presence.
ipcRenderer.on(CommentToolClear, () => {
  for (const pin of Array.from(comments.values())) {
    removePinFromDom(pin);
  }
  openId = null;
});

ipcRenderer.on(
  CommentToolApplyOp,
  (
    _event,
    payload:
      | { action: 'add'; comment: CommentRecord }
      | { action: 'update'; id: string; text: string }
      | { action: 'remove'; id: string },
  ) => {
    if (payload.action === 'add') {
      applyStoredComment(payload.comment);
      return;
    }
    if (payload.action === 'update') {
      const pin = comments.get(payload.id);
      if (pin) {
        pin.text = payload.text;
        pin.textarea.value = payload.text;
      }
      return;
    }
    const pin = comments.get(payload.id);
    if (pin) {
      removePinFromDom(pin);
    }
  },
);

// See `tabHighlighter.ts`: rebuild the cursor rule if the theme flips mid-use.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateCursorStyle());
