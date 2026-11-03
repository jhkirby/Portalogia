// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import { IpcChannel, type SecretPromptAnswer, type SecretPromptOffer } from '@shared/ipc-contract';
import { secretPromptAnswerSchema } from '@shared/ipc-schemas';

/** The card's width, in CSS pixels; its height is the card's own, as its page reports it. */
const PROMPT_WIDTH_PX = 340;
/**
 * How far in from the page area's top-right corner the card sits. The view itself reaches the area's right edge, the
 * card held this far in by its own margin (`secret-prompt.css` — keep in sync), so it slides in from the page's edge
 * rather than appearing out of thin air partway across it.
 */
const PROMPT_MARGIN_PX = 12;
/** The tallest the page may make its view: a page reporting more is held to this. */
const MAX_PROMPT_HEIGHT_PX = 480;

/** A rectangle in the window's content coordinates. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The "save this login?" prompt, in the top-right corner of the page area as
 * Chrome's is: its own small `WebContentsView` stacked above the tab's (a
 * tab's view always paints above chrome HTML, as `ExportMenuOverlay`
 * explains), so the page beside and beneath it stays live — unlike the
 * bookmark popup, which stands in for the page with a still.
 *
 * It never takes the keyboard: the prompt can come up while a page is still
 * being typed into (a login form that stays put), and stealing focus there
 * would send the next keys somewhere unexpected.
 */
export class SecretPromptOverlay {
  private readonly view: WebContentsView;
  private isMounted = false;
  private offer: SecretPromptOffer | null = null;
  private shownForTab: string | null = null;
  private area: Rect | null = null;
  /** The card's height as its page last reported it; 0 until it has drawn one. */
  private height = 0;

  /**
   * @param window The chrome window this overlay's view mounts into/out of.
   * @param onAnswer Called with the prompt's answer (save, or not), once; the prompt has closed by then.
   */
  public constructor(
    private readonly window: BrowserWindow,
    private readonly onAnswer: (answer: SecretPromptAnswer) => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/secretPrompt.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    this.view.webContents.on('will-navigate', (event) => event.preventDefault());
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Transparent, with the card's rounded border drawn in CSS — see `ExportMenuOverlay`.
    this.view.setBackgroundColor('#00000000');

    // Scoped to this view's own webContents, so another window's prompt stays separate.
    this.view.webContents.ipc.on(IpcChannel.SecretPromptAnswer, (_event, rawAnswer: unknown) => {
      const parsed = secretPromptAnswerSchema.safeParse(rawAnswer);
      if (parsed.success && this.offer && parsed.data.id === this.offer.id) {
        this.clear();
        this.onAnswer(parsed.data);
      }
    });
    this.view.webContents.ipc.on(IpcChannel.SecretPromptHeight, (_event, rawHeight: unknown) => {
      if (typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0) {
        this.height = Math.min(Math.ceil(rawHeight), MAX_PROMPT_HEIGHT_PX);
        this.place();
      }
    });

    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devServerUrl) {
      void this.view.webContents.loadURL(`${devServerUrl}/secret-prompt.html`);
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/secret-prompt.html'));
    }
  }

  /** The tab the prompt is up for, or `null` when it isn't up. */
  public get tabId(): string | null {
    return this.shownForTab;
  }

  /** The offer on show, or `null`. */
  public get offerId(): string | null {
    return this.offer?.id ?? null;
  }

  /**
   * Puts the prompt up, replacing any offer already on show (whose answer is then never given).
   * @param tabId The tab whose login it offers to save.
   * @param offer What to offer.
   * @param area The page area's bounds, whose top-right corner it sits in.
   */
  public show(tabId: string, offer: SecretPromptOffer, area: Rect): void {
    this.offer = offer;
    this.shownForTab = tabId;
    this.area = area;
    this.view.webContents.send(IpcChannel.SecretPromptShow, offer);
    this.place();
  }

  /**
   * Follows the page area as it moves or resizes (the sidebar sliding, the window resizing).
   * @param area The page area's new bounds.
   */
  public layout(area: Rect): void {
    if (this.offer) {
      this.area = area;
      this.place();
    }
  }

  /** Takes the prompt down without an answer. */
  public clear(): void {
    this.offer = null;
    this.shownForTab = null;
    this.view.webContents.send(IpcChannel.SecretPromptShow, null);
    this.unmount();
  }

  /** Removes the overlay's view for good — call when the owning window closes. */
  public dispose(): void {
    this.unmount();
  }

  /** Mounts the view in the corner once the card has a height (its page has drawn the offer); before that there's nothing to show. */
  private place(): void {
    if (!this.offer || !this.area || this.height === 0) {
      return;
    }
    const width = Math.min(PROMPT_WIDTH_PX + PROMPT_MARGIN_PX, Math.max(0, this.area.width - PROMPT_MARGIN_PX));
    this.view.setBounds({
      x: Math.round(this.area.x + this.area.width - width),
      y: Math.round(this.area.y + PROMPT_MARGIN_PX),
      width,
      height: Math.min(this.height, Math.max(0, this.area.height - 2 * PROMPT_MARGIN_PX)),
    });
    if (!this.isMounted) {
      // No index: lands on top of the stack, above every tab view.
      this.window.contentView.addChildView(this.view);
      this.isMounted = true;
    }
  }

  private unmount(): void {
    if (this.isMounted) {
      this.window.contentView.removeChildView(this.view);
      this.isMounted = false;
    }
  }
}
