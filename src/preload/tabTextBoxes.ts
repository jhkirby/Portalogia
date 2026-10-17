// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { ipcRenderer } from 'electron';
import { buildRestoredAnchor, createLiveAnchor, ensureBaseStyle as ensureAnchorStyle } from './tabComments';
import { isInteractiveTarget, registerUiShadowRoot, toolInk } from './tabHighlighter';

// Hardcoded rather than imported from `@shared/ipc-contract` — same reason
// `tabComments.ts` hardcodes its own channel names: this module is folded
// into `tabZoom.ts`'s single Rollup preload entry, and a runtime value shared
// with any other entry gets split into a chunk the sandboxed CJS loader can't
// `require()`. `TextBoxController` (main) hardcodes the same strings — keep
// in sync by hand. The same goes for the font size range below, which
// mirrors `TEXT_BOX_FONT_SIZE_MIN`/`MAX`/`DEFAULT` in `constants.ts`.
const TextToolState = 'text-tool:state';
const TextToolOp = 'text-tool:op';
const TextToolApplyOp = 'text-tool:apply-op';
const TextToolRestore = 'text-tool:restore';
const TextToolClear = 'text-tool:clear';

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 48;
const FONT_SIZE_DEFAULT = 16;

type TextAlign = 'left' | 'center' | 'right';
const ALIGNMENTS: readonly TextAlign[] = ['left', 'center', 'right'];

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface TextBoxQuote {
  readonly prefix: string;
  readonly suffix: string;
}

interface TextBoxRecord {
  readonly id: string;
  readonly quote: TextBoxQuote;
  readonly dx: number;
  readonly dy: number;
  readonly text: string;
  readonly size: number;
  readonly align: TextAlign;
}

/** What main tells a sibling tab changed; the anchor only comes along when the box was moved. */
interface TextBoxPatch {
  readonly text?: string;
  readonly size?: number;
  readonly align?: TextAlign;
  readonly quote?: TextBoxQuote;
  readonly dx?: number;
  readonly dy?: number;
}

/** One text box's live DOM presence — an invisible anchor span in the page's own content (so it scrolls and reflows with it, like a comment's), plus the fixed-position box drawn relative to it. */
interface TextBox {
  readonly id: string;
  readonly wrapper: HTMLDivElement;
  readonly textarea: HTMLTextAreaElement;
  readonly sizeInput: HTMLInputElement;
  readonly alignButtons: ReadonlyMap<TextAlign, HTMLButtonElement>;
  /** Replaced whenever the box is dragged to a new spot (see `commitMove`). */
  anchor: HTMLElement;
  quote: TextBoxQuote;
  dx: number;
  dy: number;
  size: number;
  align: TextAlign;
  /** `false` until the box has been reported to main with its first non-empty edit. */
  committed: boolean;
  /** What main last heard for this box, so an edit that changed nothing sends nothing. */
  reportedText: string;
  reportedSize: number;
  reportedAlign: TextAlign;
}

/** A drag of a box's frame in progress. */
interface DragState {
  readonly box: TextBox;
  readonly startX: number;
  readonly startY: number;
  readonly baseDx: number;
  readonly baseDy: number;
  moved: boolean;
}

const ROOT_ID = 'northstar-textboxes-root';
const BOX_CLASS = 'ns-tb';
const INPUT_CLASS = 'ns-tb-input';
const BAR_CLASS = 'ns-tb-bar';
const SIZE_CLASS = 'ns-tb-size';
const BUTTON_CLASS = 'ns-tb-btn';
const FLIP_CLASS = 'ns-tb--flip';

/** Rough width of the options panel, used to decide when it must open to the left of a box near the viewport's right edge. */
const BAR_WIDTH_PX = 190;

/** Width of the grabbable frame around the text. Dragging it moves the box; a press inside it edits. */
const FRAME_PX = 8;

/** A press that travels less than this is a click on the frame, not a drag. */
const DRAG_THRESHOLD_PX = 3;

