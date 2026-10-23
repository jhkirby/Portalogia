// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import { test, expect } from '@playwright/test';
import { formatClockDate, formatClockTime, msUntilNextSecond, ordinalDay } from '../../src/renderer/lib/clockFormat';

test.describe('ordinalDay', () => {
  test('1, 2 and 3 end in st, nd and rd; the rest in th', () => {
    expect(ordinalDay(1)).toBe('1st');
    expect(ordinalDay(2)).toBe('2nd');
    expect(ordinalDay(3)).toBe('3rd');
    expect(ordinalDay(4)).toBe('4th');
    expect(ordinalDay(10)).toBe('10th');
  });

  test('11, 12 and 13 are th, despite their last digit', () => {
    expect(ordinalDay(11)).toBe('11th');
    expect(ordinalDay(12)).toBe('12th');
    expect(ordinalDay(13)).toBe('13th');
  });

  test('the twenties and thirties follow the last digit again', () => {
    expect(ordinalDay(21)).toBe('21st');
    expect(ordinalDay(22)).toBe('22nd');
    expect(ordinalDay(23)).toBe('23rd');
    expect(ordinalDay(24)).toBe('24th');
    expect(ordinalDay(30)).toBe('30th');
    expect(ordinalDay(31)).toBe('31st');
  });
});

test.describe('formatClockDate', () => {
  test('weekday, month and ordinal day, in local time', () => {
    // Months are 0-based in the Date constructor: 9 is October.
    expect(formatClockDate(new Date(2026, 9, 19, 12, 0))).toBe('Monday, October 19th');
    expect(formatClockDate(new Date(2026, 0, 1, 0, 0))).toBe('Thursday, January 1st');
    expect(formatClockDate(new Date(2024, 1, 29, 23, 59))).toBe('Thursday, February 29th');
  });

  test('the longest weekday and month still read in full', () => {
    expect(formatClockDate(new Date(2026, 8, 23))).toBe('Wednesday, September 23rd');
  });

  test('a moment just before local midnight is still that day', () => {
    expect(formatClockDate(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe('Thursday, December 31st');
  });
});

test.describe('formatClockTime', () => {
  test('24-hour time with seconds, every part zero-padded', () => {
    expect(formatClockTime(new Date(2026, 9, 19, 9, 5))).toBe('09:05:00');
    expect(formatClockTime(new Date(2026, 9, 19, 21, 40))).toBe('21:40:00');
  });

  test('midnight is 00:00:00 and the last second is 23:59:59', () => {
    expect(formatClockTime(new Date(2026, 9, 19, 0, 0))).toBe('00:00:00');
    expect(formatClockTime(new Date(2026, 9, 19, 23, 59, 59))).toBe('23:59:59');
  });

  test('milliseconds never round the second up', () => {
    expect(formatClockTime(new Date(2026, 9, 19, 14, 7, 59, 999))).toBe('14:07:59');
  });
});

test.describe('msUntilNextSecond', () => {
  test('a whole second at the very start of one', () => {
    expect(msUntilNextSecond(new Date(2026, 9, 19, 14, 7, 30, 0))).toBe(1000);
  });

  test('one millisecond at the very end of one', () => {
    expect(msUntilNextSecond(new Date(2026, 9, 19, 14, 7, 30, 999))).toBe(1);
  });

  test('part way through, the rest of the second', () => {
    expect(msUntilNextSecond(new Date(2026, 9, 19, 14, 7, 30, 250))).toBe(750);
  });
});
