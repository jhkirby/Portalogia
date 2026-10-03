// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-27

import { ipcRenderer } from 'electron';
import { isEditableTarget, toolInk } from './tabHighlighter';

// Hardcoded rather than imported from `@shared/ipc-contract` — same reason
// `tabHighlighter.ts`/`tabComments.ts` hardcode their own channel names: this
// module is folded into `tabZoom.ts`'s own single Rollup preload entry (see
// `electron.vite.config.ts`), and a runtime value shared with any other entry
// gets split into a chunk the sandboxed CJS loader can't `require()`.
// `PenController` (main-process) hardcodes the exact same strings — keep the
// two in sync by hand.
const PenState = 'pen:state';
const PenOp = 'pen:op';
const PenApplyOp = 'pen:apply-op';
const PenRestore = 'pen:restore';
const PenClear = 'pen:clear';

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface PenPoint {
  readonly x: number;
  readonly y: number;
}

interface PenRecord {
  readonly id: string;
  readonly points: readonly PenPoint[];
  readonly color: RgbColor;
}

const STROKE_CLASS = 'northstar-pen-stroke';
const STROKE_HOVER_CLASS = 'northstar-pen-stroke--hovered';
/** The invisible companion path drawn on top of every visible stroke, wider than it so a stroke is easy to hover/click without needing pixel-perfect aim — see `beginStroke`. */
const HIT_CLASS = 'northstar-pen-hit';
const ID_ATTR = 'data-nsp-id';

/** A finished stroke's own line width and opacity — solid-looking, unlike a highlighter's translucent wash. */
const STROKE_WIDTH = 3;
const STROKE_ALPHA = 0.9;
/** How much a stroke lightens on hover (`STROKE_HOVER_CLASS`) — the same visual cue, and the same amount, `tabHighlighter.ts` uses for a hovered highlight. */
const HOVER_OPACITY = 0.5;
const HIT_WIDTH = 14;
/**
 * How far the pointer can move between mousedown and mouseup before a
 * gesture that started on an existing stroke stops counting as "a click to
 * delete it" and is instead read as an intentional drag (which draws a fresh
 * stroke over/past it, same as starting anywhere else on the page).
 */
const CLICK_DRAG_THRESHOLD_PX = 4;

let active = false;
let currentColor: RgbColor = { r: 26, g: 115, b: 232 };
let hoveredStrokeId: string | null = null;
let cursorStyleEl: HTMLStyleElement | null = null;
/**
 * The one full-document drawing surface every stroke lives in — a near-zero
 * (`1px` x `1px`, see `ensureOverlay`) viewport with `overflow: visible`, so
 * its children paint at whatever page coordinates they carry regardless of
 * the surface's own nominal box; this never needs resizing to track the
 * document's own scroll height the way a full-size element would. It cannot
 * actually be `0`x`0`: per the SVG spec, a zero width or height on the root
 * `<svg>` disables rendering of the element (and everything inside it)
 * outright, `overflow` notwithstanding. Appended to `documentElement` rather
 * than `body` so its absolute positioning is anchored to the true page
 * origin even on a page whose own `body` has non-zero margin — best effort
 * still, same as everything else here: a page whose `html` element itself
 * carries `position: relative` (rare, but real) would offset it.
 */
let overlay: SVGSVGElement | null = null;

let dragStart: PenPoint | null = null;
let dragged = false;
let hitIdAtDown: string | null = null;
let currentId: string | null = null;
let currentPoints: PenPoint[] = [];
let currentVisiblePath: SVGPathElement | null = null;
let currentHitPath: SVGPathElement | null = null;

function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** A small pen-nib cursor, encoded as a data URI — shown in place of the ordinary pointer while the pen tool is active. */
function penCursorCss(): string {
  const ink = toolInk();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M4 20 5.2 15.6 14.8 6 18 9.2 8.4 18.8 4 20Z" fill="' + ink + '" stroke="' + ink + '" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="m14.8 6 2-2a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4l-2 2Z" fill="none" stroke="' + ink + '" stroke-width="1.4" stroke-linejoin="round"/>' +
    '</svg>';
  // Single-quoted `url(...)` wrapper — see `tabHighlighter.ts`'s own comment
  // on `highlighterCursorCss` for why this matters.
  return `url('data:image/svg+xml,${svg}') 2 22, crosshair`;
}

