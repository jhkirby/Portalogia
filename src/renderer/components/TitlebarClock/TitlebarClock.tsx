// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { Fragment, useEffect, useState } from 'react';
import { BatteryIcon, BluetoothIcon, SpeakerIcon, WifiIcon } from '../icons';
import { batteryLevel, formatBatteryTimeLeft, useBattery } from '../../hooks/useBattery';
import { displayDeviceName, speakerWaves, useSystemStatus, wifiBars } from '../../hooks/useSystemStatus';
import { formatClockDate, formatClockTime, formatClockTimeZone, msUntilNextSecond } from '../../lib/clockFormat';

/**
 * The date and time in the window's top-right corner, where the window
 * controls are: the date ("Monday, October 19th") over the 24-hour time with seconds, in
 * the computer's own time zone. To its left, in sections split by thin rules: the sound (the playback device and its
 * volume), then Bluetooth and the Wi-Fi network, then
 * the battery, then the outside temperature beside the clock, since Northstar may cover the whole screen, taskbar
 * included. Shown while the pointer is away from the tab
 * row; hovering the row swaps it for the window controls and the new-tab
 * button (see titlebar-clock.css and app.css's `.titlebar`).
 */
export function TitlebarClock() {
  const [now, setNow] = useState(() => new Date());
  const { audio, wifi, bluetooth, weather } = useSystemStatus();
  const battery = useBattery();
  const batteryTimeLeft = battery ? formatBatteryTimeLeft(battery.secondsLeft) : null;

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

  // The speaker (its waves the volume, struck through when muted), the device's name, and the volume unless muted.
  const sound = audio.state === 'on' && (
    <span
      className="titlebar-clock__audio"
      role="img"
      aria-label={`${audio.device ?? 'Sound'}: ${audio.muted ? 'muted' : `volume ${audio.volume}%`}`}
    >
      <SpeakerIcon waves={speakerWaves(audio.volume)} muted={audio.muted} size={18} />
      {audio.device && (
        <span className="titlebar-clock__audio-device" aria-hidden="true">
          {displayDeviceName(audio.device)}
        </span>
      )}
      {!audio.muted && <span aria-hidden="true">{audio.volume}%</span>}
    </span>
  );

  const connectivity = (bluetooth.state !== 'unavailable' || wifi.state !== 'unavailable') && (
    <>
      {bluetooth.state !== 'unavailable' && (
        <span
          className="titlebar-clock__bluetooth"
          role="img"
          aria-label={
            bluetooth.state === 'off'
              ? 'Bluetooth off'
              : bluetooth.devices > 0
                ? `Bluetooth on, ${bluetooth.devices} ${bluetooth.devices === 1 ? 'device' : 'devices'} connected`
                : 'Bluetooth on, no devices connected'
          }
        >
          <BluetoothIcon off={bluetooth.state === 'off'} size={18} />
          {bluetooth.devices > 0 && <span aria-hidden="true">({bluetooth.devices})</span>}
        </span>
      )}
      {wifi.state !== 'unavailable' && (
        <span
          className="titlebar-clock__wifi"
          role="img"
          aria-label={
            wifi.state === 'connected'
              ? `Wi-Fi connected${wifi.ssid ? ` to ${wifi.ssid}` : ''}, ${wifi.signal}% signal`
              : 'Wi-Fi disconnected'
          }
        >
          <WifiIcon bars={wifiBars(wifi.signal)} disconnected={wifi.state === 'disconnected'} size={18} />
          {wifi.ssid && (
            <span className="titlebar-clock__network" aria-hidden="true">
              {wifi.ssid}
            </span>
          )}
        </span>
      )}
    </>
  );

  const charge = battery && (
    <span
      className="titlebar-clock__battery"
      data-level={batteryLevel(battery)}
      role="img"
      aria-label={`Battery ${battery.percent}%${battery.charging ? ', charging' : ''}${
        batteryTimeLeft ? `, about ${batteryTimeLeft} ${battery.charging ? 'to full' : 'left'}` : ''
      }`}
    >
      <BatteryIcon percent={battery.percent} charging={battery.charging} />
      <span aria-hidden="true">{battery.percent}%</span>
      {batteryTimeLeft && (
        <span className="titlebar-clock__battery-time" aria-hidden="true">
          {batteryTimeLeft}
        </span>
      )}
    </span>
  );

  const timeAndWeather = (
    <>
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
    </>
  );

  // A rule only between sections that are showing, so a desktop without a battery doesn't get two in a row.
  const sections = [sound, connectivity, charge, timeAndWeather].filter(Boolean);

  return (
    <div className="titlebar-clock">
      {sections.map((section, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="titlebar-clock__divider" aria-hidden="true" />}
          {section}
        </Fragment>
      ))}
    </div>
  );
}
