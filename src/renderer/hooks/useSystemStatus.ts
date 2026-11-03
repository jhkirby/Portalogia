// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useState } from 'react';
import type { AudioStatus, BluetoothStatus, WeatherState, WifiStatus } from '@shared/ipc-contract';

/** What the titlebar shows beside the clock. */
export interface SystemStatus {
  readonly audio: AudioStatus;
  readonly wifi: WifiStatus;
  readonly bluetooth: BluetoothStatus;
  readonly weather: WeatherState;
}

/**
 * The sound, the Wi-Fi connection, the connected Bluetooth devices and the
 * outside temperature, as main follows them (see `registerStatusIpc`): read once, then
 * kept current from main's pushes.
 * @returns The latest of each.
 */
export function useSystemStatus(): SystemStatus {
  const [audio, setAudio] = useState<AudioStatus>({ state: 'unavailable', device: null, volume: 0, muted: false });
  const [wifi, setWifi] = useState<WifiStatus>({ state: 'unavailable', signal: 0, ssid: null });
  const [bluetooth, setBluetooth] = useState<BluetoothStatus>({ state: 'unavailable', devices: 0, names: [] });
  const [weather, setWeather] = useState<WeatherState>({ temperatureF: null });

  useEffect(() => {
    let cancelled = false;
    void window.portalogia.getAudioStatus().then((status) => {
      if (!cancelled && status) {
        setAudio(status);
      }
    });
    void window.portalogia.getWifiStatus().then((status) => {
      if (!cancelled && status) {
        setWifi(status);
      }
    });
    void window.portalogia.getBluetoothStatus().then((status) => {
      if (!cancelled && status) {
        setBluetooth(status);
      }
    });
    void window.portalogia.getWeather().then((state) => {
      if (!cancelled && state) {
        setWeather(state);
      }
    });
    const stopAudio = window.portalogia.onAudioStatusChanged(setAudio);
    const stopWifi = window.portalogia.onWifiStatusChanged(setWifi);
    const stopBluetooth = window.portalogia.onBluetoothStatusChanged(setBluetooth);
    const stopWeather = window.portalogia.onWeatherChanged(setWeather);
    return () => {
      cancelled = true;
      stopAudio();
      stopWifi();
      stopBluetooth();
      stopWeather();
    };
  }, []);

  return { audio, wifi, bluetooth, weather };
}

/**
 * A playback device's name as the titlebar shows it: without its parenthesised parts, which Windows uses for the
 * driver behind it ("LG QHD (HD Audio Driver for Display Audio)" shows as "LG QHD"). A name that is nothing but
 * parentheses keeps them, rather than showing nothing.
 * @param name The name as Windows gives it.
 * @returns The name to show.
 */
export function displayDeviceName(name: string): string {
  // Innermost groups first, until none are left: "Speakers (Realtek(R) Audio)" loses its whole group.
  let shown = name;
  for (let previous = ''; previous !== shown; ) {
    previous = shown;
    shown = shown.replace(/\s*\([^()]*\)/g, '');
  }
  shown = shown.replace(/\s{2,}/g, ' ').trim();
  return shown || name;
}

/** The units the titlebar's temperature takes turns in, in order. */
export const TEMPERATURE_UNITS = ['F', 'C', 'K'] as const;

export type TemperatureUnit = (typeof TEMPERATURE_UNITS)[number];

/**
 * A temperature as the titlebar shows it, in whole degrees: "72°F", "22°C", or "295 K" (kelvin take no degree sign).
 * @param fahrenheit The temperature, in degrees Fahrenheit.
 * @param unit The unit to show it in.
 * @returns The text.
 */
export function formatTemperature(fahrenheit: number, unit: TemperatureUnit): string {
  const celsius = ((fahrenheit - 32) * 5) / 9;
  if (unit === 'C') {
    return `${Math.round(celsius)}°C`;
  }
  if (unit === 'K') {
    return `${Math.round(celsius + 273.15)} K`;
  }
  return `${Math.round(fahrenheit)}°F`;
}

/**
 * How many of the speaker icon's three waves a volume shows, in thirds as Windows' own icon does.
 * @param volume The volume, 0-100.
 * @returns 0-3; 0 only at no volume at all.
 */
export function speakerWaves(volume: number): number {
  if (volume <= 0) {
    return 0;
  }
  return volume >= 67 ? 3 : volume >= 34 ? 2 : 1;
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
