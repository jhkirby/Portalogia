// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { join } from 'node:path';
import { app, type BrowserWindow, WebContentsView } from 'electron';
import { FIND_BAR_HEIGHT_PX, FIND_BAR_MARGIN_PX, FIND_BAR_WIDTH_PX } from '@shared/constants';
import { IpcChannel, type FindBarState } from '@shared/ipc-contract';
import {
  findGotoRequestSchema,
  findInputRequestSchema,
  findStepRequestSchema,
} from '@shared/ipc-schemas';
import type { FindOptions } from '@shared/find';

/** A rectangle in window coordinates, the same space `WebContentsView.setBounds` uses. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the bar's own page asks of main. */
export interface FindOverlayHandlers {
  /** The query or a switch changed. */
  readonly onInput: (query: string, options: FindOptions) => void;
  /** Step to the next (`1`) or previous (`-1`) match. */
  readonly onStep: (direction: 1 | -1) => void;
  /** Jump to a typed, 1-based occurrence number. */
  readonly onGoTo: (index: number) => void;
  /** Close the bar. */
  readonly onClose: () => void;
}

/**
 * Owns the find bar (Ctrl+F) as its own small, persistent
 * `WebContentsView`, for the reason `SuggestionsOverlay` gives: whichever
 * tab is showing has its own native view, which always paints above the
 * chrome's HTML, so a bar drawn by the chrome could never float over the
 * page. It's a second native view instead, stacked above the tab views
 * (`TabManager` pins every tab view to index 0, so this one — added without
 * an index — stays on top) and sized to just the bar, tucked into the top-right
 * corner of the area the tab occupies, so the rest of the page stays live
 * and clickable around it. One bar serves every kind of tab: it only draws
 * and reports input; `TabManager` runs the actual search in whichever tab is active.
 */
export class FindOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;
  private latestState: FindBarState | null = null;
  private isLoaded = false;

  /**
   * @param window The chrome window this overlay's view mounts into/out of.
   * @param handlers What to do when the bar's page reports input.
   */
  public constructor(
    private readonly window: BrowserWindow,
    handlers: FindOverlayHandlers,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/find.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // Trusted, app-owned content (same reasoning as every other overlay).
    this.view.webContents.on('will-navigate', (event) => event.preventDefault());
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.setBorderRadius(6);

    // Scoped to this view's own webContents, so a second window's bar never hears this one's.
    const ipc = this.view.webContents.ipc;
    ipc.on(IpcChannel.FindInput, (_event, raw: unknown) => {
      const parsed = findInputRequestSchema.safeParse(raw);
      if (parsed.success) {
        handlers.onInput(parsed.data.query, parsed.data.options);
      }
    });
    ipc.on(IpcChannel.FindStep, (_event, raw: unknown) => {
      const parsed = findStepRequestSchema.safeParse(raw);
      if (parsed.success) {
        handlers.onStep(parsed.data);
      }
    });
    ipc.on(IpcChannel.FindGoto, (_event, raw: unknown) => {
      const parsed = findGotoRequestSchema.safeParse(raw);
      if (parsed.success) {
        handlers.onGoTo(parsed.data);
      }
    });
    ipc.on(IpcChannel.FindClose, () => handlers.onClose());

    // A page that finished loading after a state was pushed would have missed it.
    this.view.webContents.on('did-finish-load', () => {
      this.isLoaded = true;
      if (this.latestState) {
        this.view.webContents.send(IpcChannel.FindState, this.latestState);
      }
    });

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void this.view.webContents.loadURL(`${devServerUrl}/find.html`);
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/find.html'));
    }
  }

  /**
   * Shows the bar in the top-right corner of the area a tab occupies, or
   * moves it there again after the window or sidebar resized.
   * @param main The bounds the active tab's view occupies.
   */
  public show(main: Rect): void {
    const width = Math.min(FIND_BAR_WIDTH_PX, Math.max(0, main.width - 2 * FIND_BAR_MARGIN_PX));
    const bounds: Rect = {
      x: Math.round(main.x + main.width - width - FIND_BAR_MARGIN_PX),
      y: Math.round(main.y + FIND_BAR_MARGIN_PX),
      width: Math.round(width),
      height: FIND_BAR_HEIGHT_PX,
    };
    if (!this.isMounted) {
      // No index: it lands at the end of the child-view stack, i.e. on top.
      this.window.contentView.addChildView(this.view);
      this.isMounted = true;
    }
    this.view.setBounds(bounds);
  }

  /** Unmounts the bar's view, if shown — rather than shrinking it, so a closed bar can never swallow a click meant for the page. */
  public hide(): void {
    if (this.isMounted) {
      this.window.contentView.removeChildView(this.view);
      this.isMounted = false;
    }
  }

  /** Re-adds the view on top of everything — call after something else was added above it. */
  public raise(): void {
    if (this.isMounted) {
      this.window.contentView.addChildView(this.view);
    }
  }

  /** Pushes what the bar should show. Held until the page has loaded if it hasn't yet. */
  public sync(state: FindBarState): void {
    this.latestState = state;
    if (this.isLoaded && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send(IpcChannel.FindState, state);
    }
  }

  /** Gives the bar the keyboard and has it select its query, ready to be typed over. */
  public focus(): void {
    if (this.isMounted && !this.view.webContents.isDestroyed()) {
      this.view.webContents.focus();
      this.view.webContents.send(IpcChannel.FindFocus);
    }
  }

  /** @returns Whether the bar is currently showing. */
  public get isShown(): boolean {
    return this.isMounted;
  }

  /** Removes the bar's view for good — call this when the owning window closes. */
  public dispose(): void {
    this.hide();
  }
}
