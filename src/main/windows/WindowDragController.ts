// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { BrowserWindow, screen } from 'electron';
import { snapZoneAt, type Point, type Rect, type SnapZone } from './snapZones';

/** How often, in ms, a dragged window is moved to the cursor. */
const DRAG_INTERVAL_MS = 8;

/** Where, vertically, the cursor sits in a window restored by a drag (so it stays over the grip strip). */
const RESTORED_GRAB_Y_PX = 12;

/** The translucent outline shown where a dropped window would snap. Click-through, so it never steals the drag. */
const PREVIEW_HTML =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<body style="margin:0;background:transparent"><div style="position:fixed;inset:6px;' +
      'border-radius:10px;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.6)"></div></body>',
  );

/** One window being dragged right now. */
interface ActiveDrag {
  readonly window: BrowserWindow;
  readonly grab: Point;
  readonly timer: NodeJS.Timeout;
  preview: BrowserWindow | null;
  zone: SnapZone | null;
}

/**
 * Moves a frameless window by its titlebar grip strip, with the behaviors a
 * native title-bar drag has: snapping to a half or quarter of the screen (or
 * maximizing) when released against an edge — with an outline previewing
 * where it will land — and restoring the previous size when a snapped or
 * maximized window is dragged away again.
 *
 * Done here rather than by the OS (`-webkit-app-region: drag`) because an OS
 * drag region swallows every mouse event, so the strip couldn't show hover and
 * pressed colors or a grab cursor. The window follows a polled cursor, so it
 * keeps working after the pointer leaves the window.
 */
export class WindowDragController {
  private readonly drags = new Map<number, ActiveDrag>();
  /** Each snapped window's size before it was snapped, to restore on the next drag. */
  private readonly beforeSnap = new Map<number, Rect>();

  /**
   * Starts moving `window` with the cursor, replacing any drag already running on it.
   * @param window The window whose grip strip was pressed.
   */
  public begin(window: BrowserWindow): void {
    this.end(window);

    const cursor = screen.getCursorScreenPoint();
    this.restoreIfSnappedOrMaximized(window, cursor);

    const [startX = 0, startY = 0] = window.getPosition();
    const grab = { x: cursor.x - startX, y: cursor.y - startY };
    const timer = setInterval(() => this.tick(window.id), DRAG_INTERVAL_MS);
    this.drags.set(window.id, { window, grab, timer, preview: null, zone: null });
  }

  /**
   * Ends the drag on `window`, applying the snap zone it was released in, if any.
   * @param window The window being dropped.
   */
  public end(window: BrowserWindow): void {
    const drag = this.drags.get(window.id);
    if (!drag) {
      return;
    }
    clearInterval(drag.timer);
    this.drags.delete(window.id);
    this.closePreview(drag);

    if (window.isDestroyed()) {
      return;
    }
    const zone = this.zoneAt(screen.getCursorScreenPoint());
    if (zone) {
      this.applyZone(window, zone);
    }
  }

  /** One step of a drag: follows the cursor and keeps the snap preview current. */
  private tick(windowId: number): void {
    const drag = this.drags.get(windowId);
    if (!drag) {
      return;
    }
    if (drag.window.isDestroyed()) {
      clearInterval(drag.timer);
      this.closePreview(drag);
      this.drags.delete(windowId);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    drag.window.setPosition(cursor.x - drag.grab.x, cursor.y - drag.grab.y);
    this.updatePreview(drag, this.zoneAt(cursor));
  }

  /** The snap zone at a cursor position, on whichever display it's over. */
  private zoneAt(cursor: Point): SnapZone | null {
    const display = screen.getDisplayNearestPoint(cursor);
    return snapZoneAt(cursor, display.bounds, display.workArea);
  }

  /** Shows (or moves, or hides) the preview outline to match the zone the cursor is in. */
  private updatePreview(drag: ActiveDrag, zone: SnapZone | null): void {
    const unchanged =
      zone?.rect.x === drag.zone?.rect.x &&
      zone?.rect.y === drag.zone?.rect.y &&
      zone?.rect.width === drag.zone?.rect.width &&
      zone?.rect.height === drag.zone?.rect.height &&
      (zone === null) === (drag.zone === null);
    if (unchanged) {
      return;
    }
    drag.zone = zone;
    if (!zone) {
      drag.preview?.hide();
      return;
    }
    if (!drag.preview || drag.preview.isDestroyed()) {
      drag.preview = new BrowserWindow({
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
      });
      drag.preview.setIgnoreMouseEvents(true);
      void drag.preview.loadURL(PREVIEW_HTML);
    }
    drag.preview.setBounds(zone.rect);
    drag.preview.showInactive();
  }

  private closePreview(drag: ActiveDrag): void {
    if (drag.preview && !drag.preview.isDestroyed()) {
      drag.preview.destroy();
    }
    drag.preview = null;
  }

  /** Puts the window where its snap zone says: maximized, or at the half/quarter rectangle (remembering its old size). */
  private applyZone(window: BrowserWindow, zone: SnapZone): void {
    if (zone.kind === 'maximize') {
      window.maximize();
      return;
    }
    if (!this.beforeSnap.has(window.id)) {
      this.beforeSnap.set(window.id, window.getBounds());
    }
    window.setBounds(zone.rect);
  }

  /**
   * A maximized or snapped window grabbed by its strip returns to its
   * earlier size, kept under the cursor at the same proportion across its
   * width — the native behavior when you drag a window away from an edge.
   */
  private restoreIfSnappedOrMaximized(window: BrowserWindow, cursor: Point): void {
    const current = window.getBounds();
    let target: Rect | null = null;
    if (window.isMaximized()) {
      window.unmaximize();
      target = window.getNormalBounds();
    } else {
      const before = this.beforeSnap.get(window.id);
      if (before) {
        target = before;
      }
    }
    this.beforeSnap.delete(window.id);
    if (!target) {
      return;
    }
    const ratio = current.width > 0 ? (cursor.x - current.x) / current.width : 0.5;
    window.setBounds({
      x: Math.round(cursor.x - ratio * target.width),
      y: Math.round(cursor.y - RESTORED_GRAB_Y_PX),
      width: target.width,
      height: target.height,
    });
  }
}