function buildStyleRuleText(): string {
  return (
    `html, html * { cursor: ${penCursorCss()} !important; } ` + `.${STROKE_HOVER_CLASS} { opacity: ${HOVER_OPACITY}; }`
  );
}

function ensureOverlay(): SVGSVGElement {
  if (overlay) {
    return overlay;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-northstar', 'pen-overlay');
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '1px';
  svg.style.height = '1px';
  svg.style.overflow = 'visible';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '2147483000';
  document.documentElement.appendChild(svg);
  overlay = svg;
  return svg;
}

function pointsToPath(points: readonly PenPoint[]): string {
  if (points.length === 0) {
    return '';
  }
  const [first, ...rest] = points;
  return `M ${first!.x} ${first!.y} ` + rest.map((point) => `L ${point.x} ${point.y}`).join(' ');
}

/** Re-paints every existing stroke to `color` — a stroke's color is never frozen at creation time; it always tracks whatever the current accent is, same as a highlight's. */
function repaintAllStrokes(color: RgbColor): void {
  document.querySelectorAll<SVGPathElement>(`.${STROKE_CLASS}`).forEach((path) => {
    path.style.stroke = rgba(color, STROKE_ALPHA);
  });
}

function setActive(nextActive: boolean, color: RgbColor): void {
  const colorChanged = color.r !== currentColor.r || color.g !== currentColor.g || color.b !== currentColor.b;
  active = nextActive;
  currentColor = color;
  if (colorChanged) {
    repaintAllStrokes(color);
  }
  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.setAttribute('data-northstar', 'pen-cursor');
  }
  cursorStyleEl.textContent = buildStyleRuleText();
  if (active) {
    if (!cursorStyleEl.isConnected) {
      (document.head ?? document.documentElement).appendChild(cursorStyleEl);
    }
  } else if (cursorStyleEl.isConnected) {
    cursorStyleEl.remove();
  }
  if (!active) {
    setHoveredStroke(null);
    abortInProgressStroke();
  }
}

/** Marks every element sharing `id` as hovered (or clears it, for `null`), lightening the visible stroke via `STROKE_HOVER_CLASS` — a no-op if `id` is already the currently-hovered one. */
function setHoveredStroke(id: string | null): void {
  if (id === hoveredStrokeId) {
    return;
  }
  if (hoveredStrokeId) {
    document
      .querySelectorAll(`.${STROKE_CLASS}[${ID_ATTR}="${CSS.escape(hoveredStrokeId)}"]`)
      .forEach((el) => el.classList.remove(STROKE_HOVER_CLASS));
  }
  hoveredStrokeId = id;
  if (hoveredStrokeId) {
    document
      .querySelectorAll(`.${STROKE_CLASS}[${ID_ATTR}="${CSS.escape(hoveredStrokeId)}"]`)
      .forEach((el) => el.classList.add(STROKE_HOVER_CLASS));
  }
}

/** Builds the visible/hit path pair a stroke is always made of, sharing `id` and `d`. Used both for a live in-progress stroke (`beginStroke`) and a restored/replayed one (`applyStoredStroke`). */
function buildStrokeElements(id: string, d: string, color: RgbColor): { visible: SVGPathElement; hit: SVGPathElement } {
  const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  visible.setAttribute('class', STROKE_CLASS);
  visible.setAttribute(ID_ATTR, id);
  visible.setAttribute('fill', 'none');
  visible.setAttribute('stroke-width', String(STROKE_WIDTH));
  visible.setAttribute('stroke-linecap', 'round');
  visible.setAttribute('stroke-linejoin', 'round');
  visible.setAttribute('d', d);
  visible.style.pointerEvents = 'none';
  visible.style.stroke = rgba(color, STROKE_ALPHA);

  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('class', HIT_CLASS);
  hit.setAttribute(ID_ATTR, id);
  hit.setAttribute('fill', 'none');
  hit.setAttribute('stroke-width', String(HIT_WIDTH));
  hit.setAttribute('stroke-linecap', 'round');
  hit.setAttribute('stroke-linejoin', 'round');
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('d', d);
  // `stroke` (not `auto`/`visiblePainted`) — hit-tests only the drawn line
  // itself, at `HIT_WIDTH`, regardless of the transparent stroke color;
  // never the path's bounding box, which for a wandering freehand line would
  // otherwise swallow clicks meant for whatever the line merely passes near.
  hit.style.pointerEvents = 'stroke';

  return { visible, hit };
}

