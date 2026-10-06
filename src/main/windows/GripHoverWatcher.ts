// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { screen, type BrowserWindow } from 'electron';
import { TITLEBAR_GRIP_HEIGHT_PX } from '@shared/constants';
import { IpcChannel } from '@shared/ipc-contract';

/** How often, in ms, the cursor is checked while the window is maximized. */
const POLL_INTERVAL_MS = 40;

/**
 * Tells a window's chrome when the cursor is over its titlebar grip, but only
 * while the window is maximized. Then the grip is an OS drag region (see
 * `TitlebarGrip`), which receives no mouse events, so the page can't see a
 * hover itself. The cursor is checked here instead, a few times a second, and
 * only while maximized; the rest of the time the grip is an ordinary element
 * and reports its own hover.
 */
export class GripHoverWatcher {
  private timer: NodeJS.Timeout | null = null;
  private isHovering = false;

  /** @param window The window to watch. */
  public constructor(private readonly window: BrowserWindow) {
    window.on('maximize', () => this.start());
    window.on('unmaximize', () => this.stop());
    window.on('closed', () => this.stop());
    if (window.isMaximized()) {
      this.start();
    }
  }

  private start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    }
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.report(false);
  }

  private poll(): void {
    if (this.window.isDestroyed()) {
      this.stop();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const area = this.window.getContentBounds();
    this.report(
      this.window.isVisible() &&
        cursor.x >= area.x &&
        cursor.x < area.x + area.width &&
        cursor.y >= area.y &&
        cursor.y < area.y + TITLEBAR_GRIP_HEIGHT_PX,
    );
  }

  /** Sends the hover state to the chrome, but only when it has changed. */
  private report(hovering: boolean): void {
    if (hovering === this.isHovering) {
      return;
    }
    this.isHovering = hovering;
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannel.WindowGripHover, hovering);
    }
  }
}
