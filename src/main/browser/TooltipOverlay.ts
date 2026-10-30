// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import { IpcChannel, type TooltipSyncPayload } from '@shared/ipc-contract';

/**
 * Owns every chrome tooltip (each `.chrome-tooltip` — see
 * `installChromeTooltips`) as its own small,
 * persistent `WebContentsView`, exactly the same reasoning as
 * `SuggestionsOverlay`: whichever tab is active has its own
 * `WebContentsView`, a native surface that always paints above the
 * chrome's own HTML, so a chrome-rendered tooltip can never appear
 * visually on top of a *live* page short of hiding that page's view first
 * — the approach this class exists to avoid. It's a second native view
 * instead, stacked above the active tab view (see `TabManager`'s
 * `addChildView` calls, which pin every tab view to index 0 so this one —
 * added without an index, always the topmost — stays above them) and
 * sized to exactly the tooltip's own small rectangle via `sync`, never the
 * whole page. Everywhere outside that rectangle, the tab's view is
 * untouched: still live, still interactive, exactly as if the tooltip
 * didn't exist.
 *
 * Unlike `SuggestionsOverlay`, this view's own page never reports
 * anything back — a tooltip has no clicks — so `sync`'s payload already
 * carries the exact bounds to use (`computeTooltipOverlayRect`, measured
 * on the chrome side) rather than this class working anything out itself.
 */
export class TooltipOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;

  /** @param window The chrome window this overlay's view mounts into/out of. */
  public constructor(private readonly window: BrowserWindow) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/tooltip.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `SuggestionsOverlay`'s
    // own view.
    this.view.webContents.on('will-navigate', (event) => event.preventDefault());
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Transparent, with the rounded box and its accent border drawn by tooltip-overlay.css, rather than a native
    // `setBorderRadius`: the native clip cuts through a square CSS border and left gaps at its corners (the export
    // menu's overlay does the same, for the same reason).
    this.view.setBackgroundColor('#00000000');

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void this.view.webContents.loadURL(`${devServerUrl}/tooltip.html`);
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/tooltip.html'));
    }
  }

  /**
   * Applies a chrome tooltip's latest hover state: opens it (mounting the
   * view atop the currently visible tab view(s), sized to exactly
   * `payload.rect`) or closes it (unmounting entirely, rather than merely
   * shrinking to zero, so a closed tooltip can never intercept a hover
   * meant for the page beneath it) — same shape as
   * `SuggestionsOverlay.sync`.
   * @param payload The hovered element's current tooltip state.
   */
  public sync(payload: TooltipSyncPayload): void {
    if (!payload.visible || !payload.rect) {
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
      width: Math.round(payload.rect.width),
      height: Math.round(payload.rect.height),
    });

    this.view.webContents.send(IpcChannel.TooltipSync, payload);
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
