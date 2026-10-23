// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A day of the month with its English ordinal suffix.
 * @param day The day of the month, 1–31.
 * @returns The day and suffix, e.g. `'1st'`, `'12th'`, `'23rd'`.
 */
export function ordinalDay(day: number): string {
  // 11th, 12th and 13th break the 1st/2nd/3rd rule their last digit would suggest.
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${day}th`;
  }
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * The clock's date line, in the computer's own time zone.
 * @param date The moment to show.
 * @returns The weekday, month and ordinal day, e.g. `'Monday, October 19th'`.
 */
export function formatClockDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${ordinalDay(date.getDate())}`;
}

/**
 * The clock's time line: 24-hour (military) time in the computer's own time zone.
 * @param date The moment to show.
 * @returns Hours, minutes and seconds, each zero-padded, e.g. `'09:05:07'` or `'21:40:59'`.
 */
export function formatClockTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * How long until the shown time next changes, so the clock wakes exactly then
 * rather than polling.
 * @param date The moment now.
 * @returns Milliseconds until the start of the next second, from 1 to 1000.
 */
export function msUntilNextSecond(date: Date): number {
  return 1000 - date.getMilliseconds();
}