/** Starts a brand-new, empty stroke and begins tracking its points — always called on mousedown while the tool is active, even one that lands on an existing stroke (see `mouseup`'s own handling of that case). */
function beginStroke(x: number, y: number): void {
  const svg = ensureOverlay();
  const id = crypto.randomUUID();
  const { visible, hit } = buildStrokeElements(id, '', currentColor);
  svg.appendChild(visible);
  svg.appendChild(hit);

  currentId = id;
  currentPoints = [{ x, y }];
  currentVisiblePath = visible;
  currentHitPath = hit;
}

function extendStroke(x: number, y: number): void {
  const last = currentPoints[currentPoints.length - 1];
  if (last && Math.hypot(x - last.x, y - last.y) < 1) {
    // Sub-pixel movement — skip, keeps the point list (and the eventual
    // persisted stroke) from growing on every animation-frame-sized jitter.
    return;
  }
  currentPoints.push({ x, y });
  const d = pointsToPath(currentPoints);
  currentVisiblePath?.setAttribute('d', d);
  currentHitPath?.setAttribute('d', d);
}

/** Ends the in-progress stroke, discarding it if it never grew past a single point (drawn distance too short to register) — reports the finished stroke to main otherwise. */
function finishStroke(): void {
  if (!currentId) {
    return;
  }
  const id = currentId;
  const points = currentPoints;
  const visible = currentVisiblePath;
  const hit = currentHitPath;
  currentId = null;
  currentPoints = [];
  currentVisiblePath = null;
  currentHitPath = null;

  if (points.length < 2) {
    visible?.remove();
    hit?.remove();
    return;
  }
  ipcRenderer.send(PenOp, { kind: 'add', id, points, color: currentColor });
}

/** Removes whatever stroke is currently mid-drag without ever finishing/reporting it — used both by the "clicked an existing stroke" path in `mouseup` (the candidate stroke `mousedown` always starts is discarded in favor of deleting the one clicked) and by turning the tool off mid-draw (e.g. Escape). */
function abortInProgressStroke(): void {
  currentVisiblePath?.remove();
  currentHitPath?.remove();
  currentId = null;
  currentPoints = [];
  currentVisiblePath = null;
  currentHitPath = null;
}

/** Removes every element sharing `id` from the DOM, without reporting anything back to main — see `removeAndReport` for the user-initiated path that does. */
function removeFromDom(id: string): void {
  document.querySelectorAll(`[${ID_ATTR}="${CSS.escape(id)}"]`).forEach((el) => el.remove());
  if (hoveredStrokeId === id) {
    hoveredStrokeId = null;
  }
}

/** Removes every stroke on the page outright — the "revert page" action's pen half (`PenClear`, pushed by `PenController.clearTab`). */
function removeAllFromDom(): void {
  overlay?.replaceChildren();
  hoveredStrokeId = null;
  abortInProgressStroke();
}

/** User-initiated removal (hover + click, or hover + D/Delete) — unlike `removeFromDom` alone, this also reports the op to main so it lands in the undo/redo stack and the on-disk store. */
function removeAndReport(id: string): void {
  removeFromDom(id);
  ipcRenderer.send(PenOp, { kind: 'remove', id });
}