let active = false;
let currentColor: RgbColor = { r: 26, g: 115, b: 232 };
const boxes = new Map<string, TextBox>();
let drag: DragState | null = null;

/** The host element the boxes hang off, in the page's DOM; the boxes themselves are inside `shadow`. */
let root: HTMLElement | null = null;
/** A *closed* shadow root holding every box — the user's own text, kept out of the page scripts' reach (see `tabComments.ts`'s `shadow`). */
let shadow: ShadowRoot | null = null;
let cursorStyleEl: HTMLStyleElement | null = null;
let repositionScheduled = false;

function rgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function clampSize(size: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

/** `#rrggbb`, percent-encoded for a data-URI SVG's `fill`. */
function hexColor(color: RgbColor): string {
  const channel = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `%23${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** A small "T in a box" cursor, accent-filled — shown in place of the ordinary pointer while the tool is on. Single-quoted `url(...)` — see `tabHighlighter.ts`'s identical comment for why. */
function textCursorCss(color: RgbColor): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    `<rect x="2.5" y="4.5" width="19" height="15" rx="2" fill="${hexColor(color)}" stroke="${toolInk()}" stroke-width="1.2"/>` +
    `<path d="M8 9.5h8M12 9.5v6.5" fill="none" stroke="${toolInk()}" stroke-width="1.6" stroke-linecap="round"/>` +
    '</svg>';
  return `url('data:image/svg+xml,${svg}') 12 12, text`;
}

/**
 * Static CSS for the boxes, inserted once and left in place regardless of
 * the tool's on/off state — a box must render while the tool is off. A box
 * only takes pointer events while the tool is on (`.ns-tb--live`), so with
 * the tool off the page beneath stays fully usable.
 *
 * `font` is pinned to Helvetica so what's on screen matches what a PDF
 * export would draw. The textarea has no padding, so its top-left is the
 * text's own origin; the wrapper's padding is the grabbable frame, pulled
 * back out with a negative margin so the text still lands where it was
 * dropped. The visible dashed frame is an `outline` for the same reason.
 *
 * The options panel is the opposite of the page's theme — dark on a light
 * theme, light on a dark one — so it stands out from the page behind it.
 */
function buildBaseStyleText(): string {
  return (
    `.${BOX_CLASS} { position: fixed; z-index: 2147483647; box-sizing: content-box; margin: -${FRAME_PX}px 0 0 -${FRAME_PX}px; padding: ${FRAME_PX}px; pointer-events: none; color: var(--ns-tb-color); font-family: Helvetica, Arial, sans-serif; } ` +
    `.${BOX_CLASS}--live { pointer-events: auto; cursor: move !important; } ` +
    `.${INPUT_CLASS} { display: block; box-sizing: content-box; margin: 0; padding: 0; border: 0; outline: 1px dashed transparent; outline-offset: 4px; resize: none; overflow: hidden; background: transparent; color: inherit; font: inherit; line-height: 1.2; white-space: pre; field-sizing: content; min-width: 2px; min-height: 1.2em; caret-color: var(--ns-tb-color); } ` +
    `.${BOX_CLASS}--live:hover .${INPUT_CLASS} { outline-color: color-mix(in srgb, var(--ns-tb-color) 45%, transparent); } ` +
    `.${BOX_CLASS}:focus-within .${INPUT_CLASS} { outline-color: var(--ns-tb-color); } ` +
    `.${BAR_CLASS} { position: absolute; top: ${FRAME_PX - 4}px; left: 100%; margin-left: 4px; display: none; align-items: center; gap: 2px; padding: 3px 4px; border-radius: 6px; background: #2b2d31; color: #f2f2f2; box-shadow: 0 2px 10px rgba(0,0,0,0.35); font: 12px/1 system-ui, -apple-system, sans-serif; white-space: nowrap; cursor: default !important; } ` +
    `.${BOX_CLASS}--live:focus-within .${BAR_CLASS} { display: flex; } ` +
    `.${FLIP_CLASS} .${BAR_CLASS} { left: auto; right: 100%; margin-left: 0; margin-right: 4px; } ` +
    `.${SIZE_CLASS} { box-sizing: border-box; width: 44px; margin: 0 4px 0 0; padding: 2px 3px; border: 1px solid #4a4d52; border-radius: 4px; background: #1e1f22; color: #f2f2f2; font: inherit; text-align: center; } ` +
    `.${BUTTON_CLASS} { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin: 0; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #c9ccd1; font: inherit; font-size: 15px; cursor: pointer; } ` +
    `.${BUTTON_CLASS}:hover { background: #3d4045; color: #fff; } ` +
    `.${BUTTON_CLASS}[aria-pressed="true"] { background: color-mix(in srgb, var(--ns-tb-color) 45%, transparent); color: #fff; } ` +
    `.${BUTTON_CLASS}[data-ns-delete]:hover { color: #ff7b72; } ` +
    `@media (prefers-color-scheme: dark) { ` +
    `.${BAR_CLASS} { background: #fff; color: #1b1b1b; box-shadow: 0 2px 10px rgba(0,0,0,0.3); } ` +
    `.${SIZE_CLASS} { border-color: #c4c4c4; background: #fff; color: #1b1b1b; } ` +
    `.${BUTTON_CLASS} { color: #555; } ` +
    `.${BUTTON_CLASS}:hover { background: #eee; color: #111; } ` +
    `.${BUTTON_CLASS}[aria-pressed="true"] { background: color-mix(in srgb, var(--ns-tb-color) 30%, transparent); color: #111; } ` +
    `.${BUTTON_CLASS}[data-ns-delete]:hover { color: #c5221f; } ` +
    `} ` +
    `.${BOX_CLASS}, .${BOX_CLASS} * { user-select: text !important; } ` +
    `.${BOX_CLASS} .${INPUT_CLASS} { cursor: text !important; } ` +
    `.${BOX_CLASS} .${SIZE_CLASS}, .${BOX_CLASS} .${BUTTON_CLASS} { cursor: auto !important; }`
  );
}

/** Cursor + blanket `user-select: none` while the tool is on, so a drop is a plain click and not misread as a text-selection drag. */
function updateCursorStyle(): void {
  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.setAttribute('data-northstar', 'text-tool-cursor');
  }
  cursorStyleEl.textContent = `html, html * { cursor: ${textCursorCss(currentColor)} !important; user-select: none !important; }`;
  if (active) {
    if (!cursorStyleEl.isConnected) {
      (document.head ?? document.documentElement).appendChild(cursorStyleEl);
    }
  } else if (cursorStyleEl.isConnected) {
    cursorStyleEl.remove();
  }
}

