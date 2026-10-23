// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useState } from 'react';
import { BatteryIcon, WifiIcon } from '../icons';
import { batteryLevel, useBattery } from '../../hooks/useBattery';
import { useSystemStatus, wifiBars } from '../../hooks/useSystemStatus';
import { formatClockDate, formatClockTime, formatClockTimeZone, msUntilNextSecond } from '../../lib/clockFormat';

/**
 * The date and time in the window's top-right corner, where the window
 * controls are: the date ("Monday, October 19th") over the 24-hour time with seconds, in
 * the computer's own time zone. To its left, the Wi-Fi signal, the battery and
 * the outside temperature, since Northstar may cover the whole screen, taskbar included. Shown while the pointer is away from the tab
 * row; hovering the row swaps it for the window controls and the new-tab
 * button (see titlebar-clock.css and app.css's `.titlebar`).
 */
export function TitlebarClock() {
  const [now, setNow] = useState(() => new Date());
  const { wifi, weather } = useSystemStatus();
  const battery = useBattery();

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
    <div className="titlebar-clock">
      {wifi.state !== 'unavailable' && (
        <span
          className="titlebar-clock__wifi"
          role="img"
          aria-label={wifi.state === 'connected' ? `Wi-Fi connected, ${wifi.signal}% signal` : 'Wi-Fi disconnected'}
        >
          <WifiIcon bars={wifiBars(wifi.signal)} disconnected={wifi.state === 'disconnected'} size={18} />
        </span>
      )}
      {battery && (
        <span
          className="titlebar-clock__battery"
          data-level={batteryLevel(battery)}
          role="img"
          aria-label={`Battery ${battery.percent}%${battery.charging ? ', charging' : ''}`}
        >
          <BatteryIcon percent={battery.percent} charging={battery.charging} />
          <span aria-hidden="true">{battery.percent}%</span>
        </span>
      )}
      {weather.temperatureF !== null && (
        <span className="titlebar-clock__temperature" aria-label={`${weather.temperatureF} degrees Fahrenheit outside`}>
          {weather.temperatureF}°F
        </span>
      )}
      <time className="titlebar-clock__clock" dateTime={now.toISOString()}>
        <span className="titlebar-clock__date">{formatClockDate(now)}</span>
        <span className="titlebar-clock__time">
          {formatClockTime(now)}
          <span className="titlebar-clock__zone">{formatClockTimeZone(now)}</span>
        </span>
      </time>
    </div>
  );
}
