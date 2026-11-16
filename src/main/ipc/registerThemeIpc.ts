// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { IpcChannel } from '@shared/ipc-contract';
import { themeSetRequestSchema } from '@shared/ipc-schemas';
import { ThemeCrossfade } from '../windows/ThemeCrossfade';
import { isChromeSender } from './senderGuards';

/**
 * Mirrors the renderer's `useTheme` state onto Electron's own
 * `nativeTheme.themeSource` — a fire-and-forget `ipcMain.on` channel, same
 * as `terminal:input`, since there's nothing meaningful to reply with.
 * `nativeTheme` is process-wide, so this in turn drives
 * `prefers-color-scheme` for any native-rendered content that follows it,
 * like the `portalogia://home` page (see homePage.ts) — without this, that
 * page would keep following the OS's own preference regardless of what
 * the chrome's toggle button or Ctrl+D chose.
 *
 * A chrome about to switch theme asks first (`ThemePrepareFade`) for a
 * snapshot of its window to be laid over it; the theme then changes under the
 * snapshot, which fades away (`ThemeCrossfade`).
 *
 * Call this exactly once for the app's lifetime, same as `registerTabIpc`.
 */
export function registerThemeIpc(): void {
  const crossfade = new ThemeCrossfade();
  ipcMain.on(IpcChannel.ThemeSet, (event, rawRequest: unknown) => {
    const parsed = themeSetRequestSchema.safeParse(rawRequest);
    if (parsed.success && isChromeSender(event)) {
      nativeTheme.themeSource = parsed.data.theme;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        crossfade.themeChanged(window);
      }
    }
  });
  ipcMain.handle(IpcChannel.ThemePrepareFade, async (event): Promise<null> => {
    const window = isChromeSender(event) ? BrowserWindow.fromWebContents(event.sender) : null;
    if (window) {
      await crossfade.prepare(window);
    }
    return null;
  });
}
