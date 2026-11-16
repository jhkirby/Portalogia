// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useRef, useState } from 'react';
import { HISTORY_UNIT_LIMITS, type HistoryUnit } from '@shared/constants';
import type { HistoryClearRange } from '@shared/ipc-contract';
import type { HistoryTabState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
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

interface HistoryToolbarProps {
  readonly tab: HistoryTabState;
  /** "Clear History" was pressed for a range: the app confirms (`ClearHistoryPopup`) before anything is deleted. */
  readonly onRequestClear: (range: HistoryClearRange) => void;
}

/** What the toolbar's inputs held, so switching away from a History tab and back finds them as they were. */
interface HistoryControls {
  readonly query: string;
  readonly unit: ClearUnit;
  readonly amountText: string;
}

const DEFAULT_CONTROLS: HistoryControls = { query: '', unit: 'all', amountText: '1' };

/** Per tab: the toolbar remounts on every tab switch (see its `key` in `App`), which would otherwise reset the inputs while the tab's table kept its filter. */
const controlsByTab = new Map<string, HistoryControls>();

/**
 * The History tab's controls, shown in the main toolbar where a browser tab
 * has its address bar: the search box (which filters the tab's table, in its
 * own page), then what "Clear History" clears — a number and a unit, or
 * "All Time", which has no number — and the button itself.
 *
 * The search text is sent to the tab's page through main
 * (`setHistoryQuery`); clearing goes to main directly. Ctrl+/ jumps to the
 * search box, the same shortcut that jumps to the address bar on a browser
 * tab. Its placeholder types itself in and loops its trailing dots, like the
 * address bar's.
 */
export function HistoryToolbar({ tab, onRequestClear }: HistoryToolbarProps) {
  const initial = controlsByTab.get(tab.id) ?? DEFAULT_CONTROLS;
  const [query, setQuery] = useState(initial.query);
  const [unit, setUnit] = useState<ClearUnit>(initial.unit);
  /** Kept as text so the box can be emptied while typing; validated against the unit's own limit. */
  const [amountText, setAmountText] = useState(initial.amountText);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    controlsByTab.set(tab.id, { query, unit, amountText });
  }, [tab.id, query, unit, amountText]);

  // The tab's page may have loaded after the text was last typed: tell it what this box holds.
  useEffect(() => {
    window.portalogia.setHistoryQuery(tab.id, query);
  }, [tab.id, query]);

  const limit = unit === 'all' ? 0 : HISTORY_UNIT_LIMITS[unit];
  const amount = Number.parseInt(amountText, 10);
  const canClear = unit === 'all' || (Number.isInteger(amount) && amount >= 1 && amount <= limit);
  const range: HistoryClearRange = unit === 'all' || !canClear ? { unit: 'all' } : { unit, amount };

  // The same number and unit also pick which visits the table shows (a half-typed number shows everything).
  useEffect(() => {
    window.portalogia.setHistoryRange(tab.id, range);
    // `range` is rebuilt every render; its parts are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, range.unit, 'amount' in range ? range.amount : 0]);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps here, as it does to the address bar on a browser tab.
  useEffect(() => window.portalogia.onFocusAddressBar(() => searchRef.current?.focus()), []);

  const changeUnit = (next: ClearUnit): void => {
    setUnit(next);
    // A number valid for hours (up to 23) may be past months' limit (12): pull it back inside the new range.
    if (next !== 'all' && Number.isInteger(amount) && amount > HISTORY_UNIT_LIMITS[next]) {
      setAmountText(String(HISTORY_UNIT_LIMITS[next]));
    }
  };

  // How many visits the range holds, kept current as the history changes: with none, there's nothing to clear.
  const [rangeCount, setRangeCount] = useState<number | null>(null);
  const rangeKey = JSON.stringify(range);
  useEffect(() => {
    let isStale = false;
    const recount = (): void => {
      void window.portalogia.countHistory(JSON.parse(rangeKey) as HistoryClearRange).then((result) => {
        if (!isStale && result.ok) {
          setRangeCount(result.data);
        }
      });
    };
    recount();
    const unsubscribe = window.portalogia.onHistoryChanged(recount);
    return () => {
      isStale = true;
      unsubscribe();
    };
  }, [rangeKey]);
  const hasHistoryToClear = canClear && rangeCount !== 0;

  const clear = (): void => {
    if (!hasHistoryToClear) {
      return;
    }
    onRequestClear(range);
  };

  // Types itself in once, then its trailing dots loop — the same animation as the address bar's.
  const placeholder = useAnimatedPlaceholder(query === '', 'Search history');

  return (
    <div className="history-toolbar">
      <input
        ref={searchRef}
        type="text"
        className="history-toolbar__search"
        aria-label="Search history..."
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setQuery('');
            event.currentTarget.blur();
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {/* "All Time" takes no number: the box fades and folds away, and the dropdown slides over into its place. */}
      <input
        type="number"
        className={`history-toolbar__amount${unit === 'all' ? ' history-toolbar__amount--hidden' : ''}`}
        aria-label="Amount of time to clear"
        aria-hidden={unit === 'all'}
        tabIndex={unit === 'all' ? -1 : undefined}
        min={1}
        max={limit || undefined}
        step={1}
        value={unit === 'all' ? '' : amountText}
        disabled={unit === 'all'}
        aria-invalid={!canClear}
        onChange={(event) => setAmountText(event.target.value.replace(/\D/g, ''))}
      />
      <UnitSelect options={UNIT_OPTIONS} value={unit} onChange={changeUnit} label="Unit of time to clear" />
      <button type="button" className="history-toolbar__clear hover-grow" onClick={clear} disabled={!hasHistoryToClear}>
        Clear History
      </button>
    </div>
  );
}
