// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebContentsView, type BrowserWindow, type NativeImage, type Rectangle } from 'electron';
import { THEME_FADE_MS } from '@shared/constants';


/** How long the snapshot waits, after the theme is switched under it, for the pages to repaint in the new one. */
const SETTLE_MS = 120;

/** If the theme never arrives after the snapshot is up (the renderer failed), the snapshot fades anyway after this. */
const THEME_TIMEOUT_MS = 2000;

/** How long the snapshot's own page may take to load before the switch goes ahead without it. */
const LOAD_TIMEOUT_MS = 800;

/** JPEG quality of a web page's picture: plenty for a picture that's fading away, and far quicker to pass than PNG. */
const SNAPSHOT_QUALITY = 90;

/**
 * One piece of the snapshot: an image of a view, where it sits in the window, and whether it may have see-through
 * parts (a tab's page leaves its margin unpainted), which must stay see-through: a JPEG would turn them black.
 */
interface Piece {
  readonly image: NativeImage;
  readonly bounds: Rectangle;
  readonly transparent: boolean;
}

/** The new-tab page: it fades itself (its own stylesheet, `homePage.ts`), so it keeps its fluid moving. */
const HOME_PAGE_PREFIX = 'portalogia://home';

/** Where this app's own pages are served from while developing; built, they're `file:` pages. */
const DEV_PAGE_ORIGIN = (() => {
  try {
    return process.env['ELECTRON_RENDERER_URL'] ? new URL(process.env['ELECTRON_RENDERER_URL']).origin : null;
  } catch {
    return null;
  }
})();

/** Whether a view's page is the terminal's. */
function isTerminalPage(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/terminal.html');
  } catch {
    return false;
  }
}

/**
 * Whether a view needs the snapshot to fade: a web page, or the terminal. The app's other pages (a note, a PDF,
 * History, the overlays) and the new-tab page fade themselves.
 * @param url The view's page.
 */
function needsSnapshot(url: string): boolean {
  if (isTerminalPage(url)) {
    return true;
  }
  if (url.startsWith(HOME_PAGE_PREFIX)) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin !== DEV_PAGE_ORIGIN;
  } catch {
    return false;
  }
}

/** A crossfade in progress in one window. */
interface Fade {
  readonly view: WebContentsView;
  /** The snapshot's page on disk, removed with it. */
  readonly file: string;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Fades what the app's own stylesheets can't from one theme to the other: a
 * web page and the terminal (whose colours are its own, drawn at once).
 * Each such view the window shows is captured as it is, and the pictures laid
 * over them as one snapshot in a view of its own, above everything. The theme
 * then changes underneath, and the snapshot fades away (`THEME_FADE_MS`).
 * The chrome and the app's own pages fade themselves, live (`themeFade.ts`),
 * so nothing that moves on them — the metal, the fluids, the new-tab page's —
 * stops for it.
 */
export class ThemeCrossfade {
  private readonly fades = new Map<BrowserWindow, Fade>();

