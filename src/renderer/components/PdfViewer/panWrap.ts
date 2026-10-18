// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

/** The view a pan wraps around, as `getBoundingClientRect` gives it. */
export interface PanBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where the pointer is sent on each axis to wrap; `null` on an axis that doesn't wrap. */
export interface PanWrapTarget {
  readonly x: number | null;
  readonly y: number | null;
}

/** A wrap that has been asked for and not yet seen to land. */
export interface PanWrap extends PanWrapTarget {
  /** When it was asked for (`performance.now()`). */
  readonly requestedAt: number;
}

/** How close (px) to an edge of the view the pointer must come for the pan to wrap. */
export const PAN_WRAP_EDGE_PX = 2;

/**
 * How far inside the opposite edge (px) a wrapped pointer lands: well clear of
 * that edge's own wrap zone, so landing doesn't send it straight back.
 */
export const PAN_WRAP_LANDING_INSET_PX = 12;

/** How long (ms) a wrap may take to land before the pan stops waiting for it. */
export const PAN_WRAP_TIMEOUT_MS = 250;

/**
 * Where a pan's pointer goes when it reaches an edge of the view: to just
 * inside the opposite edge, as in Okular. Past an edge counts too, since a
 * captured drag keeps reporting the pointer outside the view.
 * @param bounds The view.
 * @param x The pointer's x, in the same coordinates as `bounds`.
 * @param y The pointer's y, in the same coordinates as `bounds`.
 * @returns The point to send it to, or `null` if it isn't at an edge.
 */
export function wrapTargetAt(bounds: PanBounds, x: number, y: number): PanWrapTarget | null {
  const across = (value: number, start: number, end: number): number | null => {
    // Too small to wrap in: there is nowhere clear of both edges to land.
    if (end - start <= 2 * PAN_WRAP_LANDING_INSET_PX) {
      return null;
    }
    if (value <= start + PAN_WRAP_EDGE_PX) {
      return end - 1 - PAN_WRAP_LANDING_INSET_PX;
    }
    if (value >= end - 1 - PAN_WRAP_EDGE_PX) {
      return start + PAN_WRAP_LANDING_INSET_PX;
    }
    return null;
  };
  const target = { x: across(x, bounds.left, bounds.right), y: across(y, bounds.top, bounds.bottom) };
  return target.x === null && target.y === null ? null : target;
}
