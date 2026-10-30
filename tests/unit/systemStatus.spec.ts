// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { test, expect } from '@playwright/test';
import { parseWlanInterfaces, WifiMonitor } from '../../src/main/platform/WifiMonitor';
import { BluetoothMonitor, parsePnputilBluetooth } from '../../src/main/platform/BluetoothMonitor';
import { WeatherMonitor, type Fetcher } from '../../src/main/platform/WeatherMonitor';
import { wifiBars } from '../../src/renderer/hooks/useSystemStatus';
import { batteryLevel, estimateSecondsToFull, formatBatteryTimeLeft, isNoBattery } from '../../src/renderer/hooks/useBattery';

const CONNECTED = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    State                  : connected
    SSID                   : Home
    Signal                 : 86%
    Rssi                   : -53
`;

test.describe('parseWlanInterfaces', () => {
  test('reads the signal and network name of a connected adapter', () => {
    expect(parseWlanInterfaces(CONNECTED)).toEqual({ state: 'connected', signal: 86, ssid: 'Home' });
  });

  test('the network name comes from SSID, not the access point BSSID listed under it', () => {
    const output = '    State : connected\n    AP BSSID : 48:00:b3:d3:9a:0d\n    SSID : Café 5G\n    Signal : 50%\n';
    expect(parseWlanInterfaces(output).ssid).toBe('Café 5G');
  });

  test('a hidden network has no name', () => {
    expect(parseWlanInterfaces('State : connected\nSSID : \nSignal : 40%\n').ssid).toBeNull();
  });

  test('a disconnected adapter has no signal', () => {
    expect(parseWlanInterfaces('    Name : Wi-Fi\n    State : disconnected\n')).toEqual({
      state: 'disconnected',
      signal: 0,
      ssid: null,
    });
  });

  test('no wireless adapter (or unreadable output) is unavailable', () => {
    const unavailable = { state: 'unavailable', signal: 0, ssid: null };
    expect(parseWlanInterfaces('There is no wireless interface on the system.')).toEqual(unavailable);
    expect(parseWlanInterfaces('')).toEqual(unavailable);
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

  test('moving to another network is a change, even at the same signal', async () => {
    const outputs = [CONNECTED, CONNECTED.replace('Home', 'Office')];
    const seen: (string | null)[] = [];
    const monitor = new WifiMonitor(
      (status) => seen.push(status.ssid),
      async () => outputs.shift()!,
    );
    await monitor.poll();
    await monitor.poll();
    expect(seen).toEqual(['Home', 'Office']);
  });
});

/**
 * One device's block as `pnputil /enum-devices /class Bluetooth /connected /properties` prints it, trimmed to the
 * lines the parser reads.
 */
function pnputilBlock(instanceId: string, name: string, connected: boolean, container = `{${name}}`): string {
  return [
    `Instance ID:                ${instanceId}`,
    `Device Description:         ${name}`,
    'Class Name:                 Bluetooth',
    'Properties:',
    '    DEVPKEY_Device_FriendlyName [String]:',
    `        ${name}`,
    '    DEVPKEY_Device_ContainerId [GUID]:',
    `        ${container}`,
    '    {83da6326-97a6-4088-9453-a1923f573b29}[15] [Boolean]:',
    `        ${connected ? 'TRUE' : 'FALSE'}`,
  ].join('\r\n');
}

/** `pnputil`'s output: its banner, then each block, separated by blank lines. */
function pnputilOutput(...blocks: string[]): string {
  return ['Microsoft PnP Utility', ...blocks].join('\r\n\r\n') + '\r\n';
}

const ADAPTER = pnputilBlock('BTH\\MS_BTHBRB\\6&11a10473&0&1', 'Microsoft Bluetooth Enumerator', false);

test.describe('parsePnputilBluetooth', () => {
  test('counts the paired devices that are connected', () => {
    const output = pnputilOutput(
      ADAPTER,
      pnputilBlock('BTHENUM\\Dev_8099E750CC65\\7&38d62c91&1&BluetoothDevice_8099E750CC65', 'WH-1000XM5', true),
      pnputilBlock('BTHENUM\\Dev_7415F5121579\\7&38d62c91&1&BluetoothDevice_7415F5121579', 'AirPods Pro', true),
      pnputilBlock('BTHENUM\\Dev_44A10E2CF0BF\\7&38d62c91&1&BluetoothDevice_44A10E2CF0BF', 'Phone', false),
    );
    expect(parsePnputilBluetooth(output)).toEqual({ state: 'on', devices: 2, names: ['AirPods Pro', 'WH-1000XM5'] });
  });

  test('a device connected over both Classic and LE counts once', () => {
    const output = pnputilOutput(
      ADAPTER,
      pnputilBlock('BTHENUM\\Dev_44A10E2CF0BF\\7&38d62c91&1&BluetoothDevice_44A10E2CF0BF', 'Phone', true, '{a}'),
      pnputilBlock('BTHLE\\Dev_4c0f60f12c59\\7&2b0ebec2&1&4c0f60f12c59', 'Phone', true, '{b}'),
    );
    expect(parsePnputilBluetooth(output)).toEqual({ state: 'on', devices: 1, names: ['Phone'] });
  });

  test("a device's services and the adapter itself aren't counted, even when marked connected", () => {
    const output = pnputilOutput(
      pnputilBlock('BTH\\MS_BTHBRB\\6&11a10473&0&1', 'Microsoft Bluetooth Enumerator', true),
      pnputilBlock(
        'BTHENUM\\{0000110c-0000-1000-8000-00805f9b34fb}_VID&0002054c_PID&0df0\\7&38d62c91&1&8099E750CC65_C00000000',
        'WH-1000XM5 Avrcp Transport',
        true,
      ),
    );
    expect(parsePnputilBluetooth(output)).toEqual({ state: 'on', devices: 0, names: [] });
  });

  test('on, with paired devices but none connected, counts none', () => {
    const output = pnputilOutput(
      ADAPTER,
      pnputilBlock('BTHENUM\\Dev_8099E750CC65\\7&38d62c91&1&BluetoothDevice_8099E750CC65', 'WH-1000XM5', false),
    );
    expect(parsePnputilBluetooth(output)).toEqual({ state: 'on', devices: 0, names: [] });
  });

  test("the radio turned off leaves only the adapter's own node, and reads as off", () => {
    const output = pnputilOutput(pnputilBlock('USB\\VID_8087&PID_0033\\5&2cb48be1&0&10', 'Intel(R) Wireless Bluetooth(R)', false));
    expect(parsePnputilBluetooth(output)).toEqual({ state: 'off', devices: 0, names: [] });
  });

  test('no Bluetooth devices at all (no adapter) is unavailable', () => {
    expect(parsePnputilBluetooth('Microsoft PnP Utility\r\n\r\nNo devices were found on the system.\r\n')).toEqual({
      state: 'unavailable',
      devices: 0,
      names: [],
    });
    expect(parsePnputilBluetooth('')).toEqual({ state: 'unavailable', devices: 0, names: [] });
  });
});

test.describe('BluetoothMonitor', () => {
  test('reports only changes, and a failed read as unavailable', async () => {
    const one = pnputilOutput(
      ADAPTER,
      pnputilBlock('BTHENUM\\Dev_8099E750CC65\\7&38d62c91&1&BluetoothDevice_8099E750CC65', 'WH-1000XM5', true),
    );
    const outputs: (string | Error)[] = [one, one, pnputilOutput(ADAPTER), new Error('pnputil failed')];
    const seen: string[] = [];
    const monitor = new BluetoothMonitor(
      (status) => seen.push(`${status.state}:${status.devices}`),
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
    expect(seen).toEqual(['on:1', 'on:0', 'unavailable:0']);
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

  test('joining another network looks the location up again, however fresh it was', async () => {
    const requested: string[] = [];
    const monitor = new WeatherMonitor(
      () => {},
      fakeNetwork(
        {
          'https://ipapi.co/': { latitude: 1, longitude: 2 },
          'https://api.open-meteo.com/': { current: { temperature_2m: 50 } },
        },
        requested,
      ),
      () => 0,
    );
    await monitor.refresh();
    monitor.networkChanged();
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

  test('time left shows whole hours from an hour up, whole minutes below, and nothing without an estimate', () => {
    expect(formatBatteryTimeLeft(null)).toBeNull();
    expect(formatBatteryTimeLeft(Infinity)).toBeNull();
    expect(formatBatteryTimeLeft(3 * 3600 + 59 * 60)).toBe('3 h');
    expect(formatBatteryTimeLeft(3600)).toBe('1 h');
    expect(formatBatteryTimeLeft(3599)).toBe('59 m');
    expect(formatBatteryTimeLeft(42 * 60 + 30)).toBe('42 m');
    expect(formatBatteryTimeLeft(20)).toBe('1 m');
  });

  test('time to full comes from the charge rate since the run first changed', () => {
    // 50% to 60% in 10 minutes: 1% a minute, so 40 minutes left to 100%.
    const since = { at: 0, level: 0.5 };
    expect(estimateSecondsToFull(since, { at: 10 * 60_000, level: 0.6 })).toBeCloseTo(40 * 60);
    // No rate yet: nothing to go on, or the charge hasn't risen since.
    expect(estimateSecondsToFull(null, { at: 60_000, level: 0.6 })).toBeNull();
    expect(estimateSecondsToFull(since, { at: 60_000, level: 0.5 })).toBeNull();
  });
});
