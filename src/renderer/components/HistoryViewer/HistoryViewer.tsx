// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { useEffect, useMemo, useState } from 'react';
import type { HistoryEntry } from '@shared/ipc-contract';

/** The most rows drawn at once — thousands of rows would slow the page, and nobody reads past the newest few hundred; the search narrows the rest. */
const MAX_ROWS = 500;

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

/**
 * The whole of `history.html`'s page: the browsing history as a table (when
 * each request was made, the route requested, the status code it came back
 * with). Hovering a row reveals its own delete button.
 *
 * The controls — the search box, and the range "Clear History" clears — live
 * in the chrome's toolbar (`HistoryToolbar`), where a browser tab has its
 * address bar. This page only draws: main pushes the full list, newest
 * first, whenever it changes, and the search text as it's typed there;
 * filtering is local.
 */
export function HistoryViewer() {
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => window.northstarHistory.onEntries(setEntries), []);
  useEffect(() => window.northstarHistory.onQuery(setQuery), []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.url.toLowerCase().includes(needle) ||
        String(entry.status).includes(needle) ||
        DATE_TIME_FORMAT.format(entry.timestamp).toLowerCase().includes(needle),
    );
  }, [entries, query]);
  const shown = matches.slice(0, MAX_ROWS);

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
                <th className="history__th">Route</th>
                <th className="history__th history__th--status">Status</th>
                <th className="history__th history__th--action" aria-label="Delete" />
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id} className="history__row">
                  <td className="history__cell history__cell--time">{DATE_TIME_FORMAT.format(entry.timestamp)}</td>
                  <td className="history__cell history__cell--route" title={entry.url}>
                    {entry.url}
                  </td>
                  <td className={`history__cell history__cell--status ${statusClass(entry.status)}`}>
                    {entry.status}
                  </td>
                  <td className="history__cell history__cell--action">
                    <button
                      type="button"
                      className="history__delete"
                      aria-label={`Delete ${entry.url} from history`}
                      title="Delete from history"
                      onClick={() => window.northstarHistory.deleteEntry(entry.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
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
