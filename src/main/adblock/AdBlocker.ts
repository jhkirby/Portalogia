// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { ipcMain, type Session } from 'electron';
import { ElectronBlocker, Request } from '@ghostery/adblocker-electron';
import type { AdBlockState } from '@shared/ipc-contract';
import type { AdBlockStore } from './AdBlockStore';
import { stripTrackingParams } from './trackingParams';

/** A downloaded filter engine older than this is thrown away and fetched again. */
const ENGINE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** More than this many popups from one page within the window count as spam. */
const POPUP_BURST_WINDOW_MS = 2000;
const POPUP_BURST_LIMIT = 2;

/** How often a burst of blocked requests is folded into one state push to the chrome. */
const NOTIFY_THROTTLE_MS = 250;

/** Takes over a response's headers (returning the replacement), or declines with `null`. */
export type HeadersInterceptor = (
  details: Electron.OnHeadersReceivedListenerDetails,
) => Electron.HeadersReceivedResponse | null;

/** @returns The hostname of a URL, or `''` if it has none. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Blocks ads, trackers, and annoyances for every tab, in five ways:
 *  1. network filters (EasyList, EasyPrivacy, uBlock's lists, cookie-notice
 *     lists) cancel the request before it leaves;
 *  2. cosmetic filters hide what's left of an ad's slot, and scriptlets stop
 *     scripted ads (e.g. a video site's pre-roll);
 *  3. popups to ad hosts, and bursts of popups, are dropped;
 *  4. tracking query parameters (`utm_*`, `fbclid`, ...) are stripped from
 *     page navigations;
 *  5. every request says "Do Not Track" and "Global Privacy Control".
 * Blocking is switchable globally and per site (`AdBlockStore`).
 *
 * Electron allows one listener per `webRequest` event, so this class owns
 * `onHeadersReceived` for the whole session and lets other code (the chrome's
 * CSP) hook in through `addHeadersInterceptor` rather than competing for it.
 */
export class AdBlocker {
  private blocker: ElectronBlocker | null = null;
  private session: Session | null = null;
  private readonly interceptors: HeadersInterceptor[] = [];
  private readonly blockedByContents = new Map<number, number>();
  private readonly popupTimes = new Map<number, number[]>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param store The user's settings.
   * @param enginePath Where the compiled filter engine is cached between runs.
   * @param tabIdOf Maps a `webContents` id to the tab showing it, so counts can be reported per tab.
   * @param onChange Called (throttled) when the state the chrome shows has changed.
   */
  public constructor(
    private readonly store: AdBlockStore,
    private readonly enginePath: string,
    private readonly tabIdOf: (webContentsId: number) => string | undefined,
    private readonly onChange: () => void,
  ) {}

  /**
   * Hooks into a session straight away - so Do Not Track and the CSP chain
   * work from the first request - then loads the filter lists in the
   * background and starts blocking as soon as they're ready.
   */
  public async start(session: Session): Promise<void> {
    this.session = session;
    this.installSessionHooks();
    try {
      await this.loadEngine();
    } catch (error) {
      console.error('Ad blocker could not load its filter lists; continuing without network blocking', error);
    }
  }

  /**
   * Adds a handler that sees every response's headers before the blocker does.
   * @returns A function that removes it again.
   */
  public addHeadersInterceptor(interceptor: HeadersInterceptor): () => void {
    this.interceptors.push(interceptor);
    return () => {
      const index = this.interceptors.indexOf(interceptor);
      if (index >= 0) {
        this.interceptors.splice(index, 1);
      }
    };
  }

  /** @returns Everything the chrome shows about the blocker. */
  public getState(): AdBlockState {
    const blockedByTab: Record<string, number> = {};
    for (const [contentsId, count] of this.blockedByContents) {
      const tabId = this.tabIdOf(contentsId);
      if (tabId) {
        blockedByTab[tabId] = count;
      }
    }
    return { enabled: this.store.enabled, allowedSites: this.store.allowedSites, blockedByTab };
  }

  public setEnabled(enabled: boolean): void {
    this.store.setEnabled(enabled);
    this.notify(true);
  }

  public setSiteAllowed(host: string, allowed: boolean): void {
    this.store.setSiteAllowed(host, allowed);
    this.notify(true);
  }

  /**
   * Whether a page should be stopped from opening a popup.
   * @param url The popup's address.
   * @param opener The page that asked for it.
   * @param openerContentsId That page's `webContents` id, for counting bursts.
   */
  public shouldBlockPopup(url: string, opener: string, openerContentsId: number): boolean {
    if (!this.isActiveFor(opener)) {
      return false;
    }
    const now = Date.now();
    const recent = (this.popupTimes.get(openerContentsId) ?? []).filter((t) => now - t < POPUP_BURST_WINDOW_MS);
    recent.push(now);
    this.popupTimes.set(openerContentsId, recent);

    const isAdHost = this.blocker?.match(Request.fromRawDetails({ url, sourceUrl: opener, type: 'other' })).match === true;
    if (isAdHost || recent.length > POPUP_BURST_LIMIT) {
      this.count(openerContentsId);
      return true;
    }
    return false;
  }

