// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { test, expect } from '@playwright/test';
import { parseWlanInterfaces, WifiMonitor } from '../../src/main/platform/WifiMonitor';
import { WeatherMonitor, type Fetcher } from '../../src/main/platform/WeatherMonitor';
import { wifiBars } from '../../src/renderer/hooks/useSystemStatus';
import { batteryLevel, isNoBattery } from '../../src/renderer/hooks/useBattery';

const CONNECTED = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    State                  : connected
    SSID                   : Home
    Signal                 : 86%
    Rssi                   : -53
`;

test.describe('parseWlanInterfaces', () => {
  test('reads the signal of a connected adapter', () => {
    expect(parseWlanInterfaces(CONNECTED)).toEqual({ state: 'connected', signal: 86 });
  });

  test('a disconnected adapter has no signal', () => {
    expect(parseWlanInterfaces('    Name : Wi-Fi\n    State : disconnected\n')).toEqual({ state: 'disconnected', signal: 0 });
  });

  test('no wireless adapter (or unreadable output) is unavailable', () => {
    expect(parseWlanInterfaces('There is no wireless interface on the system.')).toEqual({ state: 'unavailable', signal: 0 });
    expect(parseWlanInterfaces('')).toEqual({ state: 'unavailable', signal: 0 });
  });

  test('a garbled signal counts as 0, and one out of range is clamped', () => {
    expect(parseWlanInterfaces('State : connected\nSignal : n/a\n').signal).toBe(0);
    expect(parseWlanInterfaces('State : connected\nSignal : 140%\n').signal).toBe(100);
  });
});

test.describe('WifiMonitor', () => {
  test('reports only changes, and a failed read as unavailable', async () => {
    const outputs: (string | Error)[] = [CONNECTED, CONNECTED, 'State : disconnected', new Error('netsh failed')];
    const seen: string[] = [];
    const monitor = new WifiMonitor(
      (status) => seen.push(`${status.state}:${status.signal}`),
      async () => {
        const next = outputs.shift()!;
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
    );
    for (let i = 0; i < 4; i++) {
      await monitor.poll();
    }
    expect(seen).toEqual(['connected:86', 'disconnected:0', 'unavailable:0']);
  });
});

test.describe('wifiBars', () => {
  test('lights the arcs in thirds, at least one for any signal', () => {
    expect(wifiBars(0)).toBe(0);
    expect(wifiBars(1)).toBe(1);
    expect(wifiBars(33)).toBe(1);
    expect(wifiBars(34)).toBe(2);
    expect(wifiBars(66)).toBe(2);
    expect(wifiBars(67)).toBe(3);
    expect(wifiBars(100)).toBe(3);
  });
});

/** A fake network: answers each URL by its prefix, and records every URL asked for. */
function fakeNetwork(routes: Record<string, unknown>, requested: string[]): Fetcher {
  return async (url) => {
    requested.push(url);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    const body = key === undefined ? undefined : routes[key];
    return { ok: body !== undefined, json: async () => body };
  };
}

test.describe('WeatherMonitor', () => {
  test('finds the location by IP, then reports the temperature rounded to whole degrees Fahrenheit', async () => {
    const requested: string[] = [];
    const seen: (number | null)[] = [];
    const monitor = new WeatherMonitor(
      (state) => seen.push(state.temperatureF),
      fakeNetwork(
        {
          'https://ipapi.co/': { latitude: 40.42, longitude: -86.91 },
          'https://api.open-meteo.com/': { current: { temperature_2m: 71.6 } },
        },
        requested,
      ),
    );
    expect(await monitor.refresh()).toBe(true);
    expect(seen).toEqual([72]);
    expect(requested[1]).toContain('latitude=40.42&longitude=-86.91');
    expect(requested[1]).toContain('temperature_unit=fahrenheit');
  });

  test('looks the location up once an hour, not on every refresh', async () => {
    const requested: string[] = [];
    let now = 0;
    const monitor = new WeatherMonitor(
      () => {},
      fakeNetwork(
        {
          'https://ipapi.co/': { latitude: 1, longitude: 2 },
          'https://api.open-meteo.com/': { current: { temperature_2m: 50 } },
        },
        requested,
      ),
      () => now,
    );
    await monitor.refresh();
    now = 30 * 60 * 1000;
    await monitor.refresh();
    expect(requested.filter((url) => url.startsWith('https://ipapi.co/'))).toHaveLength(1);
    now = 61 * 60 * 1000;
    await monitor.refresh();
    expect(requested.filter((url) => url.startsWith('https://ipapi.co/'))).toHaveLength(2);
  });

  test('a failed fetch keeps the last temperature instead of blanking it', async () => {
    let weatherUp = true;
    const monitor = new WeatherMonitor(
      () => {},
      async (url) =>
        url.startsWith('https://ipapi.co/')
          ? { ok: true, json: async () => ({ latitude: 1, longitude: 2 }) }
          : { ok: weatherUp, json: async () => ({ current: { temperature_2m: 40.2 } }) },
    );
    await monitor.refresh();
    weatherUp = false;
    expect(await monitor.refresh()).toBe(false);
    expect(monitor.current.temperatureF).toBe(40);
  });

  test('falls back to the second location service when the first refuses (ipapi.co rate-limits)', async () => {
    const requested: string[] = [];
    const seen: (number | null)[] = [];
    const monitor = new WeatherMonitor(
      (state) => seen.push(state.temperatureF),
      async (url) => {
        requested.push(url);
        if (url.startsWith('https://ipapi.co/')) {
          return { ok: false, json: async () => ({ error: true, reason: 'RateLimited' }) };
        }
        if (url.startsWith('https://ipwho.is/')) {
          return { ok: true, json: async () => ({ latitude: 40.43, longitude: -86.91 }) };
        }
        return { ok: true, json: async () => ({ current: { temperature_2m: 64.5 } }) };
      },
    );
    expect(await monitor.refresh()).toBe(true);
    expect(seen).toEqual([65]);
    expect(requested.some((url) => url.includes('latitude=40.43&longitude=-86.91'))).toBe(true);
  });

  test('no location, or a malformed answer, fails without throwing', async () => {
    const offline = new WeatherMonitor(
      () => {},
      async () => {
        throw new Error('offline');
      },
    );
    expect(await offline.refresh()).toBe(false);
    expect(offline.current.temperatureF).toBeNull();

    const malformed = new WeatherMonitor(
      () => {},
      fakeNetwork({ 'https://ipapi.co/': { latitude: 'north' } }, []),
    );
    expect(await malformed.refresh()).toBe(false);
  });
});

test.describe('battery', () => {
  test('a desktop with no battery is recognized, so the icon hides', () => {
    expect(isNoBattery({ charging: true, level: 1, chargingTime: 0, dischargingTime: Infinity })).toBe(true);
    // A real battery that just finished charging is still a battery while it reports time left.
    expect(isNoBattery({ charging: false, level: 1, chargingTime: Infinity, dischargingTime: 18000 })).toBe(false);
    expect(isNoBattery({ charging: true, level: 0.5, chargingTime: 3600, dischargingTime: Infinity })).toBe(false);
  });

  test('colors the fill: charging always green, then red at 10% or less and orange at 30% or less', () => {
    expect(batteryLevel({ percent: 5, charging: true })).toBe('charging');
    expect(batteryLevel({ percent: 10, charging: false })).toBe('critical');
    expect(batteryLevel({ percent: 11, charging: false })).toBe('low');
    expect(batteryLevel({ percent: 30, charging: false })).toBe('low');
    expect(batteryLevel({ percent: 31, charging: false })).toBe('normal');
  });
});