/**
 * The shadow root to put the boxes in, creating its host on first use (with
 * the box styles inside it) and re-attaching it if the page removed it.
 * Never an element found by id, which the page could have planted.
 */
function ensureRoot(): ShadowRoot {
  // The anchor spans reuse the comment tool's class, whose rule lives in its style element.
  ensureAnchorStyle();
  if (!root || !shadow) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.style.position = 'fixed';
    root.style.top = '0';
    root.style.left = '0';
    root.style.width = '0';
    root.style.height = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '2147483647';
    shadow = root.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = buildBaseStyleText();
    shadow.appendChild(style);
    registerUiShadowRoot(root, shadow);
  }
  if (!root.isConnected) {
    (document.body ?? document.documentElement).appendChild(root);
  }
  return shadow;
}

// ── POSITIONING ──────────────────────────────────────────────────────

function positionBox(box: TextBox): void {
  const rect = box.anchor.getBoundingClientRect();
  const left = rect.left + box.dx;
  box.wrapper.style.left = `${left}px`;
  box.wrapper.style.top = `${rect.top + box.dy}px`;
  const boxWidth = box.wrapper.offsetWidth;
  box.wrapper.classList.toggle(FLIP_CLASS, left + boxWidth + BAR_WIDTH_PX > window.innerWidth);
}

