// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryBookmarkIndex, HistoryEntry } from '@shared/ipc-contract';

/** The most rows drawn at once — thousands of rows would slow the page, and nobody reads past the newest few hundred; the search narrows the rest. */
const MAX_ROWS = 500;

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
  /** The row whose copy button is showing its checkmark. */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => window.northstarHistory.onEntries(setEntries), []);
  useEffect(() => window.northstarHistory.onBookmarks(setBookmarks), []);
  useEffect(() => window.northstarHistory.onQuery(setQuery), []);
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
    if (!needle) {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.url.toLowerCase().includes(needle) ||
        entry.type.includes(needle) ||
        (entry.type === 'url' && String(entry.status).includes(needle)) ||
        (bookmarkNameFor(entry, bookmarks) ?? '').toLowerCase().includes(needle) ||
        DATE_TIME_FORMAT.format(entry.timestamp).toLowerCase().includes(needle),
    );
  }, [entries, bookmarks, query]);
  const shown = matches.slice(0, MAX_ROWS);

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
      <div className="history__table-wrap">
        {shown.length === 0 ? (
          <p className="history__empty">{entries.length === 0 ? 'No history yet.' : 'No matching history.'}</p>
        ) : (
          <table className="history__table">
            <thead>
              <tr>
                <th className="history__th history__th--time">Date &amp; time</th>
                <th className="history__th history__th--type">Type</th>
                <th className="history__th history__th--bookmark">Bookmark</th>
                <th className="history__th">Route</th>
                <th className="history__th history__th--status">Status</th>
                <th className="history__th history__th--actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => {
                const bookmarkName = bookmarkNameFor(entry, bookmarks);
                const routeKind = entry.type === 'url' ? 'URL' : 'path';
                const isCopied = copiedId === entry.id;
                return (
                  <tr key={entry.id} className="history__row">
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
                    {/* A file on disk has no HTTP status. */}
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
                          className={`history__action-button history__copy${isCopied ? ' history__copy--done' : ''}`}
                          aria-label={`Copy ${routeKind}`}
                          title={isCopied ? 'Copied' : `Copy ${routeKind}`}
                          onClick={() => copy(entry)}
                        >
                          {isCopied ? <CheckIcon /> : <CopyIcon />}
                        </button>
                        <button
                          type="button"
                          className="history__action-button history__delete"
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
