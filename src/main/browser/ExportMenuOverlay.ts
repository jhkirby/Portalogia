// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import {
  EXPORT_MENU_HEIGHT_PX,
  EXPORT_MENU_MARKDOWN_HEIGHT_PX,
  EXPORT_MENU_WIDTH_PX,
  MENU_FADE_MS,
  NEW_TAB_MENU_HEIGHT_PX,
  NEW_TAB_MENU_WIDTH_PX,
} from '@shared/constants';
import { IpcChannel, type ExportMenuSyncPayload, type MenuOverlayAction } from '@shared/ipc-contract';
import { exportMenuSelectRequestSchema } from '@shared/ipc-schemas';

/**
 * Owns the toolbar export dropdown as its own small `WebContentsView`,
 * for the same reason as `ColorPickerOverlay`: a tab's view always paints
 * above chrome HTML, so a themed dropdown has to be its own view stacked
 * above it. Sized to the fixed `EXPORT_MENU_*` constants (taller on a Markdown tab, which lists three formats). While open it
 * also watches the active tab's `'focus'` event — a click on the live page
 * never reaches the chrome's DOM — and asks the chrome to close.
 */
export class ExportMenuOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;
  /** Set while the menu fades out (`hide`): its view comes off the window when it fires. */
  private unmountTimer: ReturnType<typeof setTimeout> | null = null;
  private watchedTabView: WebContentsView | null = null;
  private readonly handleActiveViewFocused: () => void;

  /**
   * @param window The chrome window this overlay's view mounts into/out of.
   * @param onSelect Called with the row the user picked.
   * @param onCloseRequested Called when the overlay's page reports Escape
   *   or the live page is clicked. The chrome's `ExportMenu` owns the
   *   open state and syncs back down once it flips.
   */
  public constructor(
    private readonly window: BrowserWindow,
    onSelect: (action: MenuOverlayAction) => void,
    private readonly onCloseRequested: () => void,
  ) {
    this.handleActiveViewFocused = () => this.onCloseRequested();

    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/exportMenu.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    this.view.webContents.on('will-navigate', (event) => event.preventDefault());
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Transparent view + CSS-drawn rounded border (export-menu.css), rather
    // than native `setBorderRadius`: the native clip cuts through a square
    // CSS border and leaves its corners disconnected.
    this.view.setBackgroundColor('#00000000');

    // Scoped to this view's own webContents so a second window's overlay
    // sending the same channels stays separate.
    this.view.webContents.ipc.on(IpcChannel.ExportMenuSelect, (_event, rawPayload: unknown) => {
      const parsed = exportMenuSelectRequestSchema.safeParse(rawPayload);
      if (parsed.success) {
        onSelect(parsed.data.action);
      }
    });
    this.view.webContents.ipc.on(IpcChannel.ExportMenuCloseRequested, () => onCloseRequested());

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void this.view.webContents.loadURL(`${devServerUrl}/export-menu.html`);
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/export-menu.html'));
    }
  }

  /**
   * Applies `ExportMenu`'s latest sync: mounts on top at `payload.rect`, or
   * unmounts entirely when closed so it can't swallow clicks meant for the page.
   * @param activeTabView The active tab's view, watched for `'focus'` while open.
   */
  public sync(payload: ExportMenuSyncPayload, activeTabView: WebContentsView | null): void {
    if (!payload.open || !payload.rect) {
      this.view.webContents.send(IpcChannel.ExportMenuSync, payload);
      this.hide();
      this.watchActiveView(null);
      return;
    }

    // Reopened while fading out: it stays up, and fades back in.
    this.cancelUnmount();
    if (!this.isMounted) {
      // No index: lands on top of the stack, above every tab view.
      this.window.contentView.addChildView(this.view);
      this.isMounted = true;
      // Keyboard focus has to be in this view, not the chrome or the tab,
      // for the arrow keys to reach the menu's rows.
      this.view.webContents.focus();
    }
    this.watchActiveView(activeTabView);

    // Each menu's fixed size: the "+" menu's (`NewTabMenu`), or the export menu's, a row longer on a note.
    this.view.setBounds({
      x: Math.round(payload.rect.left),
      y: Math.round(payload.rect.top),
      width: payload.kind === 'new-tab' ? NEW_TAB_MENU_WIDTH_PX : EXPORT_MENU_WIDTH_PX,
      height:
        payload.kind === 'new-tab'
          ? NEW_TAB_MENU_HEIGHT_PX
          : payload.markdown
            ? EXPORT_MENU_MARKDOWN_HEIGHT_PX
            : EXPORT_MENU_HEIGHT_PX,
    });

    this.view.webContents.send(IpcChannel.ExportMenuSync, payload);
  }

  private watchActiveView(view: WebContentsView | null): void {
    if (this.watchedTabView === view) {
      return;
    }
    this.watchedTabView?.webContents.off('focus', this.handleActiveViewFocused);
    this.watchedTabView = view;
    view?.webContents.on('focus', this.handleActiveViewFocused);
  }

  /**
   * Takes the menu off the window once its page has faded it out (`MENU_FADE_MS`), rather than at once.
   * @param immediate Skip the fade, e.g. when the window is closing.
   */
  private hide(immediate = false): void {
    if (!this.isMounted) {
      return;
    }
    if (immediate) {
      this.unmount();
    } else if (this.unmountTimer === null) {
      this.unmountTimer = setTimeout(() => this.unmount(), MENU_FADE_MS);
    }
  }

  private cancelUnmount(): void {
    if (this.unmountTimer !== null) {
      clearTimeout(this.unmountTimer);
      this.unmountTimer = null;
    }
  }

  private unmount(): void {
    this.cancelUnmount();
    if (this.isMounted && !this.window.isDestroyed()) {
      this.window.contentView.removeChildView(this.view);
    }
    this.isMounted = false;
  }

  /** Removes the overlay's view for good — call when the owning window closes. */
  public dispose(): void {
    this.hide(true);
    this.watchActiveView(null);
  }
}
