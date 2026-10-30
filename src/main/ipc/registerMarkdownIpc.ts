// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';
import { IpcChannel, type IpcResult } from '@shared/ipc-contract';
import {
  addPdfBookmarkRequestSchema,
  markdownDisplayRequestSchema,
  markdownExportRequestSchema,
  markdownModeRequestSchema,
  markdownNavigateHistoryRequestSchema,
  markdownOpenLinkRequestSchema,
  markdownReadImageRequestSchema,
  markdownReadRemoteImageRequestSchema,
  markdownRenameRequestSchema,
  markdownResolveLinksRequestSchema,
  markdownRunCodeRequestSchema,
  markdownSaveAnnotationsRequestSchema,
  markdownSaveRequestSchema,
  pdfOpenBookmarkRequestSchema,
  pdfOpenPathRequestSchema,
  tabIdRequestSchema,
} from '@shared/ipc-schemas';
import type { BrowserState } from '@shared/tab-state';
import type { TabManager } from '../browser/TabManager';

/**
 * Registers the Markdown tab's channels, in two groups:
 *
 * - **Chrome → main** (the toolbar's New, Open, Close, Delete, rename, mode switch,
 *   history arrows, export, bookmark search), routed to whichever
 *   `TabManager` owns the tab, since a tab can have moved to another window.
 * - **Page → main** (saving an edit, saving marks, following a link,
 *   reading a picture, running a code block), sent from a tab's own child
 *   view. Each is checked to come from *that tab's own page* — a request
 *   naming another tab's id is refused — and none carries a path: main
 *   already knows which note the tab has open and acts on that alone.
 *
 * Call exactly once, like `registerTabIpc`.
 * @param resolveTabManager Resolves the `TabManager` of the chrome window that sent a request (throws for anything else).
 * @param resolveTabManagerForTab Resolves whichever `TabManager` currently owns a tab id.
 */
