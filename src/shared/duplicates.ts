// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

/**
 * Which items repeat a value an earlier one already holds, for a list where
 * each value may exist only once (a PDF's section names and pages, the
 * bookmarks' names and references). One item of each repeated value keeps
 * it and is left unmarked; only the others are the duplicates, so a repeat
 * shows as one box in red rather than every box that shares the value.
 *
 * The one that keeps the value is the first in the list — unless that's the
 * item being edited: typing another's value makes the typed box the
 * duplicate, never the box it now matches.
 * @param items The list.
 * @param keyOf An item's value as compared for sameness (case-folded, trimmed, …), or `null` to leave it out.
 * @param edited The index of the item last edited in this field, if any.
 * @returns The indexes of the duplicates.
 */
export function findDuplicates<T>(
  items: readonly T[],
  keyOf: (item: T) => string | number | null,
  edited: number | null = null,
): Set<number> {
  const byKey = new Map<string | number, number[]>();
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (key !== null) {
      byKey.set(key, [...(byKey.get(key) ?? []), index]);
    }
  });
  const duplicates = new Set<number>();
  for (const indexes of byKey.values()) {
    if (indexes.length < 2) {
      continue;
    }
    const keeper = indexes.find((index) => index !== edited) as number;
    indexes.filter((index) => index !== keeper).forEach((index) => duplicates.add(index));
  }
  return duplicates;
}
