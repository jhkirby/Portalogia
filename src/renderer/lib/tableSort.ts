// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

/** Which way a column sorts its rows. */
export type SortDirection = 'asc' | 'desc';

/** One column a table is sorted by. */
export interface SortKey<C extends string> {
  readonly column: C;
  readonly direction: SortDirection;
}

/**
 * The columns a table is sorted by, most recently clicked first: that one is
 * the primary key, each after it breaks the ties of those before.
 */
export type SortKeys<C extends string> = readonly SortKey<C>[];

/**
 * The sort after a click on a column's heading. A heading steps through
 * ascending, descending and unsorted, then round again; whichever column was
 * clicked last becomes the primary key, and an unsorted one drops out.
 * @param keys The sort before the click.
 * @param column The column clicked.
 * @returns The sort after it.
 */
export function toggleSortKey<C extends string>(keys: SortKeys<C>, column: C): SortKeys<C> {
  const current = keys.find((key) => key.column === column)?.direction;
  const rest = keys.filter((key) => key.column !== column);
  if (current === undefined) {
    return [{ column, direction: 'asc' }, ...rest];
  }
  if (current === 'asc') {
    return [{ column, direction: 'desc' }, ...rest];
  }
  return rest;
}

/** @returns How a column is sorted, or `null` if it isn't. */
export function sortDirectionOf<C extends string>(keys: SortKeys<C>, column: C): SortDirection | null {
  return keys.find((key) => key.column === column)?.direction ?? null;
}

/**
 * Rows in the order a sort puts them. Stable: rows every key ties on keep the
 * order they came in, so with no keys at all the table shows its own default
 * order (the history newest first, the bookmarks as added).
 * @param rows The rows, in their default order.
 * @param keys The sort, primary key first.
 * @param compare Orders two rows by one column, ascending: negative, zero or positive.
 * @returns A new array; `rows` itself is left alone.
 */
export function sortRows<T, C extends string>(
  rows: readonly T[],
  keys: SortKeys<C>,
  compare: (first: T, second: T, column: C) => number,
): T[] {
  if (keys.length === 0) {
    return [...rows];
  }
  return [...rows].sort((first, second) => {
    for (const { column, direction } of keys) {
      const order = compare(first, second, column);
      if (order !== 0) {
        return direction === 'asc' ? order : -order;
      }
    }
    return 0;
  });
}

const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Orders two cells' text the way a person reads it: ignoring case, and with "file 10" after "file 9". */
export function compareText(first: string, second: string): number {
  return TEXT_COLLATOR.compare(first, second);
}
