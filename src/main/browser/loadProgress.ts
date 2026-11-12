// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

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
 *
 * It counts the load's bytes too, for beside the percentage: each response's
 * size (its `Content-Length`) is added to the total when the response starts,
 * and to the loaded bytes when it completes — or taken back off the total if
 * it fails. A response sent without a size isn't counted.
 */

/** A load's bytes: received so far, over the bytes it's known to be loading. */
export interface LoadBytes {
  readonly loaded: number;
  readonly total: number;
}

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
  loaded: number;
  total: number;
  /** The byte counts last reported, so an unchanged count isn't reported again. */
  reportedLoaded: number;
  reportedTotal: number;
  /** Each request's size whose response has started and not yet ended, by request id. */
  readonly sizes: Map<number, number>;
  readonly onProgress: (percent: number, bytes: LoadBytes) => void;
}

const loads = new Map<number, Load>();

/**
 * Starts following a page's load. Replaces any load the page had under way.
 * @param webContentsId The page's `webContents`.
 * @param onProgress Called with the estimated percentage (whole, rising) and the bytes so far as the load goes on.
 */
export function beginLoad(webContentsId: number, onProgress: (percent: number, bytes: LoadBytes) => void): void {
  loads.set(webContentsId, {
    started: 0,
    finished: 0,
    percent: START_PERCENT,
    lastReport: 0,
    loaded: 0,
    total: 0,
    reportedLoaded: 0,
    reportedTotal: 0,
    sizes: new Map(),
    onProgress,
  });
  onProgress(START_PERCENT, { loaded: 0, total: 0 });
}

/**
 * Stops following a page's load (it finished, failed or was stopped). Says nothing: the page reports its own end.
 * @param webContentsId The page's `webContents`.
 * @returns The bytes it loaded, as the load's last count: the total is what was loaded, since what's still on its way
 *   then (a request the page keeps open) isn't part of the load the page says it finished. `null` with no load.
 */
export function endLoad(webContentsId: number): LoadBytes | null {
  const load = loads.get(webContentsId);
  loads.delete(webContentsId);
  return load ? { loaded: load.loaded, total: load.loaded } : null;
}

/**
 * Reports a load's new estimate if it rose to a new whole percent and the last report isn't too recent.
 * @param load The load.
 * @param now The time, in ms.
 */
function update(load: Load, now: number): void {
  const share = load.started === 0 ? 0 : load.finished / load.started;
  const percent = Math.max(load.percent, Math.min(MAX_ESTIMATE_PERCENT, Math.round(START_PERCENT + share * (MAX_ESTIMATE_PERCENT - START_PERCENT))));
  const bytesChanged = load.loaded !== load.reportedLoaded || load.total !== load.reportedTotal;
  if ((percent > load.percent || bytesChanged) && now - load.lastReport >= REPORT_INTERVAL_MS) {
    load.percent = percent;
    load.lastReport = now;
    load.reportedLoaded = load.loaded;
    load.reportedTotal = load.total;
    load.onProgress(percent, { loaded: load.loaded, total: load.total });
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
 * A page's request has a response on its way, of a known size: the load's total grows by it.
 * @param webContentsId The page's `webContents`.
 * @param requestId The request, as the session names it.
 * @param size The response's size in bytes (`Content-Length`), or `null` if it didn't say.
 * @param now The time, in ms; injectable for tests.
 */
export function responseStarted(
  webContentsId: number | undefined,
  requestId: number,
  size: number | null,
  now: number = Date.now(),
): void {
  const load = webContentsId === undefined ? undefined : loads.get(webContentsId);
  if (!load || size === null || !(size > 0) || load.sizes.has(requestId)) {
    return;
  }
  load.sizes.set(requestId, size);
  load.total += size;
  update(load, now);
}

/**
 * A page's request finished, or failed. A finished response's size counts as loaded; a failed one's comes off the
 * total, as it won't arrive.
 * @param webContentsId The page's `webContents`.
 * @param requestId The request, as the session names it; without one, only the request count moves.
 * @param failed Whether it failed rather than finished.
 * @param now The time, in ms; injectable for tests.
 */
export function requestFinished(
  webContentsId: number | undefined,
  requestId?: number,
  failed = false,
  now: number = Date.now(),
): void {
  const load = webContentsId === undefined ? undefined : loads.get(webContentsId);
  if (!load) {
    return;
  }
  load.finished = Math.min(load.started, load.finished + 1);
  const size = requestId === undefined ? undefined : load.sizes.get(requestId);
  if (requestId !== undefined && size !== undefined) {
    load.sizes.delete(requestId);
    if (failed) {
      load.total -= size;
    } else {
      load.loaded += size;
    }
  }
  update(load, now);
}