  /**
   * Captures the window and lays the snapshot over it. Resolves once it's
   * showing (or once it's given up on), for the theme to be switched.
   * @param window The window about to change theme.
   */
  public async prepare(window: BrowserWindow): Promise<void> {
    this.finish(window);
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) {
      return;
    }
    const [width = 0, height = 0] = window.getContentSize();
    const children = window.contentView.children.filter(
      (child): child is WebContentsView =>
        child instanceof WebContentsView && child.getVisible() && !child.webContents.isDestroyed() && needsSnapshot(child.webContents.getURL()),
    );
    if (children.length === 0) {
      return;
    }
    let pieces: Piece[];
    try {
      pieces = (
        await Promise.all(
          children.map(async (child) => ({
            image: await child.webContents.capturePage(),
            bounds: child.getBounds(),
            // The terminal's page leaves its margin see-through; a web page fills its view.
            transparent: isTerminalPage(child.webContents.getURL()),
          })),
        )
      ).filter((piece) => !piece.image.isEmpty());
    } catch {
      return;
    }
    if (pieces.length === 0) {
      return;
    }
    if (window.isDestroyed()) {
      return;
    }
    const view = new WebContentsView({
      // Script stays on only so main can wait for the page to paint (`executeJavaScript` below); the page has none.
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    view.setBackgroundColor('#00000000');
    view.setBounds({ x: 0, y: 0, width, height });
    window.contentView.addChildView(view);
    // On disk rather than in a `data:` URL, which can't carry a window's worth of pictures (Chromium caps URLs at 2 MB).
    const file = join(tmpdir(), `portalogia-theme-fade-${randomUUID()}.html`);
    const fade: Fade = { view, file, timer: null };
    this.fades.set(window, fade);
    // Fades by itself if the theme never comes.
    fade.timer = setTimeout(() => this.fadeOut(window), THEME_TIMEOUT_MS);
    const loaded = new Promise<void>((resolve) => {
      view.webContents.once('did-finish-load', () => resolve());
      setTimeout(resolve, LOAD_TIMEOUT_MS);
    });
    try {
      await writeFile(file, snapshotPage(pieces), 'utf-8');
      void view.webContents.loadFile(file).catch(() => {});
      await loaded;
      // Loaded isn't yet drawn: the theme must not change under it until its pictures are on screen, or the new
      // theme flashes before the old one comes back to fade.
      await Promise.race([
        view.webContents
          .executeJavaScript(
            'Promise.all([...document.images].map((i) => i.decode().catch(() => {})))' +
              '.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))',
          )
          .catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS)),
      ]);
    } catch {
      this.finish(window);
    }
  }

  /**
   * The theme has been switched under the snapshot: once the pages have
   * repainted, it fades away.
   * @param window The window whose theme changed.
   */
  public themeChanged(window: BrowserWindow): void {
    const fade = this.fades.get(window);
    if (!fade) {
      return;
    }
    if (fade.timer !== null) {
      clearTimeout(fade.timer);
    }
    fade.timer = setTimeout(() => this.fadeOut(window), SETTLE_MS);
  }

  /** Starts the snapshot fading, and takes it down once it's gone. */
  private fadeOut(window: BrowserWindow): void {
    const fade = this.fades.get(window);
    if (!fade) {
      return;
    }
    if (!fade.view.webContents.isDestroyed()) {
      // The page runs no script of its own; the fade is a style switched on from here.
      void fade.view.webContents
        .insertCSS(`body { opacity: 0 !important; transition: opacity ${THEME_FADE_MS}ms ease-in-out; }`)
        .catch(() => {});
    }
    fade.timer = setTimeout(() => this.finish(window), THEME_FADE_MS + 60);
  }

  /** Takes a window's snapshot down at once, if it has one. */
  private finish(window: BrowserWindow): void {
    const fade = this.fades.get(window);
    if (!fade) {
      return;
    }
    this.fades.delete(window);
    if (fade.timer !== null) {
      clearTimeout(fade.timer);
    }
    if (!window.isDestroyed()) {
      window.contentView.removeChildView(fade.view);
    }
    if (!fade.view.webContents.isDestroyed()) {
      fade.view.webContents.close();
    }
    void rm(fade.file, { force: true }).catch(() => {});
  }
}

/**
 * The snapshot's page: each piece's picture at its place in the window, the
 * views in their order, bottom first.
 * @param pieces The pictures, bottom first.
 */
function snapshotPage(pieces: readonly Piece[]): string {
  const images = pieces
    .map(({ image, bounds, transparent }) => {
      const source = transparent
        ? `data:image/png;base64,${image.toPNG().toString('base64')}`
        : `data:image/jpeg;base64,${image.toJPEG(SNAPSHOT_QUALITY).toString('base64')}`;
      return `<img src="${source}" style="left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px">`;
    })
    .join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">" +
    '<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}' +
    'img{position:absolute;display:block;user-select:none;-webkit-user-drag:none}</style>' +
    `</head><body>${images}</body></html>`
  );
}
