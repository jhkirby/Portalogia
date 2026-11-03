// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

/**
 * How far a web page's load has got, for the address bar's progress line and
 * percentage. Chromium doesn't report a load's progress to Electron, and no
 * byte total is known up front (a page's images, scripts and styles are found
 * as it loads), so it's estimated the way browsers long did: from the page's
 * own requests, as the share of those started that have finished.
 *
 * Fed by the session's web-request events (`index.ts`), which say only which
 * `webContents` a request belongs to; each tab's page subscribes by that id
 * while it loads (`TabManager.wireEvents`).
 */

/** Where a load starts once it's under way: something has visibly begun. */
const START_PERCENT = 5;
/** The most an estimate reaches before the page says it has finished: the rest is the page's own word. */
const MAX_ESTIMATE_PERCENT = 95;
/** The least time between two reports for one page, so a page fetching hundreds of files doesn't flood the chrome. */
const REPORT_INTERVAL_MS = 60;

interface Load {
  started: number;
  finished: number;
  percent: number;
  lastReport: number;
  readonly onProgress: (percent: number) => void;
}

const loads = new Map<number, Load>();

/**
 * Starts following a page's load. Replaces any load the page had under way.
 * @param webContentsId The page's `webContents`.
 * @param onProgress Called with the estimated percentage (whole, rising) as the load goes on.
 */
export function beginLoad(webContentsId: number, onProgress: (percent: number) => void): void {
  loads.set(webContentsId, { started: 0, finished: 0, percent: START_PERCENT, lastReport: 0, onProgress });
  onProgress(START_PERCENT);
}

/**
 * Stops following a page's load (it finished, failed or was stopped). Says nothing: the page reports its own end.
 * @param webContentsId The page's `webContents`.
 */
export function endLoad(webContentsId: number): void {
  loads.delete(webContentsId);
}

/**
 * Reports a load's new estimate if it rose to a new whole percent and the last report isn't too recent.
 * @param load The load.
 * @param now The time, in ms.
 */
function update(load: Load, now: number): void {
  const share = load.started === 0 ? 0 : load.finished / load.started;
  const percent = Math.max(load.percent, Math.min(MAX_ESTIMATE_PERCENT, Math.round(START_PERCENT + share * (MAX_ESTIMATE_PERCENT - START_PERCENT))));
  if (percent > load.percent && now - load.lastReport >= REPORT_INTERVAL_MS) {
    load.percent = percent;
    load.lastReport = now;
    load.onProgress(percent);
  }
}

/**
 * A page sent a request.
 * @param webContentsId The page's `webContents` (requests from anything else are ignored).
 * @param now The time, in ms; injectable for tests.
 */
export function requestStarted(webContentsId: number | undefined, now: number = Date.now()): void {
  const load = webContentsId === undefined ? undefined : loads.get(webContentsId);
  if (load) {
    load.started += 1;
    update(load, now);
  }
}

/**
 * A page's request finished, or failed.
 * @param webContentsId The page's `webContents`.
 * @param now The time, in ms; injectable for tests.
 */
export function requestFinished(webContentsId: number | undefined, now: number = Date.now()): void {
  const load = webContentsId === undefined ? undefined : loads.get(webContentsId);
  if (load) {
    load.finished = Math.min(load.started, load.finished + 1);
    update(load, now);
  }
}