/** Draws a stroke exactly as stored/reported — always painted with the *live* `currentColor`, not `stroke.color`, same reasoning as `tabHighlighter.ts`'s `applyStoredHighlight`. A silent no-op for a malformed (too-short) stroke. */
function applyStoredStroke(stroke: PenRecord): void {
  if (stroke.points.length < 2) {
    return;
  }
  const svg = ensureOverlay();
  const { visible, hit } = buildStrokeElements(stroke.id, pointsToPath(stroke.points), currentColor);
  svg.appendChild(visible);
  svg.appendChild(hit);
}

document.addEventListener(
  'mousedown',
  (event) => {
    if (!active || event.button !== 0) {
      return;
    }
    // No native text selection/drag while drawing — unconditional, unlike
    // `tabHighlighter.ts`'s own mousedown handler, which has to let an
    // ordinary drag through since starting a selection *is* how it works.
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    hitIdAtDown = target?.closest(`.${HIT_CLASS}`)?.getAttribute(ID_ATTR) ?? null;
    dragStart = { x: event.pageX, y: event.pageY };
    dragged = false;
    // Always starts a candidate stroke, even atop an existing one — `mouseup`
    // decides whether this gesture turns out to be "a click that should
    // delete `hitIdAtDown` instead" (discarding this candidate) or "an
    // actual drag that should draw" (keeping it), so a drag that happens to
    // begin on top of a mark still draws normally.
    beginStroke(event.pageX, event.pageY);
  },
  true,
);

document.addEventListener('mousemove', (event) => {
  if (!active) {
    return;
  }
  if (dragStart && !dragged) {
    const dx = event.pageX - dragStart.x;
    const dy = event.pageY - dragStart.y;
    if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
      dragged = true;
    }
  }
  if (currentId) {
    extendStroke(event.pageX, event.pageY);
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const hitEl = target?.closest(`.${HIT_CLASS}`);
  setHoveredStroke(hitEl?.getAttribute(ID_ATTR) ?? null);
});

document.addEventListener(
  'mouseup',
  (event) => {
    if (!active) {
      return;
    }
    if (currentId && !dragged && hitIdAtDown) {
      // A stationary click that landed on an existing stroke — discard the
      // candidate stroke `mousedown` started and delete the one clicked
      // instead, the same action as hovering it and pressing D/Delete.
      abortInProgressStroke();
      removeAndReport(hitIdAtDown);
    } else {
      finishStroke();
    }
    dragStart = null;
    hitIdAtDown = null;
    dragged = false;
    void event;
  },
  true,
);

// Blocks every click's default action (link navigation, button activation,
// the page's own click handler) while the pen tool is on — same reasoning as
// `tabHighlighter.ts`'s own `suppressClick`, just unconditional rather than
// scoped to interactive targets: `mousedown` above already suppresses its
// own default unconditionally too, since (unlike the highlighter) nothing
// about drawing needs an ordinary drag/selection to survive anywhere on the
// page.
function suppressClick(event: MouseEvent): void {
  if (!active) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}
document.addEventListener('click', suppressClick, true);
document.addEventListener('dblclick', suppressClick, true);
document.addEventListener('auxclick', suppressClick, true);

document.addEventListener(
  'keydown',
  (event) => {
    if (!active || !hoveredStrokeId || isEditableTarget(document.activeElement)) {
      return;
    }
    if (event.key === 'd' || event.key === 'D' || event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      removeAndReport(hoveredStrokeId);
    }
  },
  true,
);

ipcRenderer.on(PenState, (_event, payload: { active: boolean; color: RgbColor }) => {
  setActive(payload.active, payload.color);
});

ipcRenderer.on(PenRestore, (_event, payload: { strokes: PenRecord[] }) => {
  for (const stroke of payload.strokes) {
    applyStoredStroke(stroke);
  }
});

ipcRenderer.on(PenClear, () => removeAllFromDom());

ipcRenderer.on(
  PenApplyOp,
  (_event, payload: { action: 'add'; stroke: PenRecord } | { action: 'remove'; id: string }) => {
    if (payload.action === 'add') {
      applyStoredStroke(payload.stroke);
    } else {
      removeFromDom(payload.id);
    }
  },
);

// See `tabHighlighter.ts`: rebuild the cursor rule if the theme flips mid-use.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setActive(active, currentColor));