function repositionAll(): void {
  boxes.forEach(positionBox);
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

// ── REPORTING TO MAIN ────────────────────────────────────────────────

function removeBoxFromDom(box: TextBox): void {
  // Out of the map first: removing a focused wrapper can fire `focusout`, which must not treat it as live.
  boxes.delete(box.id);
  box.wrapper.remove();
  box.anchor.remove();
}

/** Deletes a box outright; a box main never heard about is just discarded locally. */
function deleteBox(box: TextBox): void {
  removeBoxFromDom(box);
  if (box.committed) {
    ipcRenderer.send(TextToolOp, { kind: 'remove', id: box.id });
  }
}

function hasUnreportedChange(box: TextBox): boolean {
  return (
    box.textarea.value !== box.reportedText || box.size !== box.reportedSize || box.align !== box.reportedAlign
  );
}

/** Tells main a committed box changed. `moved` adds its new anchor, which only a drag changes. */
function reportUpdate(box: TextBox, moved: boolean): void {
  const text = box.textarea.value;
  box.reportedText = text;
  box.reportedSize = box.size;
  box.reportedAlign = box.align;
  ipcRenderer.send(TextToolOp, {
    kind: 'update',
    id: box.id,
    text,
    size: box.size,
    align: box.align,
    ...(moved ? { quote: box.quote, dx: box.dx, dy: box.dy } : {}),
  });
}

/** Ends an editing session: an emptied-out box is deleted, otherwise the text, size and alignment are reported if they changed. */
function finishEditing(box: TextBox): void {
  const text = box.textarea.value;
  if (!text.trim()) {
    deleteBox(box);
    return;
  }
  if (!box.committed) {
    box.committed = true;
    box.reportedText = text;
    box.reportedSize = box.size;
    box.reportedAlign = box.align;
    ipcRenderer.send(TextToolOp, {
      kind: 'add',
      id: box.id,
      quote: box.quote,
      dx: box.dx,
      dy: box.dy,
      text,
      size: box.size,
      align: box.align,
    });
    return;
  }
  if (hasUnreportedChange(box)) {
    reportUpdate(box, false);
  }
}

// ── LOOK ─────────────────────────────────────────────────────────────

function applySize(box: TextBox, size: number): void {
  box.size = size;
  box.textarea.style.fontSize = `${size}px`;
  scheduleReposition();
}

function applyAlign(box: TextBox, align: TextAlign): void {
  box.align = align;
  box.textarea.style.textAlign = align;
  box.alignButtons.forEach((button, value) => button.setAttribute('aria-pressed', String(value === align)));
}

/** Steps the font size by `delta` (clamped to the allowed range) and mirrors it into the size field. */
function stepSize(box: TextBox, delta: number): void {
  const next = clampSize(box.size + delta);
  applySize(box, next);
  box.sizeInput.value = String(next);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Three or four stacked lines, each starting at the edge or middle `align` implies — built with DOM calls, not `innerHTML`, which a page's Trusted Types policy could refuse. */
function buildAlignIcon(align: TextAlign): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  const widths = [12, 7, 12, 7];
  widths.forEach((width, index) => {
    const x = align === 'left' ? 2 : align === 'center' ? (16 - width) / 2 : 14 - width;
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', `M${x} ${3 + index * 3.4}h${width}`);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  });
  return svg;
}

/** A panel button whose press must not pull focus out of the box being edited. */
function buildPanelButton(title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('mousedown', (event) => event.preventDefault());
  return button;
}

// ── WIRING ───────────────────────────────────────────────────────────

function wireKeys(box: TextBox): void {
  box.wrapper.addEventListener('keydown', (event) => {
    // Keeps the page's own shortcuts (and this app's tool keys) out of typing.
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.code === 'Period') {
        event.preventDefault();
        stepSize(box, 1);
      } else if (event.code === 'Comma') {
        event.preventDefault();
        stepSize(box, -1);
      }
    }
  });
  box.sizeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      box.textarea.focus();
    }
  });
}

