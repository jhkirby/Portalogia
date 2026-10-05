// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';
import { IpcChannel, type ExportPdfResult, type IpcResult } from '@shared/ipc-contract';
import {
  addBookmarkRequestSchema,
  addressSuggestionsSyncRequestSchema,
  bookmarkIdRequestSchema,
  colorPickerSyncRequestSchema,
  commentToolRequestSchema,
  createTabRequestSchema,
  createWorkspaceRequestSchema,
  createWorkspaceWithTabRequestSchema,
  exportMenuSyncRequestSchema,
  focusModeRequestSchema,
  highlighterRequestSchema,
  laserPointerRequestSchema,
  moveTabRequestSchema,
  moveTabToWorkspaceRequestSchema,
  navigateRequestSchema,
  penRequestSchema,
  renameWorkspaceRequestSchema,
  splitEnterRequestSchema,
  textToolRequestSchema,
  cropRequestSchema,
  pdfGoToPageRequestSchema,
  pdfPageInfoRequestSchema,
  pdfSaveAnnotationsRequestSchema,
  pdfRenameRequestSchema,
  tabIdRequestSchema,
  zoomWheelRequestSchema,
  terminalInputRequestSchema,
  terminalResizeRequestSchema,
  tooltipSyncRequestSchema,
  workspaceIdRequestSchema,
  zoomSetRequestSchema,
} from '@shared/ipc-schemas';
import type { BrowserState } from '@shared/tab-state';
import { pdfAnnotationStore } from '../browser/PdfAnnotationStore';
import type { TabManager } from '../browser/TabManager';

/**
 * Registers every `ipcMain.handle` channel, each validating its payload
 * against the shared zod schema before touching `TabManager` and
 * normalizing any thrown error into an `IpcResult` — the renderer never
 * sees a raw main-process exception.
 *
 * Call this exactly once for the app's lifetime — `ipcMain.handle` allows
 * only one handler per channel, so a second window must not re-register.
 *
 * @param resolveTabManager Resolves the `TabManager` that OWNS the
 *   window a request was actually sent from (`event.sender`) — not
 *   "whichever window is currently focused": a tab click, a URL
 *   navigation, closing a tab, all of it must act on the window the user
 *   is actually interacting with, which since `tearOffTab` (main/index.ts)
 *   made more than one window possible at once, is no longer guaranteed
 *   to be the focused one (clicking into a background window's tab is a
 *   perfectly ordinary thing to do). Every channel here is invoked from
 *   the chrome's own top-level `webContents` — never a tab's own child
 *   `WebContentsView` — so `event.sender` always resolves unambiguously.
 * @param resolveTabManagerForTab Resolves whichever `TabManager` currently
 *   owns a specific tab id, for the two channels (`terminal:input`,
 *   `terminal:resize`) that come from a *different* webContents than the
 *   chrome's own: a terminal tab's own child `WebContentsView`. Scoping by
 *   the tab id it's already keyed on sidesteps needing `event.sender` to
 *   resolve correctly for a child view at all.
 */
