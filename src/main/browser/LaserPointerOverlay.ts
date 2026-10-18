// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';

/** One wheel tick over the overlay, in the overlay's own (= the tab's) coordinates. */
export interface LaserPointerWheel {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
}

/** Validates an IPC payload at the boundary — the sender is our own preload, but never trust the shape. */
function isWheel(value: unknown): value is LaserPointerWheel {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return ['x', 'y', 'deltaX', 'deltaY'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]));
}

/**
 * Owns the laser pointer's own `WebContentsView` — a transparent overlay
 * covering the active tab's entire content area while the tool is on
 * (Ctrl+I, or `PageActions`' toolbar button), the same "second native view
 * stacked above the tab" approach `ColorPickerOverlay`/`TooltipOverlay`/
 * `SuggestionsOverlay` use, for the same reason: the chrome's own HTML can
 * never paint above a tab's live `WebContentsView`, only another native
 * view can.
 *
 * Unlike those three, this overlay is never a small, opaque panel — it's
 * sized to the *whole* main content area (`TabManager.computeMainBounds`)
 * and its background is transparent (`setBackgroundColor`, paired with
 * transparent CSS in its own page), so the live page underneath keeps
 * showing through everywhere except the dot/streak it draws. That also
 * means it necessarily swallows every mouse event over that area for as
 * long as it's mounted — there's no per-view click-through in Electron —
 * which is the intended behavior for a presentation pointer: the page
 * isn't meant to be interacted with while it's on. The toolbar button and
 * Ctrl+I both still work regardless, since the toolbar lives above this
 * overlay's bounds, not inside them.
 *
 * The overlay's own page needs nothing pushed to it: it reads the current
 * accent color straight out of `localStorage` (`watchAccentColor`'s own
 * mechanism, shared by every other overlay page) and owns all of its mouse
 * tracking/animation locally, so unlike its siblings this class has no
 * `sync` payload and no preload/IPC channel of its own — it's purely
 * mount, position, and unmount.
 */
export class LaserPointerOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;

  /**
   * @param window The chrome window this overlay's view mounts into/out of.
   * @param onEscape Called when Escape is pressed while this overlay's own
   *   view has OS keyboard focus — which it does the moment a person clicks
   *   anywhere on it, exactly what it's designed to swallow every one of
   *   (see this class's own doc comment). Without this, that click hands
   *   native keyboard focus to a view with no input handling of its own at
   *   all, so Escape (or any other key) would otherwise reach neither the
   *   underlying tab's `wireSharedInputHandling` nor the chrome's own
   *   belt-and-suspenders listener — it would just go nowhere. Ctrl+I (the
   *   pointer's own toggle) calls it too.
   * @param onWheel Called with each wheel tick over the overlay, to scroll the tab beneath.
   */
  public constructor(
    private readonly window: BrowserWindow,
    onEscape: () => void,
    onWheel: (wheel: LaserPointerWheel) => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/laserPointer.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // Trusted, app-owned content — same reasoning as `SuggestionsOverlay`'s
    // own view.
    // Scrolling stays available while the pointer is on: the overlay's
    // preload relays each wheel tick and the owner replays it on the tab.
    this.view.webContents.ipc.on('laser-pointer:wheel', (event, payload: unknown) => {
      if (event.senderFrame !== this.view.webContents.mainFrame || !isWheel(payload)) {
        return;
      }
      onWheel(payload);
    });

    this.view.webContents.on('will-navigate', (event) => event.preventDefault());
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    this.view.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        !input.isAutoRepeat &&
        !input.control &&
        !input.meta &&
        !input.alt &&
        !input.shift &&
        input.key === 'Escape'
      ) {
        event.preventDefault();
        onEscape();
        return;
      }
      // Ctrl+I's menu entry is display-only (see buildMenu.ts), so it no longer reaches past this view on its own:
      // pressed here, it turns the pointer off, as it would anywhere else.
      if (
        input.type === 'keyDown' &&
        !input.isAutoRepeat &&
        (input.control || input.meta) &&
        !input.alt &&
        !input.shift &&
        input.key.toLowerCase() === 'i'
      ) {
        event.preventDefault();
        onEscape();
      }
    });

    // Lets the active tab's own content keep showing through everywhere
    // this overlay's page doesn't itself paint — see this class's own doc
    // comment. Paired with transparent `html`/`body` CSS on the page side
    // (laser-pointer-overlay.css); without both halves, one or the other
    // still composites as opaque.
    this.view.setBackgroundColor('#00000000');

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void this.view.webContents.loadURL(`${devServerUrl}/laser-pointer.html`);
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/laser-pointer.html'));
    }
  }

  /**
   * Mounts (or re-bounds) the overlay atop the active tab view when `active`
   * is true, sized to exactly `bounds` — the same rect `TabManager` gives
   * the active tab's own view (`computeMainBounds`), so the pointer covers
   * precisely the page area and nothing of the chrome. Unmounts entirely
   * when `active` is false, rather than merely shrinking to zero, so a
   * turned-off pointer can never intercept a click meant for the page
   * beneath it — same reasoning as every sibling overlay's `hide`.
   * @param active Whether the laser pointer should be shown right now.
   * @param bounds The active tab's own current bounds — call this again
   *   with a fresh value on every resize/sidebar-toggle/Focus-Mode frame
   *   `TabManager.applyBounds` already recomputes for the tab view itself,
   *   so the overlay never drifts out of alignment with it.
   */
  public setActive(active: boolean, bounds: { x: number; y: number; width: number; height: number }): void {
    if (!active) {
      this.hide();
      return;
    }
    if (!this.isMounted) {
      // No index given, so it lands at the end of the child-view stack —
      // i.e. on top — same as every sibling overlay's own `addChildView` call.
      this.window.contentView.addChildView(this.view);
      this.isMounted = true;
    }
    this.view.setBounds(bounds);
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