function wireSizeField(box: TextBox): void {
  // Applied live while it holds a valid in-range number, so typing "24" shows 24 at once;
  // an out-of-range or empty value is only corrected when the field loses focus.
  box.sizeInput.addEventListener('input', () => {
    const typed = box.sizeInput.valueAsNumber;
    if (Number.isFinite(typed) && typed >= FONT_SIZE_MIN && typed <= FONT_SIZE_MAX) {
      applySize(box, Math.round(typed));
    }
  });
  box.sizeInput.addEventListener('change', () => {
    const typed = box.sizeInput.valueAsNumber;
    const next = Number.isFinite(typed) ? clampSize(typed) : box.size;
    applySize(box, next);
    box.sizeInput.value = String(next);
  });
}

/**
 * Pressing the frame around the text (the wrapper itself, not the text or
 * the panel) drags the box. The box moves live; on release it's re-anchored
 * to the page content under its new spot (`commitMove`).
 */
function wireDrag(box: TextBox): void {
  const { wrapper } = box;
  // A press on the frame mustn't move focus off the text, or an empty box would vanish mid-drag.
  wrapper.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    if (event.target === wrapper) {
      event.preventDefault();
    }
  });
  wrapper.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (!active || event.button !== 0 || event.target !== wrapper) {
      return;
    }
    event.preventDefault();
    wrapper.setPointerCapture(event.pointerId);
    drag = {
      box,
      startX: event.clientX,
      startY: event.clientY,
      baseDx: box.dx,
      baseDy: box.dy,
      moved: false,
    };
  });
  wrapper.addEventListener('pointermove', (event) => {
    if (!drag || drag.box !== box) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {
      return;
    }
    drag.moved = true;
    box.dx = drag.baseDx + deltaX;
    box.dy = drag.baseDy + deltaY;
    positionBox(box);
  });
  const endDrag = (): void => {
    const finished = drag;
    drag = null;
    if (finished && finished.box === box && finished.moved) {
      commitMove(box);
    }
  };
  wrapper.addEventListener('pointerup', endDrag);
  wrapper.addEventListener('pointercancel', endDrag);
}

/**
 * Re-anchors a dragged box at its new spot: a fresh anchor span is dropped
 * into whatever page text is under it (the box itself is hidden for that
 * hit-test, or it would be what's found), the old one removed, and — if main
 * already knows the box — the new anchor reported so it persists.
 */
function commitMove(box: TextBox): void {
  const rect = box.anchor.getBoundingClientRect();
  const x = Math.min(Math.max(0, rect.left + box.dx), window.innerWidth - FRAME_PX);
  const y = Math.min(Math.max(0, rect.top + box.dy), window.innerHeight - FRAME_PX);
  box.wrapper.style.visibility = 'hidden';
  const next = createLiveAnchor(x, y);
  box.wrapper.style.visibility = '';
  box.anchor.remove();
  box.anchor = next.anchor;
  box.dx = next.dx;
  box.dy = next.dy;
  box.quote = next.quote;
  positionBox(box);
  if (box.committed) {
    reportUpdate(box, true);
  }
}

interface CreateBoxParams {
  readonly id: string;
  readonly anchor: HTMLElement;
  readonly quote: TextBoxQuote;
  readonly dx: number;
  readonly dy: number;
  readonly text: string;
  readonly size: number;
  readonly align: TextAlign;
  readonly committed: boolean;
}

