// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import { COLOR_PICKER_PANEL_HEIGHT_PX, COLOR_PICKER_PANEL_WIDTH_PX, FIND_BAR_SLIDE_MS } from '@shared/constants';
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
 *
 * Also unlike `SuggestionsOverlay`, this dropdown has to close itself when
 * the *live page* is clicked, not just on an Escape or a same-chrome-
 * process click elsewhere (`ColorPicker`'s own `mousedown` listener
 * already covers that half — see its doc comment). A click on the tab
 * happens in a third, entirely separate `WebContentsView` chrome's own DOM
 * never sees any event from, so this class watches for it directly: while
 * open, it subscribes to the *active* tab's own `webContents`' `'focus'`
 * event (which Electron fires the moment a real click routes OS input
 * focus to that view) and treats it exactly like an Escape — `sync` is
 * called again on the next tab switch too, so `watchActiveView` always
 * ends up listening to whichever view is actually active right now, not a
 * stale one left over from when the dropdown first opened.
 */
export class ColorPickerOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;
  /** Where the dropdown sits once it has slid in (and while open). */
  private target: { x: number; y: number } | null = null;
  /** Drives the slide in from, and out to, the window's right edge — the same movement as the find bar's. */
  private slideTimer: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;
  /** The closed state to hand the page once it has slid out — sent then, not at once, or it would empty itself mid-slide. */
  private closedPayload: ColorPickerSyncPayload | null = null;
  /** The active tab's view this instance is currently listening to for `'focus'` — see `watchActiveView`. `null` while closed or if there's no active tab at all. */
  private watchedTabView: WebContentsView | null = null;
  private readonly handleActiveViewFocused: () => void;

  /**
   * @param window The chrome window this overlay's view mounts into/out of.
   * @param onColorChange Called with every color the overlay's own page
   *   reports — forwarded up to the chrome's `ColorPicker`, which owns
   *   actually applying it (`--color-accent-rgb`, persistence, the recents
   *   list).
   * @param onCloseRequested Called whenever something asks this dropdown to
   *   close on its own — the overlay's own page reporting an Escape
   *   keypress (see `NorthstarColorPickerApi.requestClose`'s own doc
   *   comment for why the chrome can't just listen for that itself), or
   *   the active tab's view reporting a click (see this class's own doc
   *   comment). Either way, this class doesn't close itself — it just
   *   reports up to the chrome's `ColorPicker`, which owns the actual
   *   open/closed state and will sync back down once it's flipped.
   */
  public constructor(
    private readonly window: BrowserWindow,
    onColorChange: (payload: ColorPickerColorChangedPayload) => void,
    private readonly onCloseRequested: () => void,
  ) {
    this.handleActiveViewFocused = () => this.onCloseRequested();

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

    // Transparent view + CSS-drawn rounded border (color-picker.css), rather than native
    // `setBorderRadius`: the native clip cuts through a square CSS border and leaves its
    // corners disconnected — same fix as `ExportMenuOverlay`.
    this.view.setBackgroundColor('#00000000');

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
   * @param activeTabView The currently active tab's own view (`null` if
   *   there's no active tab at all) — watched for a `'focus'` event the
   *   whole time this dropdown is open; see this class's own doc comment.
   */
  public sync(payload: ColorPickerSyncPayload, activeTabView: WebContentsView | null): void {
    if (!payload.open || !payload.rect) {
      // The page draws nothing once told it's closed, so it hears that only after it has slid out of sight.
      this.closedPayload = payload;
      this.hide();
      this.watchActiveView(null);
      return;
    }
    this.closedPayload = null;

    const target = { x: Math.round(payload.rect.left), y: Math.round(payload.rect.top) };
    this.target = target;
    this.watchActiveView(activeTabView);
    const bounds = { ...target, width: COLOR_PICKER_PANEL_WIDTH_PX, height: COLOR_PICKER_PANEL_HEIGHT_PX };

    if (!this.isMounted) {
      // No index given, so it lands at the end of the child-view stack —
      // i.e. on top — same as `SuggestionsOverlay`'s own `addChildView` call.
      this.window.contentView.addChildView(this.view);
      this.isMounted = true;
      // Starts just past the window's right edge, which clips what is outside it, and slides in.
      this.view.setBounds({ ...bounds, x: this.window.getContentBounds().width });
      this.slideTo(target.x, false);
    } else if (this.isClosing) {
      // Reopened mid-close: reverse from wherever the slide had got to.
      this.isClosing = false;
      this.slideTo(target.x, false);
    } else if (this.slideTimer !== null) {
      // Mid-slide-in: aim at the new spot, so a resize doesn't leave it heading for a stale one.
      this.slideTo(target.x, false);
    } else {
      this.view.setBounds(bounds);
    }

    this.view.webContents.send(IpcChannel.ColorPickerSync, payload);
  }

  /** Moves the view's x toward `toX` over `FIND_BAR_SLIDE_MS`; unmounts it on arrival when `closing`. */
  private slideTo(toX: number, closing: boolean): void {
    this.stopSlide();
    const fromX = this.view.getBounds().x;
    const start = Date.now();
    this.slideTimer = setInterval(() => {
      if (this.view.webContents.isDestroyed() || !this.target) {
        this.stopSlide();
        return;
      }
      const t = Math.min(1, (Date.now() - start) / FIND_BAR_SLIDE_MS);
      const eased = 1 - (1 - t) ** 3;
      this.view.setBounds({
        x: Math.round(fromX + (toX - fromX) * eased),
        y: this.target.y,
        width: COLOR_PICKER_PANEL_WIDTH_PX,
        height: COLOR_PICKER_PANEL_HEIGHT_PX,
      });
      if (t >= 1) {
        this.stopSlide();
        if (closing) {
          this.unmount();
        }
      }
    }, 16);
  }

  private stopSlide(): void {
    if (this.slideTimer !== null) {
      clearInterval(this.slideTimer);
      this.slideTimer = null;
    }
  }

  /**
   * Points this instance's `'focus'` listener at `view` instead of
   * whatever it was watching before — a no-op if that's already the same
   * view (the common case: `sync` calls this on every push while open,
   * not just the first). Passing `null` just stops watching, for `sync`'s
   * own closed branch.
   */
  private watchActiveView(view: WebContentsView | null): void {
    if (this.watchedTabView === view) {
      return;
    }
    this.watchedTabView?.webContents.off('focus', this.handleActiveViewFocused);
    this.watchedTabView = view;
    view?.webContents.on('focus', this.handleActiveViewFocused);
  }

  /**
   * Slides the dropdown out to the right, then unmounts its view — rather
   * than shrinking it, so a closed dropdown can never swallow a click meant
   * for the page beneath it.
   * @param immediate Skip the slide, e.g. when the window is closing.
   */
  private hide(immediate = false): void {
    if (!this.isMounted) {
      this.flushClosedPayload();
      return;
    }
    if (this.isClosing) {
      return;
    }
    if (immediate || !this.target) {
      this.unmount();
      return;
    }
    this.isClosing = true;
    this.slideTo(this.window.getContentBounds().width, true);
  }

  /** Takes the overlay's view off the window, if currently shown. A no-op otherwise. */
  private unmount(): void {
    this.stopSlide();
    this.isClosing = false;
    if (this.isMounted) {
      this.window.contentView.removeChildView(this.view);
      this.isMounted = false;
    }
    this.flushClosedPayload();
  }

  /** Tells the page it is closed, if a closed state is waiting — once, after it is out of view. */
  private flushClosedPayload(): void {
    if (this.closedPayload && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send(IpcChannel.ColorPickerSync, this.closedPayload);
    }
    this.closedPayload = null;
  }

  /** Removes the overlay's view for good — call this when the owning window closes. */
  public dispose(): void {
    this.hide(true);
    this.watchActiveView(null);
  }
}
