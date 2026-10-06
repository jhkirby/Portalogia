// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-contract';
import { adBlockSetEnabledRequestSchema, adBlockSetSiteAllowedRequestSchema } from '@shared/ipc-schemas';
import type { AdBlocker } from '../adblock/AdBlocker';

/**
 * Wires the chrome's ad blocker controls to the one app-wide `AdBlocker`.
 * Call this exactly once for the app's lifetime, same as `registerThemeIpc`.
 * @param adBlocker The blocker to read and change.
 */
export function registerAdBlockIpc(adBlocker: AdBlocker): void {
  ipcMain.handle(IpcChannel.AdBlockGetState, () => adBlocker.getState());
  ipcMain.on(IpcChannel.AdBlockSetEnabled, (_event, raw: unknown) => {
    const parsed = adBlockSetEnabledRequestSchema.safeParse(raw);
    if (parsed.success) {
      adBlocker.setEnabled(parsed.data.enabled);
    }
  });
  ipcMain.on(IpcChannel.AdBlockSetSiteAllowed, (_event, raw: unknown) => {
    const parsed = adBlockSetSiteAllowedRequestSchema.safeParse(raw);
    if (parsed.success) {
      adBlocker.setSiteAllowed(parsed.data.host, parsed.data.allowed);
    }
  });
}
