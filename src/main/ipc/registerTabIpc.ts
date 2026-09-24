// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { ipcMain } from 'electron';
import type { ZodType } from 'zod';
import { IpcChannel, type ExportPdfResult, type IpcResult } from '@shared/ipc-contract';
import {
  addBookmarkRequestSchema,
  addressSuggestionsSyncRequestSchema,
  bookmarkIdRequestSchema,
  createTabRequestSchema,
  createWorkspaceRequestSchema,
  createWorkspaceWithTabRequestSchema,
  focusModeRequestSchema,
  moveTabRequestSchema,
  moveTabToWorkspaceRequestSchema,
  navigateRequestSchema,
  renameWorkspaceRequestSchema,
  splitEnterRequestSchema,
  tabIdRequestSchema,
  terminalInputRequestSchema,
  terminalResizeRequestSchema,
  workspaceIdRequestSchema,
} from '@shared/ipc-schemas';
import type { BrowserState } from '@shared/tab-state';
import type { TabManager } from '../browser/TabManager';

/**
 * Registers every `ipcMain.handle` channel, each validating its payload
 * against the shared zod schema before touching `TabManager` and
 * normalizing any thrown error into an `IpcResult` — the renderer never
 * sees a raw main-process exception.
 *
 * Call this exactly once for the app's lifetime — `ipcMain.handle` allows
 * only one handler per channel, so a second window must not re-register.
 * `getTabManager` is resolved on every call rather than captured once, so
 * it can point at whichever window's `TabManager` is currently active.
 * @param getTabManager Resolves the `TabManager` a request should act on.
 */
