// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import { useEffect, useState } from 'react';
import { formatClockDate, formatClockTime, msUntilNextSecond } from '../../lib/clockFormat';

/**
 * The date and time in the window's top-right corner, where the window
 * controls are: the date ("Monday, October 19th") over the 24-hour time with seconds, in
 * the computer's own time zone. Shown while the pointer is away from the tab
 * row; hovering the row swaps it for the window controls and the new-tab
 * button (see titlebar-clock.css and app.css's `.titlebar`).
 */
export function TitlebarClock() {
  const [now, setNow] = useState(() => new Date());

  // Wakes at the start of each second, when the shown time changes, rather than polling. A computer back from sleep
  // fires the waiting timer late, and the window regaining focus catches up at once.
  useEffect(() => {
    let timer = 0;
    const tick = (): void => {
      const current = new Date();
      setNow(current);
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, msUntilNextSecond(current));
    };
    tick();
    window.addEventListener('focus', tick);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);

  return (
    <time className="titlebar-clock" dateTime={now.toISOString()}>
      <span className="titlebar-clock__date">{formatClockDate(now)}</span>
      <span className="titlebar-clock__time">{formatClockTime(now)}</span>
    </time>
  );
}
