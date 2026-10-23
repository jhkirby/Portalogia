// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useState } from 'react';
import type { WeatherState, WifiStatus } from '@shared/ipc-contract';

/** What the titlebar shows beside the clock. */
export interface SystemStatus {
  readonly wifi: WifiStatus;
  readonly weather: WeatherState;
}

/**
 * The Wi-Fi connection and outside temperature, as main follows them (see
 * `registerStatusIpc`): read once, then kept current from main's pushes.
 * @returns The latest of each.
 */
export function useSystemStatus(): SystemStatus {
  const [wifi, setWifi] = useState<WifiStatus>({ state: 'unavailable', signal: 0 });
  const [weather, setWeather] = useState<WeatherState>({ temperatureF: null });

  useEffect(() => {
    let cancelled = false;
    void window.northstar.getWifiStatus().then((status) => {
      if (!cancelled && status) {
        setWifi(status);
      }
    });
    void window.northstar.getWeather().then((state) => {
      if (!cancelled && state) {
        setWeather(state);
      }
    });
    const stopWifi = window.northstar.onWifiStatusChanged(setWifi);
    const stopWeather = window.northstar.onWeatherChanged(setWeather);
    return () => {
      cancelled = true;
      stopWifi();
      stopWeather();
    };
  }, []);

  return { wifi, weather };
}

/**
 * How many of the Wi-Fi icon's three arcs a signal lights, in thirds as Windows' own icon does.
 * @param signal Signal quality, 0-100.
 * @returns 0-3; at least 1 for any signal at all.
 */
export function wifiBars(signal: number): number {
  if (signal <= 0) {
    return 0;
  }
  return signal >= 67 ? 3 : signal >= 34 ? 2 : 1;
}
