// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { historyCutoff } from '@shared/history';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import type { HistoryBookmarkIndex, HistoryClearRange, HistoryEntry } from '@shared/ipc-contract';

/** The most rows drawn at once — thousands of rows would slow the page, and nobody reads past the newest few hundred; the search narrows the rest. */
const MAX_ROWS = 500;

/** The most deleted rows drawn on their way out at once; past this many, the rest just go. */
const MAX_EXITING_ROWS = 60;

/** How many rows into the table the fade-in's stagger reaches; the rest come in with the last of them. */
const MAX_ROW_STAGGER = 25;

/** A deleted row still drawn while it fades out, at the place it held. */
interface ExitingRow {
  readonly entry: HistoryEntry;
  readonly at: number;
}

/** How long a row's copy button shows its checkmark after copying. */
const COPIED_FEEDBACK_MS = 1200;

const NO_BOOKMARKS: HistoryBookmarkIndex = { urls: {}, pdfs: {} };

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

/** A status's family, for its color: `2xx` success, `3xx` redirect, `4xx`/`5xx` failure. */
function statusClass(status: number): string {
  if (status >= 200 && status < 300) {
    return 'history__status--ok';
  }
  if (status >= 300 && status < 400) {
    return 'history__status--redirect';
  }
  if (status >= 400) {
    return 'history__status--error';
  }
  return '';
}

