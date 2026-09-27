// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { ipcMain } from 'electron';
import { rgbSchema } from '@shared/ipc-schemas';
import { IpcChannel } from '@shared/ipc-contract';
import type { RGB } from '@shared/color';
import { setPageSelectionAccent } from '../browser/pageSelectionAccent';

/**
 * Mirrors the renderer's `useAccentColor` state into
 * `pageSelectionAccent`'s own module-level store — a fire-and-forget
 * `ipcMain.on` channel, same shape as `registerThemeIpc` (and for the
 * same reason: nothing here is scoped to *which* window sent it, since
 * every window already shows the same accent — see `useAccentColor`'s
 * own cross-window sync — so there's nothing to resolve a specific
 * `TabManager` for, unlike `registerTabIpc`'s channels).
 *
 * Call this exactly once for the app's lifetime, same as `registerTabIpc`.
 * @param onAccentChanged Called with the new color after it's accepted —
 *   `main/index.ts` uses this to also fan it out through
 *   `HighlighterController.broadcastColor`, so every already-highlighted
 *   tab repaints immediately rather than only a future one picking it up.
 */
export function registerAccentColorIpc(onAccentChanged: (rgb: RGB) => void): void {
  ipcMain.on(IpcChannel.AccentColorSet, (_event, rawRequest: unknown) => {
    const parsed = rgbSchema.safeParse(rawRequest);
    if (parsed.success) {
      setPageSelectionAccent(parsed.data);
      onAccentChanged(parsed.data);
    }
  });
}
