// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/** Which side of a tab a dragged tab would land on. */
export type PreviewSide = 'before' | 'after';

/**
 * The order the tab strip shows while a tab is mid-drag: the dragged tab(s)
 * already sitting where a release would put them. Nothing is committed here;
 * the real reorder happens on drop.
 * @param ids Every tab id in the strip, in their real order.
 * @param dragged The ids being dragged (more than one when a multi-selection is).
 * @param targetId The tab the pointer is over, or `null` for none yet.
 * @param side Which side of that tab the dragged ones would land on.
 * @returns The ids in display order. Unchanged when there is no target, or the
 *   target is itself being dragged (the pointer is over the dragged tab's own slot).
 */
export function previewTabOrder(
  ids: readonly string[],
  dragged: readonly string[],
  targetId: string | null,
  side: PreviewSide,
): string[] {
  if (targetId === null || dragged.includes(targetId) || !ids.includes(targetId)) {
    return [...ids];
  }
  const moving = ids.filter((id) => dragged.includes(id));
  const rest = ids.filter((id) => !dragged.includes(id));
  const targetIndex = rest.indexOf(targetId);
  const insertAt = side === 'before' ? targetIndex : targetIndex + 1;
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}