function buildBar(): {
  bar: HTMLDivElement;
  sizeInput: HTMLInputElement;
  alignButtons: Map<TextAlign, HTMLButtonElement>;
  deleteButton: HTMLButtonElement;
} {
  const bar = document.createElement('div');
  bar.className = BAR_CLASS;
  const sizeInput = document.createElement('input');
  sizeInput.className = SIZE_CLASS;
  sizeInput.type = 'number';
  sizeInput.min = String(FONT_SIZE_MIN);
  sizeInput.max = String(FONT_SIZE_MAX);
  sizeInput.step = '1';
  sizeInput.title = `Font size (${FONT_SIZE_MIN}–${FONT_SIZE_MAX}) — Ctrl+. larger, Ctrl+, smaller`;
  bar.appendChild(sizeInput);
  const alignButtons = new Map<TextAlign, HTMLButtonElement>();
  for (const align of ALIGNMENTS) {
    const button = buildPanelButton(`Align ${align}`);
    button.appendChild(buildAlignIcon(align));
    alignButtons.set(align, button);
    bar.appendChild(button);
  }
  const deleteButton = buildPanelButton('Delete text box');
  deleteButton.setAttribute('data-ns-delete', '');
  deleteButton.textContent = '×';
  bar.appendChild(deleteButton);
  return { bar, sizeInput, alignButtons, deleteButton };
}

function createBox(params: CreateBoxParams): TextBox {
  const { id, anchor, quote, dx, dy, text, size, align, committed } = params;

  const wrapper = document.createElement('div');
  wrapper.className = BOX_CLASS;
  wrapper.setAttribute('data-ntb-id', id);
  wrapper.style.setProperty('--ns-tb-color', rgb(currentColor));
  // Clicks inside a box are for editing it, never for the page or a new drop.
  wrapper.addEventListener('click', (event) => event.stopPropagation());

  const textarea = document.createElement('textarea');
  textarea.className = INPUT_CLASS;
  textarea.rows = 1;
  textarea.wrap = 'off';
  textarea.spellcheck = false;
  textarea.value = text;
  textarea.style.fontSize = `${size}px`;
  textarea.addEventListener('input', scheduleReposition);

  const { bar, sizeInput, alignButtons, deleteButton } = buildBar();
  sizeInput.value = String(size);
  wrapper.append(textarea, bar);
  ensureRoot().appendChild(wrapper);

  const box: TextBox = {
    id,
    anchor,
    wrapper,
    textarea,
    sizeInput,
    alignButtons,
    quote,
    dx,
    dy,
    size,
    align,
    committed,
    reportedText: committed ? text : '',
    reportedSize: size,
    reportedAlign: align,
  };
  boxes.set(id, box);
  applyAlign(box, align);

  deleteButton.addEventListener('click', () => deleteBox(box));
  alignButtons.forEach((button, value) => button.addEventListener('click', () => applyAlign(box, value)));
  wireKeys(box);
  wireSizeField(box);
  wireDrag(box);
  // Focus moving between the textarea and the size field stays inside the
  // wrapper, so only focus leaving it entirely ends the editing session.
  wrapper.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || !wrapper.contains(event.relatedTarget)) {
      if (boxes.has(id)) {
        finishEditing(box);
      }
    }
  });

  wrapper.classList.toggle(`${BOX_CLASS}--live`, active);
  scheduleReposition();
  return box;
}

function dropBoxAt(x: number, y: number): void {
  const { anchor, dx, dy, quote } = createLiveAnchor(x, y);
  const box = createBox({
    id: crypto.randomUUID(),
    anchor,
    quote,
    dx,
    dy,
    text: '',
    size: FONT_SIZE_DEFAULT,
    align: 'left',
    committed: false,
  });
  positionBox(box);
  box.textarea.focus();
}

/** Re-applies a stored/synced box — see `tabComments.ts`'s `applyStoredComment`. */
function applyStoredBox(record: TextBoxRecord): void {
  if (boxes.has(record.id)) {
    return;
  }
  const { anchor, dx, dy } = buildRestoredAnchor(record.quote);
  createBox({
    id: record.id,
    anchor,
    quote: record.quote,
    dx: record.dx + dx,
    dy: record.dy + dy,
    text: record.text,
    size: record.size,
    align: record.align,
    committed: true,
  });
}

