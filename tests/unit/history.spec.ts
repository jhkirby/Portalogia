// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { test, expect } from '@playwright/test';
import { historyCutoff } from '../../src/shared/history';

const NOW = new Date('2026-03-31T12:00:00').getTime();
const HOUR = 60 * 60 * 1000;

test.describe('historyCutoff', () => {
  test('all time reaches back to nothing', () => {
    expect(historyCutoff({ unit: 'all' }, NOW)).toBeNull();
  });

  test('hours, days and weeks count back exactly', () => {
    expect(historyCutoff({ unit: 'hours', amount: 3 }, NOW)).toBe(NOW - 3 * HOUR);
    expect(historyCutoff({ unit: 'days', amount: 2 }, NOW)).toBe(NOW - 48 * HOUR);
    expect(historyCutoff({ unit: 'weeks', amount: 1 }, NOW)).toBe(NOW - 168 * HOUR);
  });

  test('months are calendar months', () => {
    const cutoff = new Date(historyCutoff({ unit: 'months', amount: 1 }, NOW) as number);
    // March 31 minus a month is the end of February, not a day into March.
    expect([cutoff.getMonth(), cutoff.getDate()]).toEqual([1, 28]);
  });
});
