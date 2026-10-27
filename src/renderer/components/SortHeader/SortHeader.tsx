// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useState } from 'react';
import { sortDirectionOf, toggleSortKey, type SortDirection, type SortKeys } from '../../lib/tableSort';

/**
 * A table's sort, as its headings set it: see `toggleSortKey` for how a click
 * steps a column through ascending, descending and unsorted.
 * @returns The sort (primary key first), how a column is sorted, and the click that steps a column on.
 */
export function useTableSort<C extends string>() {
  const [keys, setKeys] = useState<SortKeys<C>>([]);
  return {
    keys,
    directionOf: (column: C): SortDirection | null => sortDirectionOf(keys, column),
    toggle: (column: C): void => setKeys((current) => toggleSortKey(current, column)),
  };
}

/** What a heading's mark says about its column: up for ascending, down for descending, a dot for unsorted. */
function SortMark({ direction }: { readonly direction: SortDirection | null }) {
  return (
    <svg className="sort-header__mark" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
      {direction === 'asc' ? (
        <path d="M5 1.5 9 8.5H1Z" fill="currentColor" />
      ) : direction === 'desc' ? (
        <path d="M5 8.5 1 1.5h8Z" fill="currentColor" />
      ) : (
        <circle cx="5" cy="5" r="1.6" fill="currentColor" />
      )}
    </svg>
  );
}

interface SortHeaderProps {
  readonly label: string;
  readonly direction: SortDirection | null;
  readonly onToggle: () => void;
  /** The `<th>`'s own classes: its table's heading look and the column's width. */
  readonly className: string;
}

/**
 * A column heading that sorts its table: its name, then a mark for how the
 * column is sorted. A click steps it to ascending, then descending, then
 * unsorted, and round again; the column clicked last sorts first. Shared by
 * the History and Bookmarks tables.
 */
export function SortHeader({ label, direction, onToggle, className }: SortHeaderProps) {
  const next = direction === null ? 'ascending' : direction === 'asc' ? 'descending' : 'unsorted';
  return (
    <th
      className={className}
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        className={`sort-header${direction ? ' sort-header--sorted' : ''}`}
        onClick={onToggle}
        title={`Sort by ${label.toLowerCase()} (${next})`}
      >
        <span className="sort-header__label">{label}</span>
        <SortMark direction={direction} />
      </button>
    </th>
  );
}
