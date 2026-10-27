// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { historyCutoff } from '@shared/history';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { compareText, sortRows } from '../../lib/tableSort';
import { CheckIcon, CopyIcon, OpenInNewTabIcon } from '../icons';
import { SortHeader, useTableSort } from '../SortHeader';
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

/** The table's sortable columns. */
type HistoryColumn = 'time' | 'type' | 'bookmark' | 'route' | 'method' | 'status';

/** What the Type column shows for a visit. */
function typeLabel(entry: HistoryEntry): string {
  return entry.type === 'pdf' ? 'PDF' : entry.type === 'markdown' ? 'MD' : 'URL';
}

/** The name of the bookmark a route is saved under, or `null` if it isn't bookmarked. */
function bookmarkNameFor(entry: HistoryEntry, bookmarks: HistoryBookmarkIndex): string | null {
  return (entry.type === 'url' ? bookmarks.urls[entry.url] : bookmarks.pdfs[entry.url.toLowerCase()]) ?? null;
}

/** The table's headings, in order, with each column's width class. */
const COLUMNS: readonly { readonly column: HistoryColumn; readonly label: string; readonly className: string }[] = [
  { column: 'time', label: 'Date & Time', className: 'history__th history__th--time' },
  { column: 'type', label: 'Type', className: 'history__th history__th--type' },
  { column: 'bookmark', label: 'Bookmark', className: 'history__th history__th--bookmark' },
  { column: 'route', label: 'Route', className: 'history__th' },
  { column: 'method', label: 'Method', className: 'history__th history__th--method' },
  { column: 'status', label: 'Status', className: 'history__th history__th--status' },
];

/**
 * The whole of `history.html`'s page: the browsing history as a table — when
 * each access happened, whether it was a page (`URL`) or a PDF opened from
 * disk (`PDF`), the name of the bookmark the route is saved under (`None` if
 * it isn't), the route (the URL, or the file's path), and the status code a
 * page came back with. Hovering a row reveals a button to copy its
 * route and one to delete it. Clicking a heading sorts by that column
 * (`SortHeader`); with no column sorted, the newest visit comes first.
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
  const sort = useTableSort<HistoryColumn>();
  const sorted = useMemo(
    () =>
      sortRows(matches, sort.keys, (first, second, column) => {
        switch (column) {
          case 'time':
            return first.timestamp - second.timestamp;
          case 'type':
            return compareText(typeLabel(first), typeLabel(second));
          case 'bookmark':
            return compareText(bookmarkNameFor(first, bookmarks) ?? '', bookmarkNameFor(second, bookmarks) ?? '');
          case 'route':
            return compareText(first.url, second.url);
          case 'method':
            return compareText(first.method, second.method);
          case 'status':
            return first.status - second.status;
        }
      }),
    [matches, sort.keys, bookmarks],
  );
  const shown = sorted.slice(0, MAX_ROWS);

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
                {COLUMNS.map(({ column, label, className }) => (
                  <SortHeader
                    key={column}
                    label={label}
                    className={className}
                    direction={sort.directionOf(column)}
                    onToggle={() => sort.toggle(column)}
                  />
                ))}
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
                      {typeLabel(entry)}
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
          Showing the {sort.keys.length === 0 ? 'newest' : 'first'} {MAX_ROWS} of {matches.length} — search to narrow it
          down.
        </p>
      )}
    </div>
  );
}
