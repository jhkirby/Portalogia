// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { z } from 'zod';

// Every ipcMain.handle validates its payload against one of these before
// acting on it — the renderer is untrusted, even though it's our own code.
//
// Split out of ipc-contract.ts: this is the only file in `@shared` that
// pulls in `zod`, and it's imported by main only. Preload also imports
// from ipc-contract.ts, but runs inside Electron's sandbox, where a
// require() of an arbitrary node_modules package (zod included) fails —
// keeping the dependency out of ipc-contract.ts keeps it out of preload's
// bundle.

export const createTabRequestSchema = z.object({
  url: z.string().min(1).optional(),
});
export type CreateTabRequest = z.infer<typeof createTabRequestSchema>;

export const tabIdRequestSchema = z.object({
  id: z.string().min(1),
});
export type TabIdRequest = z.infer<typeof tabIdRequestSchema>;

export const moveTabRequestSchema = z.object({
  id: z.string().min(1),
  beforeId: z.string().min(1).nullable(),
});
export type MoveTabRequest = z.infer<typeof moveTabRequestSchema>;

export const moveTabToWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
});
export type MoveTabToWorkspaceRequest = z.infer<typeof moveTabToWorkspaceRequestSchema>;

export const tearOffTabRequestSchema = z.object({
  id: z.string().min(1),
  screenX: z.number(),
  screenY: z.number(),
});
export type TearOffTabRequest = z.infer<typeof tearOffTabRequestSchema>;

export const navigateRequestSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
});
export type NavigateRequest = z.infer<typeof navigateRequestSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const workspaceIdRequestSchema = z.object({
  id: z.string().min(1),
});
export type WorkspaceIdRequest = z.infer<typeof workspaceIdRequestSchema>;

export const createWorkspaceWithTabRequestSchema = z.object({
  tabId: z.string().min(1),
});
export type CreateWorkspaceWithTabRequest = z.infer<typeof createWorkspaceWithTabRequestSchema>;

export const renameWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type RenameWorkspaceRequest = z.infer<typeof renameWorkspaceRequestSchema>;

export const addBookmarkRequestSchema = z.object({
  title: z.string(),
  url: z.string().min(1),
});
export type AddBookmarkRequest = z.infer<typeof addBookmarkRequestSchema>;

export const bookmarkIdRequestSchema = z.object({
  id: z.string().min(1),
});
export type BookmarkIdRequest = z.infer<typeof bookmarkIdRequestSchema>;

export const splitEnterRequestSchema = z.object({
  secondaryId: z.string().min(1),
});
export type SplitEnterRequest = z.infer<typeof splitEnterRequestSchema>;

export const focusModeRequestSchema = z.object({
  enabled: z.boolean(),
});
export type FocusModeRequest = z.infer<typeof focusModeRequestSchema>;

// Deliberately not `.min(25).max(200)` here — `TabManager.setZoom` clamps
// to that range itself, the same as `zoomIn`/`zoomOut` clamp their own
// step, so an out-of-range value here isn't a malformed request, just one
// that lands on a clamped result instead of a rejection.
export const zoomSetRequestSchema = z.object({
  percent: z.number(),
});
export type ZoomSetRequest = z.infer<typeof zoomSetRequestSchema>;

export const terminalInputRequestSchema = z.object({
  id: z.string().min(1),
  data: z.string(),
});
export type TerminalInputRequest = z.infer<typeof terminalInputRequestSchema>;

export const terminalResizeRequestSchema = z.object({
  id: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;

export const addressSuggestionsSyncRequestSchema = z.object({
  open: z.boolean(),
  rect: z
    .object({
      top: z.number(),
      left: z.number(),
      width: z.number(),
    })
    .nullable(),
  suggestions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
    }),
  ),
  selectedIndex: z.number().int().nonnegative(),
});
export type AddressSuggestionsSyncRequest = z.infer<typeof addressSuggestionsSyncRequestSchema>;

export const addressSuggestionSelectRequestSchema = z.number().int().nonnegative();

export const tooltipSyncRequestSchema = z.object({
  visible: z.boolean(),
  text: z.string(),
  rect: z
    .object({
      top: z.number(),
      left: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable(),
});
export type TooltipSyncRequest = z.infer<typeof tooltipSyncRequestSchema>;

export const themeSetRequestSchema = z.object({
  theme: z.enum(['light', 'dark']),
});
export type ThemeSetRequest = z.infer<typeof themeSetRequestSchema>;
