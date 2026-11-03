// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import { PAN_WRAP_TIMEOUT_MS, wrapTargetAt, type PanBounds, type PanWrap } from './panWrap';

/** Whatever a pan moves: an element's scroll position, or anything shaped like one. */
export interface PanScroller {
  scrollLeft: number;
  scrollTop: number;
}

/** What a `DragPanner` needs from the page it pans. */
export interface DragPannerHost {
  /** The view the pointer wraps around, in the same coordinates as the pointer. */
  viewBounds(): PanBounds;
  /** Moves the OS pointer to a point of the view, for the wrap (see `wrapTargetAt`). */
  warpPointer(x: number, y: number): void;
  /** The current time in ms (`performance.now()`), injected so a wrap's timeout can be tested. */
  now(): number;
}

/** A grab in progress: the scroller it moves, the pointer's last position, and any wrap on its way. */
interface Grab {
  readonly scroller: PanScroller;
  x: number;
  y: number;
  wrap: PanWrap | null;
}

/**
 * The hand tool's drag: while the page is grabbed, it follows the pointer the
 * way paper follows a hand, and the pointer wraps to the opposite edge when it
 * reaches one so a long pan never runs out of room (as in Okular). The same
 * motion as the PDF viewer's pan, for a web page's and a note's.
 */
export class DragPanner {
  private grab: Grab | null = null;

  /**
   * @param host The page's view, the pointer warp and the clock.
   */
  public constructor(private readonly host: DragPannerHost) {}

  /** Whether the page is grabbed right now. */
  public get isPanning(): boolean {
    return this.grab !== null;
  }

  /**
   * Grabs the page.
   * @param scroller What the drag moves.
   * @param x The pointer's x.
   * @param y The pointer's y.
   */
  public press(scroller: PanScroller, x: number, y: number): void {
    this.grab = { scroller, x, y, wrap: null };
  }

  /**
   * Moves the grabbed page with the pointer, and wraps the pointer at an edge.
   * A no-op while nothing is grabbed.
   * @param x The pointer's x.
   * @param y The pointer's y.
   */
  public move(x: number, y: number): void {
    const grab = this.grab;
    if (!grab) {
      return;
    }
    const bounds = this.host.viewBounds();
    if (grab.wrap) {
      // The move that lands the pointer on the opposite edge is the wrap itself, not the hand moving the page.
      const landedX = grab.wrap.x === null || Math.abs(x - grab.x) > (bounds.right - bounds.left) / 2;
      const landedY = grab.wrap.y === null || Math.abs(y - grab.y) > (bounds.bottom - bounds.top) / 2;
      if (landedX && landedY) {
        grab.x = x;
        grab.y = y;
        grab.wrap = null;
        return;
      }
      // Never arrived (the OS pointer can't be moved here): an ordinary drag, which may ask again.
      if (this.host.now() - grab.wrap.requestedAt > PAN_WRAP_TIMEOUT_MS) {
        grab.wrap = null;
      }
    }
    grab.scroller.scrollLeft -= x - grab.x;
    grab.scroller.scrollTop -= y - grab.y;
    grab.x = x;
    grab.y = y;
    if (!grab.wrap) {
      const target = wrapTargetAt(bounds, x, y);
      if (target) {
        grab.wrap = { ...target, requestedAt: this.host.now() };
        this.host.warpPointer(target.x ?? x, target.y ?? y);
      }
    }
  }

  /** Lets go of the page. */
  public release(): void {
    this.grab = null;
  }
}
