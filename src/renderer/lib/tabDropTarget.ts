// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import type { PreviewSide } from './previewTabOrder';

/** One tab's place in the strip as laid out, ignoring any animation that is moving it. */
export interface TabSlot {
  readonly id: string;
  readonly left: number;
  readonly width: number;
}

/** Where the dragged tab(s) would land: beside which tab, and on which side. */
export interface TabDropTarget {
  readonly id: string;
  readonly side: PreviewSide;
}

/**
 * Where a dragged tab should be previewed for a pointer position. Read from
 * where the tabs are laid out (with the dragged tabs already shown in their
 * previewed spot), not where they are drawn mid-slide, so the answer doesn't
 * change while the tabs animate. The dragged tabs pass a neighbour once the
 * pointer crosses its middle; they then sit under the pointer, and going back
 * takes crossing that neighbour's middle again from the other side, so a
 * small wobble never flips them back and forth.
 * @param slots The tabs in the order they're shown.
 * @param dragged The ids being dragged.
 * @param x The pointer, in the same coordinates as the slots.
 * @returns The new target, or `null` to keep the current preview (the pointer
 *   is over the dragged tabs themselves, or over no tab).
 */
export function tabDropTargetAt(
  slots: readonly TabSlot[],
  dragged: readonly string[],
  x: number,
): TabDropTarget | null {
  const over = slots.find((slot) => x >= slot.left && x < slot.left + slot.width);
  if (!over || dragged.includes(over.id)) {
    return null;
  }
  return { id: over.id, side: x < over.left + over.width / 2 ? 'before' : 'after' };
}
