// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import { COLOR_PICKER_PANEL_HEIGHT_PX, COLOR_PICKER_PANEL_WIDTH_PX } from '@shared/constants';
import { IpcChannel, type ColorPickerColorChangedPayload, type ColorPickerSyncPayload } from '@shared/ipc-contract';
import { colorPickerColorChangeRequestSchema } from '@shared/ipc-schemas';

/**
 * Owns `ColorPicker`'s dropdown — the hue ring, saturation/value square,
 * recent-color swatches, and RGB/hex fields — as its own small, persistent
 * `WebContentsView`, exactly the same reasoning as `SuggestionsOverlay`:
 * whichever tab is active has its own `WebContentsView`, a native surface
 * that always paints above the chrome's own HTML, so a chrome-rendered
 * dropdown could never appear visually on top of a *live* page — and,
 * critically, could never appear *instantly*: the only alternative
 * (`BookmarkPopup`'s own `beginTabPreview`/`restoreTabPreview`) has to
 * round-trip to main and capture a frame before the page's view actually
 * comes off the window, which is exactly the visible "draws behind, then
 * snaps on top" delay this class exists to avoid. Mounted above the active
 * tab view (see `TabManager`'s `addChildView` calls, which pin every tab
 * view to index 0 so this one — added without an index, always the
 * topmost — stays above them) and sized to exactly the dropdown's own
 * fixed, known-in-advance rectangle
 * (`COLOR_PICKER_PANEL_WIDTH_PX`/`COLOR_PICKER_PANEL_HEIGHT_PX`) via
 * `sync`. Everywhere outside that small rectangle, the tab's view is
 * untouched: still live, still interactive, exactly as if the dropdown
 * didn't exist.
 *
 * Unlike `SuggestionsOverlay` (a click reports back by row index into a
 * list the chrome already has), this view owns real interaction of its
 * own — dragging the ring/square, typing a channel or hex value — so what
 * reports back (`onColorChange`) is a full color on every change, not an
 * index.
 */
export class ColorPickerOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;

  /**
   * @param window The chrome window this overlay's view mounts into/out of.
   * @param onColorChange Called with every color the overlay's own page
   *   reports — forwarded up to the chrome's `ColorPicker`, which owns
   *   actually applying it (`--color-accent-rgb`, persistence, the recents
   *   list).
   * @param onCloseRequested Called when the overlay's own page reports an
   *   Escape keypress — see `NorthstarColorPickerApi.requestClose`'s own
   *   doc comment for why the chrome can't just listen for this itself.
   */
  public constructor(
    private readonly window: BrowserWindow,
    onColorChange: (payload: ColorPickerColorChangedPayload) => void,
    onCloseRequested: () => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/colorPicker.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `SuggestionsOverlay`'s
    // own view.
    this.view.webContents.on('will-navigate', (event) => event.preventDefault());
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Matches `--size-radius-sm` (sizes.css), same reasoning as
    // `SuggestionsOverlay.setBorderRadius`.
    this.view.setBorderRadius(6);

    // Scoped to this view's own webContents (`WebContents#ipc`, not the
    // global `ipcMain`) — same reasoning as `SuggestionsOverlay`'s own
    // `ipc.on` calls: a second window's own `ColorPickerOverlay` sends the
    // same channels from its own, entirely separate view.
    this.view.webContents.ipc.on(IpcChannel.ColorPickerColorChanged, (_event, rawPayload: unknown) => {
      const parsed = colorPickerColorChangeRequestSchema.safeParse(rawPayload);
      if (parsed.success) {
        onColorChange(parsed.data);
      }
    });
    this.view.webContents.ipc.on(IpcChannel.ColorPickerCloseRequested, () => onCloseRequested());

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void this.view.webContents.loadURL(`${devServerUrl}/color-picker.html`);
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/color-picker.html'));
    }
  }

  /**
   * Applies `ColorPicker`'s latest sync: opens the dropdown (mounting the
   * view atop the currently visible tab view(s), sized to
   * `COLOR_PICKER_PANEL_WIDTH_PX`×`COLOR_PICKER_PANEL_HEIGHT_PX` at
   * `payload.rect`) or closes it (unmounting entirely, rather than merely
   * shrinking to zero, so a closed dropdown can never intercept a click
   * meant for the page beneath it) — same shape as `SuggestionsOverlay.sync`.
   * Always pushes the current accent/recents down either way, since a
   * still-open dropdown re-syncs on every accent change (including ones
   * this same view just reported up a moment ago).
   *
   * Unlike `SuggestionsOverlay`/`TooltipOverlay`, the closing payload is
   * sent to the view too, not just used to decide whether to unmount it —
   * `ColorPickerOverlayView` tracks its own closed→open transition (to
   * know when to re-seed its working color from a fresh `accent` rather
   * than fight its own in-progress drag) and needs an actual `open: false`
   * payload to notice the transition back, since simply being unmounted
   * (invisible, not destroyed) doesn't by itself change anything in its
   * still-running React tree.
   * @param payload `ColorPicker`'s current dropdown state.
   */
  public sync(payload: ColorPickerSyncPayload): void {
    if (!payload.open || !payload.rect) {
      this.view.webContents.send(IpcChannel.ColorPickerSync, payload);
      this.hide();
      return;
    }

    if (!this.isMounted) {
      // No index given, so it lands at the end of the child-view stack —
      // i.e. on top — same as `SuggestionsOverlay`'s own `addChildView` call.
      this.window.contentView.addChildView(this.view);
      this.isMounted = true;
    }

    this.view.setBounds({
      x: Math.round(payload.rect.left),
      y: Math.round(payload.rect.top),
      width: COLOR_PICKER_PANEL_WIDTH_PX,
      height: COLOR_PICKER_PANEL_HEIGHT_PX,
    });

    this.view.webContents.send(IpcChannel.ColorPickerSync, payload);
  }

  /** Unmounts the overlay's view, if currently shown. A no-op otherwise. */
  private hide(): void {
    if (this.isMounted) {
      this.window.contentView.removeChildView(this.view);
      this.isMounted = false;
    }
  }

  /** Removes the overlay's view for good — call this when the owning window closes. */
  public dispose(): void {
    this.hide();
  }
}
