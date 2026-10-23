// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { app, BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-contract';
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
 * Starts following the Wi-Fi connection and the outside temperature, for the
 * titlebar's status corner (`TitlebarClock`), and answers the chrome's
 * requests for their current state. One of each for the whole app, pushed to
 * every window. Only the chrome may ask: a tab's page has no business knowing.
 *
 * Call this exactly once for the app's lifetime, same as `registerTabIpc`.
 */
export function registerStatusIpc(): void {
  const wifi = new WifiMonitor((status) => broadcast(IpcChannel.StatusWifiChanged, status));
  const weather = new WeatherMonitor((state) => broadcast(IpcChannel.StatusWeatherChanged, state));

  ipcMain.handle(IpcChannel.StatusWifiGet, (event) => (isChromeSender(event) ? wifi.current : null));
  ipcMain.handle(IpcChannel.StatusWeatherGet, (event) => (isChromeSender(event) ? weather.current : null));

  wifi.start();
  weather.start();
  app.on('before-quit', () => {
    wifi.stop();
    weather.stop();
  });
}
