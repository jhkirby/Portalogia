// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { test, expect } from '@playwright/test';
import { findDuplicates } from '../../src/shared/duplicates';

const key = (value: string): string | null => value.trim().toLowerCase() || null;

test.describe('findDuplicates', () => {
  test('of a repeated value, the first keeps it and only the later ones are marked', () => {
    expect([...findDuplicates(['A', 'b', 'a', 'B', 'a'], key)].sort()).toEqual([2, 3, 4]);
  });

  test('the item being edited is the duplicate, not the one it now matches', () => {
    expect([...findDuplicates(['Intro', 'Methods', 'intro'], key, 0)]).toEqual([0]);
  });

  test('editing an item that repeats nothing leaves the later repeats marked as before', () => {
    expect([...findDuplicates(['A', 'B', 'a'], key, 1)]).toEqual([2]);
  });

  test('items left out (no key) and distinct values are never marked', () => {
    expect([...findDuplicates(['', ' ', 'A', 'B'], key)]).toEqual([]);
  });

  test('numbers compare too: a repeated page', () => {
    expect([...findDuplicates([3, 1, 3], (page) => page, 0)]).toEqual([0]);
  });
});
