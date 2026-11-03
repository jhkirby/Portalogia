// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import type { HistoryClearRange } from './ipc-contract';

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The moment a History range reaches back to: visits made at or after it are
 * in the range. "Months" are calendar months, so "1 month" on the 31st lands
 * on the right day of the month before rather than a fixed 30 days back.
 * Shared by main (what "Clear History" deletes) and the History page (what its
 * table shows), so the two always mean the same thing by the same numbers.
 * @param range The last N of a unit, or all time.
 * @param now The current time, in milliseconds since the epoch.
 * @returns The cutoff, or `null` for everything.
 */
export function historyCutoff(range: HistoryClearRange, now: number): number | null {
  switch (range.unit) {
    case 'all':
      return null;
    case 'hours':
      return now - range.amount * MS_PER_HOUR;
    case 'days':
      return now - range.amount * 24 * MS_PER_HOUR;
    case 'weeks':
      return now - range.amount * 7 * 24 * MS_PER_HOUR;
    case 'months': {
      const cutoff = new Date(now);
      const day = cutoff.getDate();
      // Step the month from the 1st: from the 31st, "one month back" would otherwise overflow past a shorter month's end.
      cutoff.setDate(1);
      cutoff.setMonth(cutoff.getMonth() - range.amount);
      cutoff.setDate(Math.min(day, new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate()));
      return cutoff.getTime();
    }
  }
}
