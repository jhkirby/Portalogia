// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { test, expect } from '@playwright/test';
import { formatByteCount, formatByteFraction } from '../../src/renderer/lib/formatBytes';

test.describe('formatByteCount', () => {
  test('plain bytes below a kilobyte', () => {
    expect(formatByteCount(0)).toBe('0 B');
    expect(formatByteCount(1023)).toBe('1023 B');
  });

  test('one decimal under 10 of a unit, none above', () => {
    expect(formatByteCount(1024)).toBe('1.0 KB');
    expect(formatByteCount(4300)).toBe('4.2 KB');
    expect(formatByteCount(38 * 1024 * 1024)).toBe('38 MB');
    expect(formatByteCount(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });

  test('a count past the largest unit stays in it', () => {
    expect(formatByteCount(5000 * 1024 ** 3)).toBe('5000 GB');
  });

  test('negative and fractional counts are taken as whole, non-negative bytes', () => {
    expect(formatByteCount(-5)).toBe('0 B');
    expect(formatByteCount(10.9)).toBe('10 B');
  });
});

test.describe('formatByteFraction', () => {
  test('loaded over total, each in its own unit', () => {
    expect(formatByteFraction(412 * 1024, 3.2 * 1024 * 1024)).toBe('412 KB / 3.2 MB');
  });

  test('never shows more loaded than the total', () => {
    expect(formatByteFraction(2048, 1024)).toBe('1.0 KB / 1.0 KB');
  });
});
