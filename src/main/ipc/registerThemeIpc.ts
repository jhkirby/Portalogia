// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-22

import { ipcMain, nativeTheme } from 'electron';
import { IpcChannel } from '@shared/ipc-contract';
import { themeSetRequestSchema } from '@shared/ipc-schemas';

/**
 * Mirrors the renderer's `useTheme` state onto Electron's own
 * `nativeTheme.themeSource` — a fire-and-forget `ipcMain.on` channel, same
 * as `terminal:input`, since there's nothing meaningful to reply with.
 * `nativeTheme` is process-wide, so this in turn drives
 * `prefers-color-scheme` for any native-rendered content that follows it,
 * like the `northstar://home` page (see homePage.ts) — without this, that
 * page would keep following the OS's own preference regardless of what
 * the chrome's toggle button or Ctrl+D chose.
 *
 * Call this exactly once for the app's lifetime, same as `registerTabIpc`.
 */
export function registerThemeIpc(): void {
  ipcMain.on(IpcChannel.ThemeSet, (_event, rawRequest: unknown) => {
    const parsed = themeSetRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      nativeTheme.themeSource = parsed.data.theme;
    }
  });
}