  /** Forgets a closed page's counters. */
  public forget(webContentsId: number): void {
    this.blockedByContents.delete(webContentsId);
    this.popupTimes.delete(webContentsId);
  }

  /** @returns Whether blocking applies to a page at this address. */
  private isActiveFor(pageUrl: string): boolean {
    if (!this.store.enabled) {
      return false;
    }
    const host = hostOf(pageUrl);
    return host === '' || !this.store.isSiteAllowed(host);
  }

  private async loadEngine(): Promise<void> {
    await this.discardStaleEngine();
    await mkdir(dirname(this.enginePath), { recursive: true });
    const blocker = await ElectronBlocker.fromPrebuiltFull(fetch, {
      path: this.enginePath,
      read: async (path) => readFile(path),
      write: async (path, buffer) => writeFile(path, buffer),
    });
    this.wrap(blocker);
    this.blocker = blocker;
    if (this.session) {
      this.enableCosmeticFiltering(this.session, blocker);
      this.installSessionHooks();
    }
  }

  /**
   * Registers the page-side script that hides ad slots and runs scriptlets, and
   * the IPC it asks main through. The blocker's own `enableBlockingInSession`
   * isn't used: it needs `registerPreloadScript` (Electron 35+), and it would
   * claim `onHeadersReceived`, which this class owns.
   */
  private enableCosmeticFiltering(session: Session, blocker: ElectronBlocker): void {
    const preloadPath = createRequire(import.meta.url).resolve('@ghostery/adblocker-electron-preload');
    if (!session.getPreloads().includes(preloadPath)) {
      session.setPreloads([...session.getPreloads(), preloadPath]);
    }
    // Look the handlers up per call: `wrap` replaced them with ones that honor the switch and allowlist.
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url: string, msg) =>
      blocker.onInjectCosmeticFilters(event, url, msg),
    );
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) =>
      blocker.onIsMutationObserverEnabled(event),
    );
  }

  private async discardStaleEngine(): Promise<void> {
    try {
      const { mtimeMs } = await stat(this.enginePath);
      if (Date.now() - mtimeMs > ENGINE_MAX_AGE_MS) {
        await unlink(this.enginePath);
      }
    } catch {
      // No cache yet - the first load downloads the lists.
    }
  }

  /** Puts the on/off switch, the allowlist, and the counter in front of the engine's own handlers. */
  private wrap(blocker: ElectronBlocker): void {
    const onBeforeRequest = blocker.onBeforeRequest;
    blocker.onBeforeRequest = (details, callback) => {
      if (details.resourceType === 'mainFrame') {
        // A new page: its counter starts over, and tracking parameters come off its address.
        this.blockedByContents.delete(details.webContentsId ?? -1);
        this.notify();
        const cleaned = this.isActiveFor(details.url) ? stripTrackingParams(details.url) : null;
        callback(cleaned ? { redirectURL: cleaned } : {});
        return;
      }
      if (!this.isActiveFor(details.webContents?.getURL() ?? details.referrer)) {
        callback({});
        return;
      }
      onBeforeRequest(details, (response) => {
        if (response.cancel === true || response.redirectURL !== undefined) {
          this.count(details.webContentsId);
        }
        callback(response);
      });
    };

    const onInject = blocker.onInjectCosmeticFilters;
    blocker.onInjectCosmeticFilters = async (event, url, msg) => {
      // The preload runs in the chrome and its overlays too; only web pages are filtered.
      if (!/^https?:/i.test(url) || !this.isActiveFor(event.sender.getURL() || url)) {
        return;
      }
      await onInject(event, url, msg);
    };

    const onHeaders = blocker.onHeadersReceived;
    blocker.onHeadersReceived = (details, callback) => {
      if (!this.isActiveFor(details.webContents?.getURL() ?? details.referrer)) {
        callback({});
        return;
      }
      onHeaders(details, callback);
    };
  }

  /** Claims the `webRequest` events this class owns outright. */
  private installSessionHooks(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    session.webRequest.onHeadersReceived((details, callback) => {
      for (const interceptor of this.interceptors) {
        const response = interceptor(details);
        if (response) {
          callback(response);
          return;
        }
      }
      if (this.blocker) {
        this.blocker.onHeadersReceived(details, callback);
      } else {
        callback({});
      }
    });
    if (this.blocker) {
      const blocker = this.blocker;
      session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) =>
        blocker.onBeforeRequest(details, callback),
      );
    }
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      if (this.store.enabled && /^https?:/i.test(details.url)) {
        callback({ requestHeaders: { ...details.requestHeaders, DNT: '1', 'Sec-GPC': '1' } });
        return;
      }
      callback({ requestHeaders: details.requestHeaders });
    });
  }

  private count(webContentsId: number | undefined): void {
    if (webContentsId === undefined) {
      return;
    }
    this.blockedByContents.set(webContentsId, (this.blockedByContents.get(webContentsId) ?? 0) + 1);
    this.notify();
  }

  private notify(immediately = false): void {
    if (immediately) {
      if (this.notifyTimer) {
        clearTimeout(this.notifyTimer);
        this.notifyTimer = null;
      }
      this.onChange();
      return;
    }
    if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => {
        this.notifyTimer = null;
        this.onChange();
      }, NOTIFY_THROTTLE_MS);
    }
  }
}
