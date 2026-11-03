// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-contract';
import { AudioMonitor } from '../platform/AudioMonitor';
import { BluetoothMonitor } from '../platform/BluetoothMonitor';
import { WeatherMonitor } from '../platform/WeatherMonitor';
import { WifiMonitor } from '../platform/WifiMonitor';
import { isChromeSender } from './senderGuards';

/**
 * Sends a message to every window's chrome page.
 * @param channel The channel.
 * @param payload The message.
 */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

/**
 * Whether the computer has a battery. The page's battery API can't say: a
 * desktop with none and a laptop fully charged on its charger read exactly
 * the same (full, charging, never running down). So Windows is asked once,
 * through the CIM `Win32_Battery` class; elsewhere a battery is assumed and
 * the page's API decides.
 * @returns Whether there's a battery; `null` if Windows couldn't be asked.
 */
function findBattery(): Promise<boolean | null> {
  if (process.platform !== 'win32') {
    return Promise.resolve(true);
  }
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '@(Get-CimInstance -ClassName Win32_Battery).Count'],
      { windowsHide: true, timeout: 15_000 },
      (error, stdout) => {
        const count = Number.parseInt(stdout.trim(), 10);
        resolve(error || !Number.isFinite(count) ? null : count > 0);
      },
    );
  });
}

/**
 * Starts following the sound (the default playback device, its volume and
 * mute), the Wi-Fi connection, the connected Bluetooth devices and the outside
 * temperature, for the titlebar's status corner (`TitlebarClock`),
 * and answers the chrome's requests for their current state. One of each for
 * the whole app, pushed to every window. Only the chrome may ask: a tab's page
 * has no business knowing.
 *
 * Call this exactly once for the app's lifetime, same as `registerTabIpc`.
 */
export function registerStatusIpc(): void {
  const weather = new WeatherMonitor((state) => broadcast(IpcChannel.StatusWeatherChanged, state));
  const audio = new AudioMonitor((status) => broadcast(IpcChannel.StatusAudioChanged, status));
  const bluetooth = new BluetoothMonitor((status) => broadcast(IpcChannel.StatusBluetoothChanged, status));
  // The network the weather was last fetched over; joining another sends the weather to look again (see
  // `WeatherMonitor.networkChanged`). The first reading is the network the app started on, not a change.
  let network: string | null | undefined;
  const wifi = new WifiMonitor((status) => {
    broadcast(IpcChannel.StatusWifiChanged, status);
    const next = status.state === 'connected' ? (status.ssid ?? '') : null;
    if (network !== undefined && next !== null && next !== network) {
      weather.networkChanged();
    }
    network = next;
  });

  ipcMain.handle(IpcChannel.StatusWifiGet, (event) => (isChromeSender(event) ? wifi.current : null));
  ipcMain.handle(IpcChannel.StatusAudioGet, (event) => (isChromeSender(event) ? audio.current : null));
  ipcMain.handle(IpcChannel.StatusBluetoothGet, (event) => (isChromeSender(event) ? bluetooth.current : null));
  ipcMain.handle(IpcChannel.StatusWeatherGet, (event) => (isChromeSender(event) ? weather.current : null));
  const batteryPresent = findBattery();
  ipcMain.handle(IpcChannel.StatusBatteryPresentGet, (event) => (isChromeSender(event) ? batteryPresent : null));

  audio.start();
  wifi.start();
  bluetooth.start();
  weather.start();
  app.on('before-quit', () => {
    audio.stop();
    wifi.stop();
    bluetooth.stop();
    weather.stop();
  });
}
