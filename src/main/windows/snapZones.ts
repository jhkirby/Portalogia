// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

/** A rectangle in screen (DIP) coordinates — structurally the same as Electron's `Rectangle`. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point in screen (DIP) coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** What a window dropped in a snap zone becomes: the whole work area, or a half/quarter of it. */
export interface SnapZone {
  readonly kind: 'maximize' | 'snap';
  /** Where the window ends up (and where the preview outline is drawn). */
  readonly rect: Rect;
}

/** How close, in px, the cursor must be to a screen edge to count as "at" it. */
export const SNAP_EDGE_PX = 8;

/** Longest stretch, in px, along a left/right edge from a corner that still counts as that corner (quarter snap). */
const SNAP_CORNER_MAX_PX = 160;

/**
 * Which snap zone, if any, the cursor is in — the same layout Windows uses
 * when you drag a window by its title: the left or right screen edge snaps to
 * that half, a corner snaps to that quarter, and the top edge maximizes.
 * Pure, so the rules can be unit-tested without a screen.
 * @param cursor The cursor's screen position.
 * @param display The full bounds of the display the cursor is on — edges are
 *   measured against this, since the cursor can't go past it.
 * @param workArea That display's work area (bounds minus the taskbar) — the
 *   rectangle the window is actually snapped into.
 * @returns The zone, or `null` when the cursor isn't against an edge.
 */
export function snapZoneAt(cursor: Point, display: Rect, workArea: Rect): SnapZone | null {
  const atLeft = cursor.x <= display.x + SNAP_EDGE_PX;
  const atRight = cursor.x >= display.x + display.width - SNAP_EDGE_PX;
  const atTop = cursor.y <= display.y + SNAP_EDGE_PX;

  if (atLeft || atRight) {
    // The left half is rounded down and the right takes the leftover pixel,
    // so on an odd width the two halves still tile the work area exactly.
    const leftWidth = Math.floor(workArea.width / 2);
    const half = atLeft ? leftWidth : workArea.width - leftWidth;
    const x = atLeft ? workArea.x : workArea.x + leftWidth;
    const corner = Math.min(SNAP_CORNER_MAX_PX, display.height * 0.2);
    const topHeight = Math.floor(workArea.height / 2);
    if (cursor.y <= display.y + corner) {
      return { kind: 'snap', rect: { x, y: workArea.y, width: half, height: topHeight } };
    }
    if (cursor.y >= display.y + display.height - corner) {
      return {
        kind: 'snap',
        rect: { x, y: workArea.y + topHeight, width: half, height: workArea.height - topHeight },
      };
    }
    return { kind: 'snap', rect: { x, y: workArea.y, width: half, height: workArea.height } };
  }

  if (atTop) {
    return { kind: 'maximize', rect: workArea };
  }
  return null;
}
