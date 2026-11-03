// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { test, expect } from '@playwright/test';
import { compareText, sortDirectionOf, sortRows, toggleSortKey, type SortKeys } from '../../src/renderer/lib/tableSort';

type Column = 'name' | 'type';

interface Row {
  readonly name: string;
  readonly type: string;
}

const compare = (first: Row, second: Row, column: Column): number => compareText(first[column], second[column]);

test.describe('toggleSortKey', () => {
  test('a heading steps ascending, descending, unsorted, and round again', () => {
    let keys: SortKeys<Column> = [];
    keys = toggleSortKey(keys, 'name');
    expect(sortDirectionOf(keys, 'name')).toBe('asc');
    keys = toggleSortKey(keys, 'name');
    expect(sortDirectionOf(keys, 'name')).toBe('desc');
    keys = toggleSortKey(keys, 'name');
    expect(sortDirectionOf(keys, 'name')).toBeNull();
    expect(keys).toEqual([]);
    keys = toggleSortKey(keys, 'name');
    expect(sortDirectionOf(keys, 'name')).toBe('asc');
  });

  test('the column touched last becomes the primary key', () => {
    let keys: SortKeys<Column> = [];
    keys = toggleSortKey(keys, 'name');
    keys = toggleSortKey(keys, 'type');
    expect(keys.map((key) => key.column)).toEqual(['type', 'name']);
    // Stepping an older key again moves it back to the front, keeping its new direction.
    keys = toggleSortKey(keys, 'name');
    expect(keys).toEqual([
      { column: 'name', direction: 'desc' },
      { column: 'type', direction: 'asc' },
    ]);
  });

  test('a column stepped to unsorted drops out without disturbing the others', () => {
    let keys: SortKeys<Column> = [{ column: 'type', direction: 'asc' }, { column: 'name', direction: 'desc' }];
    keys = toggleSortKey(keys, 'name');
    expect(keys).toEqual([{ column: 'type', direction: 'asc' }]);
  });
});

test.describe('sortRows', () => {
  const rows: readonly Row[] = [
    { name: 'b', type: 'URL' },
    { name: 'a', type: 'PDF' },
    { name: 'c', type: 'URL' },
    { name: 'a', type: 'URL' },
  ];

  test('with no keys, rows keep their own order and the input is left alone', () => {
    const sorted = sortRows(rows, [], compare);
    expect(sorted).toEqual(rows);
    expect(sorted).not.toBe(rows);
  });

  test('sorts by the primary key, breaking its ties with the next', () => {
    const sorted = sortRows(rows, [{ column: 'type', direction: 'asc' }, { column: 'name', direction: 'desc' }], compare);
    expect(sorted.map((row) => `${row.type}:${row.name}`)).toEqual(['PDF:a', 'URL:c', 'URL:b', 'URL:a']);
  });

  test('is stable: rows every key ties on keep their order', () => {
    const sorted = sortRows(rows, [{ column: 'type', direction: 'desc' }], compare);
    expect(sorted.map((row) => row.name)).toEqual(['b', 'c', 'a', 'a']);
  });
});

test.describe('compareText', () => {
  test('ignores case and orders numbers by value', () => {
    expect(compareText('Apple', 'apple')).toBe(0);
    expect(compareText('file 9', 'file 10')).toBeLessThan(0);
  });
});
