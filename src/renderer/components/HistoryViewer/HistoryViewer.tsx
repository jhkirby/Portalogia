// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { useEffect, useMemo, useState } from 'react';
import { HISTORY_UNIT_LIMITS, type HistoryUnit } from '@shared/constants';
import type { HistoryEntry } from '@shared/ipc-contract';
import { UnitSelect } from './UnitSelect';

/** "Clear History" reaches back through one of the units, or all of it. */
type ClearUnit = HistoryUnit | 'all';

const UNIT_OPTIONS: readonly { readonly value: ClearUnit; readonly label: string }[] = [
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'all', label: 'All Time' },
];

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
 * with), with one row of controls above it — a search box over the table,
 * and the range "Clear History" clears (a number and a unit, or "All Time",
 * which has no number). Hovering a row reveals its own delete button.
 *
 * Main pushes the full list, newest first, whenever it changes; filtering
 * and drawing are local. The clear range is only a request — main
 * re-validates it before deleting anything.
 */
export function HistoryViewer() {
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState<ClearUnit>('hours');
  /** Kept as text so the box can be emptied while typing; validated against the unit's own limit. */
  const [amountText, setAmountText] = useState('1');

  useEffect(() => window.northstarHistory.onEntries(setEntries), []);

  const limit = unit === 'all' ? 0 : HISTORY_UNIT_LIMITS[unit];
  const amount = Number.parseInt(amountText, 10);
  const canClear = unit === 'all' || (Number.isInteger(amount) && amount >= 1 && amount <= limit);

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

  const changeUnit = (next: ClearUnit): void => {
    setUnit(next);
    // A number valid for hours (up to 23) may be past months' limit (12): pull it back inside the new range.
    if (next !== 'all' && Number.isInteger(amount) && amount > HISTORY_UNIT_LIMITS[next]) {
      setAmountText(String(HISTORY_UNIT_LIMITS[next]));
    }
  };

  const clear = (): void => {
    if (!canClear) {
      return;
    }
    window.northstarHistory.clear(unit === 'all' ? { unit: 'all' } : { unit, amount });
  };

  return (
    <div className="history">
      <div className="history__controls">
        <input
          type="search"
          className="history__search"
          aria-label="Search history"
          placeholder="Search history..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          autoFocus
        />
        <input
          type="number"
          className="history__amount"
          aria-label="Amount of time to clear"
          min={1}
          max={limit || undefined}
          step={1}
          value={unit === 'all' ? '' : amountText}
          disabled={unit === 'all'}
          aria-invalid={!canClear}
          onChange={(event) => setAmountText(event.target.value.replace(/\D/g, ''))}
        />
        <UnitSelect options={UNIT_OPTIONS} value={unit} onChange={changeUnit} label="Unit of time to clear" />
        <button type="button" className="history__clear" onClick={clear} disabled={!canClear}>
          Clear History
        </button>
      </div>

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
