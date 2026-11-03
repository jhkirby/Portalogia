// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { ipcRenderer, webFrame } from 'electron';
import { DragPanner } from '../shared/DragPanner';
import { HAND_CLOSED_CURSOR, HAND_OPEN_CURSOR } from '../shared/handCursors';

// A web page's pointer modes, the same two the PDF viewer has: Pan, where a drag moves the page like a hand on paper
// (and a click does nothing, so a link can't be followed by accident), and Select, the page's own behavior. Main
// pushes the mode, and whether a tool (the pen, highlighter, comments, text boxes) has the pointer instead, since a
// tool's press is the tool's (see `TabManager.syncPagePointerMode`).
//
// Channel names are hardcoded rather than imported from `@shared/ipc-contract`, same reason as `tabPen.ts`'s.
const TabPointerMode = 'tab:pointer-mode';
const TabWarpPointer = 'tab:warp-pointer';

const STYLE_ATTR = 'data-portalogia';

let mode: 'pan' | 'select' = 'select';
let toolActive = false;
let styleEl: HTMLStyleElement | null = null;

const panner = new DragPanner({
  viewBounds: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
  // Main places the pointer in window pixels, and this page's own zoom (see `tabZoom.ts`) scales the page's.
  warpPointer: (x, y) => {
    const zoom = webFrame.getZoomFactor();
    ipcRenderer.send(TabWarpPointer, { x: x * zoom, y: y * zoom });
  },
  now: () => performance.now(),
});

/** @returns Whether a press on the page grabs it right now. */
function isPannable(): boolean {
  return mode === 'pan' && !toolActive;
}

/** Shows the hand over the whole page while it can be grabbed, closed while it is, and the page's own cursors otherwise. */
function applyCursor(): void {
  if (!isPannable()) {
    styleEl?.remove();
    return;
  }
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute(STYLE_ATTR, 'pan-cursor');
  }
  const cursor = panner.isPanning ? HAND_CLOSED_CURSOR : HAND_OPEN_CURSOR;
  // Nothing can be selected or dragged out while the hand holds the page. Frames and plugins take no pointer input
  // either: this script doesn't run inside them, so a click there would reach their buttons, links and text boxes
  // (sign-in buttons, embeds and ads all live in frames). With them out of hit-testing, a press over one lands on
  // this page, which swallows it and pans. The cost: in Pan mode the wheel scrolls the page, not a frame's inside.
  styleEl.textContent =
    `html, html * { cursor: ${cursor} !important; user-select: none !important; -webkit-user-drag: none !important; }` +
    ' iframe, frame, embed, object { pointer-events: none !important; }';
  if (!styleEl.isConnected) {
    (document.head ?? document.documentElement).appendChild(styleEl);
  }
}

/**
 * Whether a point is on one of the page's own scroll bars, which keep working as scroll bars in Pan mode.
 * @param x The pointer's x.
 * @param y The pointer's y.
 */
function isOnPageScrollbar(x: number, y: number): boolean {
  const root = document.documentElement;
  return x >= root.clientWidth || y >= root.clientHeight;
}

/**
 * Whether an element scrolls on its own, rather than with the page.
 * @param element The element to check.
 */
function scrollsItself(element: Element): boolean {
  const style = getComputedStyle(element);
  const scrolls = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
  return (
    (scrolls(style.overflowY) && element.scrollHeight > element.clientHeight + 1) ||
    (scrolls(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
  );
}

/**
 * What a press here moves: the nearest scroll box around it — an app like Google Docs scrolls a box of its own,
 * not the page — or the page itself.
 * @param event The press.
 */
function scrollerFor(event: PointerEvent): Element {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node !== document.documentElement && node !== document.body && scrollsItself(node)) {
      return node;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Keeps a press, release or click away from the page while it can be grabbed: in Pan mode a drag moves the page
 * and a click does nothing, as on a PDF.
 * @param event The mouse or pointer event.
 */
function swallow(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

window.addEventListener(
  'pointerdown',
  (event) => {
    if (!isPannable() || event.button !== 0 || isOnPageScrollbar(event.clientX, event.clientY)) {
      return;
    }
    swallow(event);
    panner.press(scrollerFor(event), event.clientX, event.clientY);
    // Captured, so the drag keeps going once the pointer leaves the page.
    document.documentElement.setPointerCapture(event.pointerId);
    window.getSelection()?.removeAllRanges();
    applyCursor();
  },
  true,
);

window.addEventListener(
  'pointermove',
  (event) => {
    if (panner.isPanning) {
      swallow(event);
      panner.move(event.clientX, event.clientY);
    }
  },
  true,
);

const endPan = (event: PointerEvent): void => {
  if (panner.isPanning) {
    swallow(event);
    panner.release();
    applyCursor();
  }
};
window.addEventListener('pointerup', endPan, true);
window.addEventListener('pointercancel', endPan, true);

for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'dragstart']) {
  window.addEventListener(
    type,
    (event) => {
      if (isPannable() && (event as MouseEvent).button === 0) {
        swallow(event);
      }
    },
    true,
  );
}

ipcRenderer.on(TabPointerMode, (_event, state: unknown) => {
  if (typeof state !== 'object' || state === null) {
    return;
  }
  const next = (state as { mode?: unknown }).mode;
  mode = next === 'pan' ? 'pan' : 'select';
  toolActive = (state as { toolActive?: unknown }).toolActive === true;
  if (!isPannable()) {
    panner.release();
  } else {
    // A selection made in Select mode would be left stranded where nothing can change it.
    window.getSelection()?.removeAllRanges();
  }
  applyCursor();
});