export function registerMarkdownIpc(
  resolveTabManager: (event: { sender: Electron.WebContents }) => TabManager,
  resolveTabManagerForTab: (tabId: string) => TabManager | undefined,
): void {
  // ── Chrome → main ──
  ipcMain.handle(IpcChannel.TabsCreateMarkdown, (event): IpcResult<BrowserState> => {
    try {
      return { ok: true, data: resolveTabManager(event).createMarkdownTab() };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  invokeForTab(IpcChannel.MarkdownOpenFile, tabIdRequestSchema, (manager, request) => manager.openMarkdownFile(request.id));
  invokeForTab(IpcChannel.MarkdownNewFile, tabIdRequestSchema, (manager, request) => manager.newMarkdownFile(request.id));
  invokeForTab(IpcChannel.MarkdownCloseFile, tabIdRequestSchema, (manager, request) => manager.closeMarkdownFile(request.id));
  invokeForTab(IpcChannel.MarkdownDeleteFile, tabIdRequestSchema, (manager, request) => manager.deleteMarkdownFile(request.id));
  invokeForTab(IpcChannel.MarkdownRename, markdownRenameRequestSchema, (manager, request) =>
    manager.renameMarkdownTab(request.id, request.name),
  );
  invokeForTab(IpcChannel.MarkdownSetMode, markdownModeRequestSchema, (manager, request) =>
    manager.setMarkdownMode(request.id, request.mode),
  );
  invokeForTab(IpcChannel.MarkdownSetDisplay, markdownDisplayRequestSchema, (manager, request) =>
    manager.setMarkdownDisplay(request.id, request.display),
  );
  invokeForTab(IpcChannel.MarkdownNavigateHistory, markdownNavigateHistoryRequestSchema, (manager, request) =>
    manager.navigateMarkdownHistory(request.id, request.direction),
  );
  invokeForTab(IpcChannel.MarkdownExport, markdownExportRequestSchema, async (manager, request) => {
    await manager.exportMarkdown(request.id, request.format);
  });

  ipcMain.handle(IpcChannel.BookmarksAddMarkdown, (event, rawRequest: unknown): IpcResult<BrowserState> => {
    const parsed = addPdfBookmarkRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return { ok: false, code: 'invalid-request', message: parsed.error.message };
    }
    try {
      return { ok: true, data: resolveTabManager(event).addMarkdownBookmark(parsed.data.id, parsed.data.name) };
    } catch (error) {
      return toErrorResult(error);
    }
  });

  // Fire-and-forget from the empty page's search box — only a chrome window may send them.
  ipcMain.on(IpcChannel.MarkdownOpenBookmark, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = pdfOpenBookmarkRequestSchema.safeParse(rawRequest);
    if (parsed.success && isChrome(event)) {
      void resolveTabManagerForTab(parsed.data.id)?.openMarkdownBookmark(parsed.data.id, parsed.data.bookmarkId);
    }
  });
  ipcMain.on(IpcChannel.MarkdownOpenPath, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = pdfOpenPathRequestSchema.safeParse(rawRequest);
    if (parsed.success && isChrome(event)) {
      void resolveTabManagerForTab(parsed.data.id)?.openMarkdownFromHistory(parsed.data.id, parsed.data.path);
    }
  });

  // ── Page → main ──
  ipcMain.on(IpcChannel.MarkdownSave, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = markdownSaveRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      pageManager(event, parsed.data.id)?.saveMarkdown(parsed.data.id, parsed.data.content, parsed.data.generation);
    }
  });
  ipcMain.on(IpcChannel.MarkdownSaveAnnotations, (event: IpcMainEvent, rawRequest: unknown) => {
    const parsed = markdownSaveAnnotationsRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      pageManager(event, parsed.data.id)?.saveMarkdownAnnotations(
        parsed.data.id,
        parsed.data.annotations,
        parsed.data.generation,
      );
    }
  });

  invokeFromPage(IpcChannel.MarkdownOpenLink, markdownOpenLinkRequestSchema, async (manager, request) => {
    await manager.openMarkdownLink(request.id, request.kind, request.target, request.newTab);
    return null;
  });
  invokeFromPage(IpcChannel.MarkdownResolveLinks, markdownResolveLinksRequestSchema, (manager, request) =>
    manager.resolveMarkdownLinks(request.id, request.names),
  );
  invokeFromPage(IpcChannel.MarkdownBacklinks, tabIdRequestSchema, (manager, request) => manager.markdownBacklinks(request.id));
  invokeFromPage(IpcChannel.MarkdownListNotes, tabIdRequestSchema, (manager, request) => manager.listMarkdownNotes(request.id));
  invokeFromPage(IpcChannel.MarkdownReadImage, markdownReadImageRequestSchema, (manager, request) =>
    manager.readMarkdownImage(request.id, request.src),
  );
  invokeFromPage(IpcChannel.MarkdownReadRemoteImage, markdownReadRemoteImageRequestSchema, (manager, request) =>
    manager.readMarkdownRemoteImage(request.id, request.url),
  );
  invokeFromPage(IpcChannel.MarkdownRunCode, markdownRunCodeRequestSchema, (manager, request) =>
    manager.runMarkdownCode(request.id, request.index),
  );

  /** The manager owning tab `tabId`, if `event` really came from that tab's own Markdown page. */
  function pageManager(event: { sender: Electron.WebContents }, tabId: string): TabManager | undefined {
    const manager = resolveTabManagerForTab(tabId);
    return manager?.ownsMarkdownContents(tabId, event.sender) ? manager : undefined;
  }

  /** Whether a message came from a chrome window rather than a tab's page. */
  function isChrome(event: { sender: Electron.WebContents }): boolean {
    try {
      resolveTabManager(event);
      return true;
    } catch {
      return false;
    }
  }

  /** Registers a chrome-originated `ipcMain.handle` that acts on the tab's owning manager and replies `null` on success. A tab's page is refused. */
  function invokeForTab<T extends { readonly id: string }>(
    channel: string,
    schema: ZodType<T>,
    action: (manager: TabManager, request: T) => void | Promise<void>,
  ): void {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, rawRequest: unknown): Promise<IpcResult<null>> => {
      const parsed = schema.safeParse(rawRequest);
      if (!parsed.success) {
        return { ok: false, code: 'invalid-request', message: parsed.error.message };
      }
      if (!isChrome(event)) {
        return { ok: false, code: 'forbidden', message: 'Only the browser window can do this.' };
      }
      try {
        const manager = resolveTabManagerForTab(parsed.data.id);
        if (manager) {
          await action(manager, parsed.data);
        }
        return { ok: true, data: null };
      } catch (error) {
        return toErrorResult(error);
      }
    });
  }

  /** Registers a page-originated `ipcMain.handle`: refused unless it came from the named tab's own page. Replies with the action's value, or `fallback` on any failure. */
  function invokeFromPage<T extends { readonly id: string }, R>(
    channel: string,
    schema: ZodType<T>,
    action: (manager: TabManager, request: T) => Promise<R>,
  ): void {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, rawRequest: unknown): Promise<R | null> => {
      const parsed = schema.safeParse(rawRequest);
      const manager = parsed.success ? pageManager(event, parsed.data.id) : undefined;
      if (!parsed.success || !manager) {
        return null;
      }
      try {
        return await action(manager, parsed.data);
      } catch (error) {
        console.error(`[markdown] ${channel} failed:`, error);
        return null;
      }
    });
  }
}

/**
 * Normalizes a thrown value into an `IpcResult` error without leaking a
 * stack trace or other main-process internals to the renderer.
 */
function toErrorResult(error: unknown): IpcResult<never> {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { ok: false, code: 'handler-error', message };
}
