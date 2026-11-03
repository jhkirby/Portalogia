// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-26

import type { BrowserWindow, Rectangle, WebContentsView } from 'electron';
import { IpcChannel, type ContentSnapshotInsets, type ContentSnapshotMessage, type ContentSnapshotPiece } from '@shared/ipc-contract';

/** How long the chrome may take to put the snapshot up before the slide goes ahead without it. */
const SHOW_TIMEOUT_MS = 250;

/** How long the snapshot stays once the live pages are back over it: long enough for them to be on screen first. */
const UNCOVER_DELAY_MS = 60;

/**
 * Stands a picture of the tab's pages in for them while the sidebar slides
 * (`TabManager.toggleSidebar`). A native view's bounds don't animate, and
 * resizing a page every frame from here never kept step with the chrome's
 * own CSS slide: it stepped, a beat behind. The chrome draws the picture in
 * its own tab area instead (`ContentSnapshot` there), which its layout moves
 * in the same frames as the sidebar, while the live pages lay themselves out
 * at their new size out of sight.
 */
export class ContentSnapshot {
  private nextId = 1;
  private pending: { readonly id: number; readonly resolve: (shown: boolean) => void } | null = null;
  private uncoverTimer: ReturnType<typeof setTimeout> | null = null;

  /** @param window The window whose chrome draws the snapshot. */
  public constructor(private readonly window: BrowserWindow) {}

  /**
   * Captures each pane and has the chrome put the pictures up in their place.
   * @param panes The views on show, with where each sits in the window.
   * @param area The rect all the panes share (the single view's bounds, or the split pair's together).
   * @param insets Where `area` sits in the chrome's tab area; they hold through the slide.
   * @param radius The panes' corner radius (`setBorderRadius`), for the pictures to match.
   * @returns The snapshot's id once it's on screen, or `null` if it couldn't be put up.
   */
  public async cover(
    panes: readonly { readonly view: WebContentsView; readonly bounds: Rectangle }[],
    area: Rectangle,
    insets: ContentSnapshotInsets,
    radius: number,
  ): Promise<number | null> {
    if (area.width <= 0 || area.height <= 0 || this.window.webContents.isDestroyed()) {
      return null;
    }
    let pieces: ContentSnapshotPiece[];
    try {
      pieces = await Promise.all(
        panes.map(async ({ view, bounds }) => {
          const image = await view.webContents.capturePage();
          const size = image.getSize();
          return {
            // Raw BGRA: copying it is far quicker than encoding a PNG, and keeps a page's see-through margins.
            bitmap: image.toBitmap(),
            pixelWidth: size.width,
            pixelHeight: size.height,
            width: bounds.width,
            height: bounds.height,
            // Fractions of `area`, so a split pair keeps sharing it as it widens or narrows.
            x: (bounds.x - area.x) / area.width,
            y: (bounds.y - area.y) / area.height,
            fractionWidth: bounds.width / area.width,
            fractionHeight: bounds.height / area.height,
          };
        }),
      );
    } catch {
      return null;
    }
    pieces = pieces.filter((piece) => piece.pixelWidth > 0 && piece.pixelHeight > 0);
    if (pieces.length === 0 || this.window.webContents.isDestroyed()) {
      return null;
    }
    this.cancelPending();
    if (this.uncoverTimer !== null) {
      clearTimeout(this.uncoverTimer);
      this.uncoverTimer = null;
    }
    const id = this.nextId++;
    const shown = new Promise<boolean>((resolve) => {
      this.pending = { id, resolve };
      setTimeout(() => resolve(false), SHOW_TIMEOUT_MS);
    });
    this.window.webContents.send(IpcChannel.UiContentSnapshot, { kind: 'show', id, insets, radius, pieces } satisfies ContentSnapshotMessage);
    if (await shown) {
      return id;
    }
    this.uncover(id, 0);
    return null;
  }

  /**
   * The chrome has the snapshot on screen (`ContentSnapshotShown`).
   * @param id The snapshot's id.
   */
  public shown(id: number): void {
    if (this.pending?.id === id) {
      this.pending.resolve(true);
      this.pending = null;
    }
  }

  /**
   * Takes the snapshot down, once the live pages are back over it.
   * @param id The snapshot to take down; a newer one is left up.
   * @param delayMs How long to leave it first.
   */
  public uncover(id: number, delayMs = UNCOVER_DELAY_MS): void {
    if (this.uncoverTimer !== null) {
      clearTimeout(this.uncoverTimer);
    }
    this.uncoverTimer = setTimeout(() => {
      this.uncoverTimer = null;
      if (!this.window.webContents.isDestroyed()) {
        this.window.webContents.send(IpcChannel.UiContentSnapshot, { kind: 'clear', id } satisfies ContentSnapshotMessage);
      }
    }, delayMs);
  }

  /** Gives up on a snapshot still waiting to be shown. */
  private cancelPending(): void {
    this.pending?.resolve(false);
    this.pending = null;
  }
}