export function registerTabIpc(
  resolveTabManager: (event: { sender: Electron.WebContents }) => TabManager,
  resolveTabManagerForTab: (tabId: string) => TabManager | undefined,
): void {
  handle(IpcChannel.TabsCreate, createTabRequestSchema, (request, event) =>
    resolveTabManager(event).createTabAndFocusAddressBar(request.url),
  );
  handle(IpcChannel.TabsToggleSelect, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).toggleTabSelection(request.id),
  );
  handle(IpcChannel.TabsSelectRange, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).selectTabRange(request.id),
  );
  handle(IpcChannel.TabsClose, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).closeTab(request.id),
  );
  handle(IpcChannel.TabsActivate, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).activateTab(request.id),
  );
  // `TabBar`'s drag-and-drop reorder gesture. Tabs/workspaces are shared
  // across every open window (`SharedTabRegistry`), so a plain
  // `moveTab` already repositions the dragged tab correctly regardless of
  // which window's `TabManager` instance is asked to do it — the one
  // extra step needed for a genuinely *cross-window* drag (dropped into a
  // window showing a different workspace than the tab's own) is
  // reassigning that workspace first, exactly like dragging onto a
  // `WorkspaceBar` pill would, before positioning it at the exact
  // boundary the drop landed on.
  handle(IpcChannel.TabsMove, moveTabRequestSchema, (request, event) =>
    resolveTabManager(event).moveTabsBefore(request.id, request.beforeId),
  );
  handle(IpcChannel.TabsMoveToWorkspace, moveTabToWorkspaceRequestSchema, (request, event) =>
    resolveTabManager(event).moveTabsToWorkspace(request.id, request.workspaceId),
  );
  handle(IpcChannel.TabsNavigate, navigateRequestSchema, (request, event) =>
    resolveTabManager(event).navigate(request.id, request.url),
  );
  handle(IpcChannel.TabsGoBack, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).goBack(request.id),
  );
  handle(IpcChannel.TabsGoForward, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).goForward(request.id),
  );
  handle(IpcChannel.TabsReload, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).reload(request.id),
  );
  handle(IpcChannel.TabsStop, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).stop(request.id),
  );

  handle(IpcChannel.WorkspacesCreate, createWorkspaceRequestSchema, (request, event) =>
    resolveTabManager(event).createWorkspace(request.name),
  );
  handle(IpcChannel.WorkspacesCreateWithTab, createWorkspaceWithTabRequestSchema, (request, event) =>
    resolveTabManager(event).createWorkspaceWithTab(request.tabId),
  );
  handle(IpcChannel.WorkspacesToggleSelect, workspaceIdRequestSchema, (request, event) =>
    resolveTabManager(event).toggleWorkspaceSelection(request.id),
  );
  handle(IpcChannel.WorkspacesSelectRange, workspaceIdRequestSchema, (request, event) =>
    resolveTabManager(event).selectWorkspaceRange(request.id),
  );
  handle(IpcChannel.WorkspacesSwitch, workspaceIdRequestSchema, (request, event) =>
    resolveTabManager(event).switchWorkspace(request.id),
  );
  handle(IpcChannel.WorkspacesRename, renameWorkspaceRequestSchema, (request, event) =>
    resolveTabManager(event).renameWorkspace(request.id, request.name),
  );
  handle(IpcChannel.WorkspacesRemove, workspaceIdRequestSchema, (request, event) =>
    resolveTabManager(event).removeWorkspace(request.id),
  );

  handle(IpcChannel.BookmarksAdd, addBookmarkRequestSchema, (request, event) =>
    resolveTabManager(event).addBookmark(request.title, request.url),
  );
  handle(IpcChannel.BookmarksRemove, bookmarkIdRequestSchema, (request, event) =>
    resolveTabManager(event).removeBookmark(request.id),
  );

  ipcMain.handle(
    IpcChannel.TabsBeginTabPreview,
    async (event, rawRequest: unknown): Promise<IpcResult<string | null>> => {
      const parsed = tabIdRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-request', message: parsed.error.message };
      }
      try {
        return { ok: true, data: await resolveTabManager(event).beginTabPreview(parsed.data.id) };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
  handle(IpcChannel.TabsEndTabPreview, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).restoreTabPreview(request.id),
  );

  handle(IpcChannel.SplitEnter, splitEnterRequestSchema, (request, event) =>
    resolveTabManager(event).enterSplitView(request.secondaryId),
  );
  ipcMain.handle(IpcChannel.SplitExit, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).exitSplitView() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  ipcMain.handle(IpcChannel.SidebarToggle, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).toggleSidebar() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  handle(IpcChannel.FocusModeSet, focusModeRequestSchema, (request, event) =>
    resolveTabManager(event).setFocusMode(request.enabled),
  );

  handle(IpcChannel.LaserPointerSet, laserPointerRequestSchema, (request, event) =>
    resolveTabManager(event).setLaserPointer(request.enabled),
  );

  handle(IpcChannel.HighlighterSet, highlighterRequestSchema, (request, event) =>
    resolveTabManager(event).setHighlighter(request.enabled),
  );

  handle(IpcChannel.CommentToolSet, commentToolRequestSchema, (request, event) =>
    resolveTabManager(event).setCommentTool(request.enabled),
  );

  handle(IpcChannel.TextToolSet, textToolRequestSchema, (request, event) =>
    resolveTabManager(event).setTextTool(request.enabled),
  );

  handle(IpcChannel.PenSet, penRequestSchema, (request, event) => resolveTabManager(event).setPen(request.enabled));

  handle(IpcChannel.CropSet, cropRequestSchema, (request, event) => resolveTabManager(event).setCrop(request.enabled));

  ipcMain.handle(IpcChannel.PdfCloseFile, (_event, rawRequest: unknown): IpcResult<null> => {
    const parsed = tabIdRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }
    resolveTabManagerForTab(parsed.data.id)?.closePdfFile(parsed.data.id);
    return { ok: true, data: null };
  });

  ipcMain.handle(IpcChannel.PdfExport, async (_event, rawRequest: unknown): Promise<IpcResult<null>> => {
    const parsed = tabIdRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }
    try {
      await resolveTabManagerForTab(parsed.data.id)?.exportPdfFile(parsed.data.id);
      return { ok: true, data: null };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  ipcMain.handle(IpcChannel.ZoomIn, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).zoomIn() };
    } catch (error) {
      return toErrorResult(error);
    }
  });
  ipcMain.handle(IpcChannel.ZoomOut, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).zoomOut() };
    } catch (error) {
      return toErrorResult(error);
    }
  });
  ipcMain.handle(IpcChannel.ZoomReset, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).resetZoom() };
    } catch (error) {
      return toErrorResult(error);
    }
  });
  handle(IpcChannel.ZoomSet, zoomSetRequestSchema, (request, event) =>
    resolveTabManager(event).setZoom(request.percent),
  );

  ipcMain.handle(IpcChannel.TabsGetState, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).getState() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  ipcMain.handle(
    IpcChannel.TabsExportPdf,
    async (event, rawRequest: unknown): Promise<IpcResult<ExportPdfResult>> => {
      const parsed = tabIdRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-request', message: parsed.error.message };
      }
      try {
        const savedPath = await resolveTabManager(event).exportToPdf(parsed.data.id);
        return { ok: true, data: { savedPath } };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  ipcMain.handle(IpcChannel.TabsCreatePdf, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).createPdfTab() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // PDF toolbar actions come from the chrome but are routed by tab id, as
  // the tab may have been moved to another window's manager.
  ipcMain.handle(IpcChannel.PdfOpenFile, async (_event, rawRequest: unknown): Promise<IpcResult<null>> => {
    const parsed = tabIdRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }
    try {
      await resolveTabManagerForTab(parsed.data.id)?.openPdfFile(parsed.data.id);
      return { ok: true, data: null };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // Fire-and-forget from the PDF page after every edit; the store debounces the disk write.
  ipcMain.on(IpcChannel.PdfSaveAnnotations, (_event, rawRequest: unknown) => {
    const parsed = pdfSaveAnnotationsRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      pdfAnnotationStore.set(parsed.data.key, parsed.data.annotations);
    }
  });

  // Fire-and-forget from the PDF page whenever the page in view changes.
  ipcMain.on(IpcChannel.PdfPageInfo, (_event, rawRequest: unknown) => {
    const parsed = pdfPageInfoRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManagerForTab(parsed.data.id)?.setPdfPageInfo(parsed.data.id, parsed.data.page, parsed.data.pageCount);
    }
  });

  ipcMain.handle(IpcChannel.PdfGoToPage, (_event, rawRequest: unknown): IpcResult<null> => {
    const parsed = pdfGoToPageRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }
    resolveTabManagerForTab(parsed.data.id)?.goToPdfPage(parsed.data.id, parsed.data.page);
    return { ok: true, data: null };
  });

  ipcMain.handle(IpcChannel.PdfRename, async (_event, rawRequest: unknown): Promise<IpcResult<null>> => {
    const parsed = pdfRenameRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: 'File name must end in .pdf' };
    }
    try {
      await resolveTabManagerForTab(parsed.data.id)?.renamePdfTab(parsed.data.id, parsed.data.name);
      return { ok: true, data: null };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // Sent by a tab's own preload on Ctrl+wheel. Tab views are shared by every
  // window's manager, so any one can resolve the sender to its tab.
  ipcMain.on(IpcChannel.ZoomWheel, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = zoomWheelRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManager(event).wheelZoom(event.sender, parsed.data.direction);
    }
  });

  ipcMain.handle(IpcChannel.TabsCreateTerminal, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).createTerminalTab() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  handle(IpcChannel.TabsRevertPage, tabIdRequestSchema, (request, event) =>
    resolveTabManager(event).revertPage(request.id),
  );

  // `terminal:input`/`terminal:resize` are fire-and-forget (`ipcRenderer.send`,
  // not `invoke`) — keystroke latency matters more than a reply round-trip,
  // and there's nothing meaningful to reply with anyway. Sent from a
  // terminal tab's own child `WebContentsView`, not the chrome's top-level
  // one — resolved by tab id (`resolveTabManagerForTab`) rather than
  // `event.sender`, see this function's own doc comment for why.
  ipcMain.on(IpcChannel.TerminalInput, (_event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = terminalInputRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManagerForTab(parsed.data.id)?.sendTerminalInput(parsed.data.id, parsed.data.data);
    }
  });
  ipcMain.on(IpcChannel.TerminalResize, (_event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = terminalResizeRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManagerForTab(parsed.data.id)?.resizeTerminal(parsed.data.id, parsed.data.cols, parsed.data.rows);
    }
  });

  // Same fire-and-forget shape as the terminal channels above — the address
  // bar pushes a fresh sync on essentially every keystroke while its
  // dropdown is open, and there's nothing meaningful to reply with. Sent
  // from the chrome's own top-level webContents (AddressBar.tsx), unlike
  // the terminal channels above, so `event.sender` resolves it directly.
  ipcMain.on(IpcChannel.AddressSuggestionsSync, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = addressSuggestionsSyncRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManager(event).syncAddressSuggestions(parsed.data);
    }
  });

  // Same fire-and-forget shape as `AddressSuggestionsSync` above — a
  // collapsed-sidebar button pushes a fresh sync on every hover start/end
  // (see `useOverlayTooltip`), with nothing meaningful to reply with.
  ipcMain.on(IpcChannel.TooltipSync, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = tooltipSyncRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManager(event).syncTooltip(parsed.data);
    }
  });

  // Same fire-and-forget shape as `AddressSuggestionsSync` above —
  // `ColorPicker` pushes a fresh sync on every open/close and on every
  // accent/recents change while it's open.
  ipcMain.on(IpcChannel.ExportMenuSync, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = exportMenuSyncRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManager(event).syncExportMenu(parsed.data);
    }
  });
  ipcMain.on(IpcChannel.ColorPickerSync, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = colorPickerSyncRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      resolveTabManager(event).syncColorPicker(parsed.data);
    }
  });
}

/**
 * Registers one validated, error-normalized `ipcMain.handle` channel that
 * returns the full `BrowserState` — the shape nearly every action shares.
 * @param channel Channel name from `IpcChannel`.
 * @param schema Zod schema the raw payload must satisfy.
 * @param action Handler invoked with the parsed, trusted payload and the
 *   raw IPC event (so it can resolve which window's `TabManager` to act
 *   on — see `registerTabIpc`'s own doc comment).
 */
function handle<T>(
  channel: string,
  schema: ZodType<T>,
  action: (request: T, event: IpcMainInvokeEvent) => BrowserState,
): void {
  ipcMain.handle(channel, (event, rawRequest: unknown): IpcResult<BrowserState> => {
    const parsed = schema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }
    try {
      return { ok: true, data: action(parsed.data, event) };
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