export function registerTabIpc(getTabManager: () => TabManager): void {
  handle(IpcChannel.TabsCreate, createTabRequestSchema, (request) =>
    getTabManager().createTabAndFocusAddressBar(request.url),
  );
  handle(IpcChannel.TabsClose, tabIdRequestSchema, (request) =>
    getTabManager().closeTab(request.id),
  );
  handle(IpcChannel.TabsActivate, tabIdRequestSchema, (request) =>
    getTabManager().activateTab(request.id),
  );
  handle(IpcChannel.TabsMove, moveTabRequestSchema, (request) =>
    getTabManager().moveTab(request.id, request.beforeId),
  );
  handle(IpcChannel.TabsMoveToWorkspace, moveTabToWorkspaceRequestSchema, (request) =>
    getTabManager().moveTabToWorkspace(request.id, request.workspaceId),
  );
  handle(IpcChannel.TabsNavigate, navigateRequestSchema, (request) =>
    getTabManager().navigate(request.id, request.url),
  );
  handle(IpcChannel.TabsGoBack, tabIdRequestSchema, (request) =>
    getTabManager().goBack(request.id),
  );
  handle(IpcChannel.TabsGoForward, tabIdRequestSchema, (request) =>
    getTabManager().goForward(request.id),
  );
  handle(IpcChannel.TabsReload, tabIdRequestSchema, (request) =>
    getTabManager().reload(request.id),
  );
  handle(IpcChannel.TabsStop, tabIdRequestSchema, (request) => getTabManager().stop(request.id));

  handle(IpcChannel.WorkspacesCreate, createWorkspaceRequestSchema, (request) =>
    getTabManager().createWorkspace(request.name),
  );
  handle(IpcChannel.WorkspacesCreateWithTab, createWorkspaceWithTabRequestSchema, (request) =>
    getTabManager().createWorkspaceWithTab(request.tabId),
  );
  handle(IpcChannel.WorkspacesSwitch, workspaceIdRequestSchema, (request) =>
    getTabManager().switchWorkspace(request.id),
  );
  handle(IpcChannel.WorkspacesRename, renameWorkspaceRequestSchema, (request) =>
    getTabManager().renameWorkspace(request.id, request.name),
  );
  handle(IpcChannel.WorkspacesRemove, workspaceIdRequestSchema, (request) =>
    getTabManager().removeWorkspace(request.id),
  );

  handle(IpcChannel.BookmarksAdd, addBookmarkRequestSchema, (request) =>
    getTabManager().addBookmark(request.title, request.url),
  );
  handle(IpcChannel.BookmarksRemove, bookmarkIdRequestSchema, (request) =>
    getTabManager().removeBookmark(request.id),
  );

  ipcMain.handle(
    IpcChannel.TabsBeginTabPreview,
    async (_event, rawRequest: unknown): Promise<IpcResult<string | null>> => {
      const parsed = tabIdRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-request', message: parsed.error.message };
      }
      try {
        return { ok: true, data: await getTabManager().beginTabPreview(parsed.data.id) };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
  handle(IpcChannel.TabsEndTabPreview, tabIdRequestSchema, (request) =>
    getTabManager().restoreTabPreview(request.id),
  );

  handle(IpcChannel.SplitEnter, splitEnterRequestSchema, (request) =>
    getTabManager().enterSplitView(request.secondaryId),
  );
  ipcMain.handle(IpcChannel.SplitExit, (): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: getTabManager().exitSplitView() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  handle(IpcChannel.FocusModeSet, focusModeRequestSchema, (request) =>
    getTabManager().setFocusMode(request.enabled),
  );

  ipcMain.handle(IpcChannel.TabsGetState, (): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: getTabManager().getState() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  ipcMain.handle(
    IpcChannel.TabsExportPdf,
    async (_event, rawRequest: unknown): Promise<IpcResult<ExportPdfResult>> => {
      const parsed = tabIdRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-request', message: parsed.error.message };
      }
      try {
        const savedPath = await getTabManager().exportToPdf(parsed.data.id);
        return { ok: true, data: { savedPath } };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  ipcMain.handle(IpcChannel.TabsCreateTerminal, (): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: getTabManager().createTerminalTab() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // `terminal:input`/`terminal:resize` are fire-and-forget (`ipcRenderer.send`,
  // not `invoke`) — keystroke latency matters more than a reply round-trip,
  // and there's nothing meaningful to reply with anyway.
  ipcMain.on(IpcChannel.TerminalInput, (_event, rawRequest: unknown) => {
    const parsed = terminalInputRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      getTabManager().sendTerminalInput(parsed.data.id, parsed.data.data);
    }
  });
  ipcMain.on(IpcChannel.TerminalResize, (_event, rawRequest: unknown) => {
    const parsed = terminalResizeRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      getTabManager().resizeTerminal(parsed.data.id, parsed.data.cols, parsed.data.rows);
    }
  });

  // Same fire-and-forget shape as the terminal channels above — the address
  // bar pushes a fresh sync on essentially every keystroke while its
  // dropdown is open, and there's nothing meaningful to reply with.
  ipcMain.on(IpcChannel.AddressSuggestionsSync, (_event, rawRequest: unknown) => {
    const parsed = addressSuggestionsSyncRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      getTabManager().syncAddressSuggestions(parsed.data);
    }
  });
}

/**
 * Registers one validated, error-normalized `ipcMain.handle` channel that
 * returns the full `BrowserState` — the shape nearly every action shares.
 * @param channel Channel name from `IpcChannel`.
 * @param schema Zod schema the raw payload must satisfy.
 * @param action Handler invoked with the parsed, trusted payload.
 */
function handle<T>(
  channel: string,
  schema: ZodType<T>,
  action: (request: T) => BrowserState,
): void {
  ipcMain.handle(channel, (_event, rawRequest: unknown): IpcResult<BrowserState> => {
    const parsed = schema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }
    try {
      return { ok: true, data: action(parsed.data) };
    } catch (error) {
      return toErrorResult(error);
    }
  });
}

/**
 * Normalizes a thrown value into an `IpcResult` error without leaking a
 * stack trace or other main-process internals to the renderer.
 * @param error The caught value (typed `unknown`, since `catch` doesn't
 *   guarantee an `Error` instance).
 * @returns A failed `IpcResult`.
 */
function toErrorResult(error: unknown): IpcResult<never> {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { ok: false, code: 'handler-error', message };
}
