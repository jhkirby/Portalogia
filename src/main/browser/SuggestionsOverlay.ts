// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import {
  ADDRESS_SUGGESTIONS_BORDER_PX,
  ADDRESS_SUGGESTIONS_MAX_ROWS,
  ADDRESS_SUGGESTIONS_PADDING_PX,
  ADDRESS_SUGGESTION_ROW_HEIGHT_PX,
  MENU_FADE_MS,
} from '@shared/constants';
import {
  IpcChannel,
  type AddressSuggestionsSyncPayload,
} from '@shared/ipc-contract';
import { addressSuggestionSelectRequestSchema } from '@shared/ipc-schemas';

/**
 * Owns the address bar's suggestions dropdown as its own small, persistent
 * `WebContentsView` — deliberately not chrome-drawn HTML. Whichever tab is
 * active has its own `WebContentsView`, a native surface that always
 * paints above the chrome's own HTML (see `TabManager`'s class doc
 * comment), so a chrome-rendered dropdown could never appear visually on
 * top of a *live* page short of hiding that page's view first — the
 * approach this class exists to avoid. It's a second native view instead,
 * stacked above the active tab view (see `TabManager`'s `addChildView`
 * calls, which pin every tab view to index 0 so this one — added without
 * an index, always the topmost — stays above them) and sized to exactly
 * the dropdown's own small rectangle via `sync`, never the whole page.
 * Everywhere outside that rectangle, the tab's view is untouched: still
 * live, still interactive, still animating, exactly as if the address bar
 * didn't exist. The only thing that ever couples the two is a click inside
 * this view, relayed back up to the chrome via `onSelect`.
 */
export class SuggestionsOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;
  /** Set while the list fades out (`hide`): its view comes off the window when it fires. */
  private unmountTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param window The chrome window this overlay's view mounts into/out of.
   * @param onSelect Called with the index of whichever suggestion row was
   *   clicked in the overlay's own page — forwarded up to the chrome's
   *   address bar, the only thing that actually knows what that index
   *   refers to.
   */
  public constructor(
    private readonly window: BrowserWindow,
    onSelect: (index: number) => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/suggestions.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // See-through, so only the list's own rounded box shows: the view itself is a plain rectangle.
    this.view.setBackgroundColor('#00000000');

    // Trusted, app-owned content (same reasoning as a terminal tab's own
    // view — see `TabManager.createTerminalTab`): it should never navigate
    // away from itself or spawn a bare OS window.
    this.view.webContents.on('will-navigate', (event) => event.preventDefault());
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Rounds the view's own painted surface at the OS compositor level —
    // must match `--size-radius-sm` (sizes.css). Chromium clips the
    // corners beyond this radius from the view's rendered output entirely,
    // letting whatever's underneath (the live tab) show through there, so
    // the rest of this box can stay a plain opaque rectangle in its own
    // CSS with no transparency or background-alpha needed.
    this.view.setBorderRadius(6);

    // Scoped to this view's own webContents (`WebContents#ipc`, not the
    // global `ipcMain`) — a second window's own `SuggestionsOverlay` sends
    // the same channel from its own, entirely separate view, and each
    // instance should only ever react to its own.
    this.view.webContents.ipc.on(IpcChannel.AddressSuggestionsSelect, (_event, rawIndex: unknown) => {
      const parsed = addressSuggestionSelectRequestSchema.safeParse(rawIndex);
      if (parsed.success) {
        onSelect(parsed.data);
      }
    });

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void this.view.webContents.loadURL(`${devServerUrl}/suggestions.html`);
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/suggestions.html'));
    }
  }

  /**
   * Applies the address bar's latest sync: opens the dropdown (mounting
   * the view atop the currently visible tab view(s), sized to the
   * dropdown's own rectangle) or closes it (unmounting entirely, rather
   * than merely shrinking to zero, so a closed dropdown can never
   * intercept a click meant for the page beneath it) — always pushing the
   * current suggestion list and keyboard-selected index down to the
   * view's own page either way, since a still-open dropdown re-syncs on
   * every keystroke that changes its matches.
   * @param payload The address bar's current dropdown state.
   */
  public sync(payload: AddressSuggestionsSyncPayload): void {
    if (!payload.open || !payload.rect || payload.suggestions.length === 0) {
      this.hide();
      return;
    }

    // Reopened while fading out: it stays up, and fades back in.
    this.cancelUnmount();
    if (!this.isMounted) {
      // No index given, so it lands at the end of the child-view stack —
      // i.e. on top — same as re-adding an already-present view always
      // reorders it to the top (see the `View.addChildView` doc comment).
      this.window.contentView.addChildView(this.view);
      this.isMounted = true;
    }

    // As tall as the list, up to `ADDRESS_SUGGESTIONS_MAX_ROWS` rows; a longer list scrolls inside it.
    const rows = Math.min(payload.suggestions.length, ADDRESS_SUGGESTIONS_MAX_ROWS);
    const height = rows * ADDRESS_SUGGESTION_ROW_HEIGHT_PX + 2 * (ADDRESS_SUGGESTIONS_PADDING_PX + ADDRESS_SUGGESTIONS_BORDER_PX);
    this.view.setBounds({
      x: Math.round(payload.rect.left),
      y: Math.round(payload.rect.top),
      width: Math.round(payload.rect.width),
      height,
    });

    this.view.webContents.send(IpcChannel.AddressSuggestionsSync, payload);
  }

  /**
   * Takes the list off the window once its page has faded it out (`MENU_FADE_MS`), rather than at once.
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

  /** Removes the overlay's view for good — call this when the owning window closes. */
  public dispose(): void {
    this.hide(true);
  }
}