/** The name of the bookmark a route is saved under, or `null` if it isn't bookmarked. */
function bookmarkNameFor(entry: HistoryEntry, bookmarks: HistoryBookmarkIndex): string | null {
  return (entry.type === 'url' ? bookmarks.urls[entry.url] : bookmarks.pdfs[entry.url.toLowerCase()]) ?? null;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 3.5v-.2a1.3 1.3 0 0 0-1.3-1.3H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A tab with a plus beside it: open the row in a new tab. */
function OpenInNewTabIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2 13.5V5.3a1.3 1.3 0 0 1 1.3-1.3h3.4l1.2 1.5h5.8a1.3 1.3 0 0 1 1.3 1.3v6.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M1.5 13.5h13M8 8v4M6 10h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The whole of `history.html`'s page: the browsing history as a table — when
 * each access happened, whether it was a page (`URL`) or a PDF opened from
 * disk (`PDF`), the name of the bookmark the route is saved under (`None` if
 * it isn't), the route (the URL, or the file's path), and the status code a
 * page came back with. Hovering a row reveals a button to copy its
 * route and one to delete it.
 *
 * The controls — the search box, and the range "Clear History" clears — live
 * in the chrome's toolbar (`HistoryToolbar`), where a browser tab has its
 * address bar. This page only draws: main pushes the full list, newest
 * first, whenever it changes, the bookmark names whenever a bookmark does,
 * and the search text as it's typed there; filtering is local.
 */
export function HistoryViewer() {
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<HistoryBookmarkIndex>(NO_BOOKMARKS);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<HistoryClearRange>({ unit: 'all' });
  /** The row whose copy button is showing its checkmark. */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => window.northstarHistory.onEntries(setEntries), []);
  useEffect(() => window.northstarHistory.onBookmarks(setBookmarks), []);
  useEffect(() => window.northstarHistory.onQuery(setQuery), []);
  useEffect(() => window.northstarHistory.onRange(setRange), []);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // The toolbar's number and unit: only visits inside them are shown (all time shows everything).
    const cutoff = historyCutoff(range, Date.now());
    const inRange = cutoff === null ? entries : entries.filter((entry) => entry.timestamp >= cutoff);
    if (!needle) {
      return inRange;
    }
    return inRange.filter(
      (entry) =>
        entry.url.toLowerCase().includes(needle) ||
        entry.type.includes(needle) ||
        (entry.type === 'url' && String(entry.status).includes(needle)) ||
        entry.method.toLowerCase().includes(needle) ||
        (bookmarkNameFor(entry, bookmarks) ?? '').toLowerCase().includes(needle) ||
        DATE_TIME_FORMAT.format(entry.timestamp).toLowerCase().includes(needle),
    );
  }, [entries, bookmarks, query, range]);
  const shown = matches.slice(0, MAX_ROWS);

  // Rows whose visits were just deleted (Clear History, or a row's own ×) stay a moment, fading out where they were,
  // rather than vanishing. Only a deletion does this: rows a search or the range hides simply go.
  const [exiting, setExiting] = useState<readonly ExitingRow[]>([]);
  const previousRef = useRef({ entries, shown });
  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { entries, shown };
    if (previous.entries === entries) {
      return;
    }
    const kept = new Set(entries.map((entry) => entry.id));
    const removed = previous.shown
      .map((entry, at) => ({ entry, at }))
      .filter(({ entry }) => !kept.has(entry.id))
      .slice(0, MAX_EXITING_ROWS);
    if (removed.length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setExiting((current) => [...current, ...removed]);
    }
  }, [entries, shown]);
  const endExit = (id: string): void => setExiting((current) => current.filter((row) => row.entry.id !== id));

  /** The rows drawn: the ones shown, with any on their way out put back at the places they held. */
  const displayRows = useMemo(() => {
    const rows: { entry: HistoryEntry; exiting: boolean }[] = shown.map((entry) => ({ entry, exiting: false }));
    for (const row of [...exiting].sort((first, second) => first.at - second.at)) {
      rows.splice(Math.min(row.at, rows.length), 0, { entry: row.entry, exiting: true });
    }
    return rows;
  }, [shown, exiting]);
  const hasRows = displayRows.length > 0;

  // The empty table's message ends in the same looping dots as the search boxes' placeholders.
  const emptyText = entries.length === 0 ? 'No history yet' : 'No matching history';
  const emptyMessage = useAnimatedPlaceholder(!hasRows, emptyText);
  // The whole message with all three dots: what isn't showing yet is laid out unseen after what is, so the centred
  // line keeps its full width and its words stay put while the dots come and go.
  const emptyRest = `${emptyText}...`.slice(emptyMessage.length);

  // The vertical scroll bar starts below the column headers, which stay put over the rows: its track is pushed down by
  // the header row's height, measured rather than assumed so a change of font or zoom keeps the two lined up.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const head = headRef.current;
    if (!wrap || !head) {
      return undefined;
    }
    const sync = (): void => wrap.style.setProperty('--history-header-height', `${head.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(head);
    return () => observer.disconnect();
  }, [hasRows]);

  const copy = (entry: HistoryEntry): void => {
    // Main copies what it has stored for this id, not text from here.
    window.northstarHistory.copyEntry(entry.id);
    setCopiedId(entry.id);
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), COPIED_FEEDBACK_MS);
  };

  return (
    <div className="history">
      <div ref={wrapRef} className="history__table-wrap">
        {!hasRows ? (
          <p className="history__empty">
            {emptyMessage}
            <span className="history__empty-rest" aria-hidden="true">
              {emptyRest}
            </span>
          </p>
        ) : (
          <table className="history__table">
            <thead ref={headRef}>
              <tr>
                <th className="history__th history__th--time">Date &amp; Time</th>
                <th className="history__th history__th--type">Type</th>
                <th className="history__th history__th--bookmark">Bookmark</th>
                <th className="history__th">Route</th>
                <th className="history__th history__th--method">Method</th>
                <th className="history__th history__th--status">Status</th>
                <th className="history__th history__th--actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {displayRows.map(({ entry, exiting: isExiting }, index) => {
                const bookmarkName = bookmarkNameFor(entry, bookmarks);
                const routeKind = entry.type === 'url' ? 'URL' : 'path';
                const isCopied = copiedId === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className={`history__row${isExiting ? ' history__row--exiting' : ''}`}
                    // How far down the fade-in's stagger this row comes.
                    style={{ '--row-index': Math.min(index, MAX_ROW_STAGGER) } as CSSProperties}
                    aria-hidden={isExiting || undefined}
                    onAnimationEnd={(event) => {
                      if (isExiting && event.animationName === 'history-row-out') {
                        endExit(entry.id);
                      }
                    }}
                  >
                    <td className="history__cell history__cell--time">{DATE_TIME_FORMAT.format(entry.timestamp)}</td>
                    <td className="history__cell history__cell--type">
                      {entry.type === 'pdf' ? 'PDF' : entry.type === 'markdown' ? 'MD' : 'URL'}
                    </td>
                    <td
                      className={`history__cell history__cell--bookmark${
                        bookmarkName === null ? ' history__cell--muted' : ''
                      }`}
                      title={bookmarkName ?? undefined}
                    >
                      {bookmarkName ?? 'None'}
                    </td>
                    <td className="history__cell history__cell--route" title={entry.url}>
                      {entry.url}
                    </td>
                    {/* A file on disk has no HTTP method or status. */}
                    <td className={`history__cell history__cell--method${entry.type === 'url' && entry.method !== '' ? '' : ' history__cell--muted'}`}>
                      {entry.type === 'url' && entry.method !== '' ? entry.method : '—'}
                    </td>
                    <td
                      className={`history__cell history__cell--status ${
                        entry.type !== 'url' ? 'history__cell--muted' : statusClass(entry.status)
                      }`}
                    >
                      {entry.type !== 'url' ? '—' : entry.status}
                    </td>
                    <td className="history__cell history__cell--actions">
                      <div className="history__actions">
                        <button
                          type="button"
                          className="history__action-button hover-grow history__open"
                          aria-label={`Open ${entry.url} in a new tab`}
                          title="Open in new tab"
                          onClick={() => window.northstarHistory.openEntryInNewTab(entry.id)}
                        >
                          <OpenInNewTabIcon />
                        </button>
                        <button
                          type="button"
                          className={`history__action-button hover-grow history__copy${isCopied ? ' history__copy--done' : ''}`}
                          aria-label={`Copy ${routeKind}`}
                          title={isCopied ? 'Copied' : `Copy ${routeKind}`}
                          onClick={() => copy(entry)}
                        >
                          {isCopied ? <CheckIcon /> : <CopyIcon />}
                        </button>
                        <button
                          type="button"
                          className="history__action-button hover-grow history__delete"
                          aria-label={`Delete ${entry.url} from history`}
                          title="Delete from history"
                          onClick={() => window.northstarHistory.deleteEntry(entry.id)}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {matches.length > MAX_ROWS && (
        <p className="history__note">
          Showing the newest {MAX_ROWS} of {matches.length} — search to narrow it down.
        </p>
      )}
    </div>
  );
}
