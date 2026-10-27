// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useState } from 'react';
import type { BluetoothStatus, WeatherState, WifiStatus } from '@shared/ipc-contract';

/** What the titlebar shows beside the clock. */
export interface SystemStatus {
  readonly wifi: WifiStatus;
  readonly bluetooth: BluetoothStatus;
  readonly weather: WeatherState;
}

/**
 * The Wi-Fi connection, the connected Bluetooth devices and the outside
 * temperature, as main follows them (see `registerStatusIpc`): read once, then
 * kept current from main's pushes.
 * @returns The latest of each.
 */
export function useSystemStatus(): SystemStatus {
  const [wifi, setWifi] = useState<WifiStatus>({ state: 'unavailable', signal: 0, ssid: null });
  const [bluetooth, setBluetooth] = useState<BluetoothStatus>({ state: 'unavailable', devices: 0 });
  const [weather, setWeather] = useState<WeatherState>({ temperatureF: null });

  useEffect(() => {
    let cancelled = false;
    void window.northstar.getWifiStatus().then((status) => {
      if (!cancelled && status) {
        setWifi(status);
      }
    });
    void window.northstar.getBluetoothStatus().then((status) => {
      if (!cancelled && status) {
        setBluetooth(status);
      }
    });
    void window.northstar.getWeather().then((state) => {
      if (!cancelled && state) {
        setWeather(state);
      }
    });
    const stopWifi = window.northstar.onWifiStatusChanged(setWifi);
    const stopBluetooth = window.northstar.onBluetoothStatusChanged(setBluetooth);
    const stopWeather = window.northstar.onWeatherChanged(setWeather);
    return () => {
      cancelled = true;
      stopWifi();
      stopBluetooth();
      stopWeather();
    };
  }, []);

  return { wifi, bluetooth, weather };
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
