// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

/** The units a byte count is shown in, each 1024 of the one before, as Windows counts a file's size. */
const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/**
 * A byte count as a load shows it beside its percentage: in the largest unit that keeps it at 1 or more, with one
 * decimal under 10 of that unit (so a small load still visibly moves) and none above.
 * @param bytes The count; a negative or fractional one is taken as its whole, non-negative part.
 * @returns E.g. "512 B", "4.2 KB", "38 MB".
 */
export function formatByteCount(bytes: number): string {
  let value = Math.max(0, Math.floor(bytes));
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(value) : value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${shown} ${UNITS[unit]}`;
}