/** Applies a change another tab made to the same box. */
function applyPatch(box: TextBox, patch: TextBoxPatch): void {
  if (patch.text !== undefined) {
    box.textarea.value = patch.text;
    box.reportedText = patch.text;
  }
  if (patch.size !== undefined) {
    box.sizeInput.value = String(patch.size);
    box.reportedSize = patch.size;
    applySize(box, patch.size);
  }
  if (patch.align !== undefined) {
    box.reportedAlign = patch.align;
    applyAlign(box, patch.align);
  }
  if (patch.quote && patch.dx !== undefined && patch.dy !== undefined) {
    const restored = buildRestoredAnchor(patch.quote);
    box.anchor.remove();
    box.anchor = restored.anchor;
    box.quote = patch.quote;
    box.dx = patch.dx + restored.dx;
    box.dy = patch.dy + restored.dy;
    scheduleReposition();
  }
}

function repaintAll(color: RgbColor): void {
  boxes.forEach((box) => box.wrapper.style.setProperty('--ns-tb-color', rgb(color)));
}

function setActive(nextActive: boolean, color: RgbColor): void {
  const colorChanged = color.r !== currentColor.r || color.g !== currentColor.g || color.b !== currentColor.b;
  const wasActive = active;
  active = nextActive;
  currentColor = color;
  if (colorChanged) {
    repaintAll(color);
  }
  updateCursorStyle();
  if (wasActive && !active) {
    // Blurring runs `finishEditing` through the box's own `focusout`: text is kept, an empty box dropped.
    const focused = shadow?.activeElement;
    if (focused instanceof HTMLElement && focused.closest(`.${BOX_CLASS}`)) {
      focused.blur();
    }
  }
  boxes.forEach((box) => box.wrapper.classList.toggle(`${BOX_CLASS}--live`, active));
  scheduleReposition();
}

// ── PAGE EVENTS ──────────────────────────────────────────────────────

document.addEventListener('scroll', () => scheduleReposition(), { capture: true, passive: true });
window.addEventListener('resize', () => scheduleReposition());

// A navigation mid-edit would otherwise lose the box; focus doesn't leave first.
window.addEventListener('pagehide', () => {
  Array.from(boxes.values()).forEach(finishEditing);
});

/** Whether an event (as seen from outside the shadow root, retargeted to its host) came from a box. */
function isOwnTarget(target: EventTarget | null): boolean {
  return root !== null && target === root;
}

// While the tool is on, a click is for dropping a box — never for following a
// link or pressing a button (same suppression as the comment tool).
document.addEventListener(
  'mousedown',
  (event) => {
    if (active && !isOwnTarget(event.target) && isInteractiveTarget(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

function suppressClick(event: MouseEvent): void {
  if (active && !isOwnTarget(event.target)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
document.addEventListener('dblclick', suppressClick, true);
document.addEventListener('auxclick', suppressClick, true);

document.addEventListener(
  'click',
  (event) => {
    if (!active || isOwnTarget(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    dropBoxAt(event.clientX, event.clientY);
  },
  true,
);

// ── MESSAGES FROM MAIN ───────────────────────────────────────────────

ipcRenderer.on(TextToolState, (_event, payload: { active: boolean; color: RgbColor }) => {
  setActive(payload.active, payload.color);
});

ipcRenderer.on(TextToolRestore, (_event, payload: { boxes: TextBoxRecord[] }) => {
  payload.boxes.forEach(applyStoredBox);
});

// The "revert page" action — main already handled the persisted side.
ipcRenderer.on(TextToolClear, () => {
  Array.from(boxes.values()).forEach(removeBoxFromDom);
});

ipcRenderer.on(
  TextToolApplyOp,
  (
    _event,
    payload:
      | { action: 'add'; box: TextBoxRecord }
      | { action: 'update'; id: string; patch: TextBoxPatch }
      | { action: 'remove'; id: string },
  ) => {
    if (payload.action === 'add') {
      applyStoredBox(payload.box);
      return;
    }
    const box = boxes.get(payload.id);
    if (!box) {
      return;
    }
    if (payload.action === 'remove') {
      removeBoxFromDom(box);
    } else {
      applyPatch(box, payload.patch);
    }
  },
);

// See `tabHighlighter.ts`: rebuild the cursor rule if the theme flips mid-use.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateCursorStyle());
