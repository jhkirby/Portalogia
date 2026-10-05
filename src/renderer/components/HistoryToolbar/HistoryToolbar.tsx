// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

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
}

/** What the toolbar's inputs held, so switching away from a History tab and back finds them as they were. */
interface HistoryControls {
  readonly query: string;
  readonly unit: ClearUnit;
  readonly amountText: string;
}

const DEFAULT_CONTROLS: HistoryControls = { query: '', unit: 'hours', amountText: '1' };

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
export function HistoryToolbar({ tab }: HistoryToolbarProps) {
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
    window.northstar.setHistoryQuery(tab.id, query);
  }, [tab.id, query]);

  // Ctrl+/ (menu accelerator, see buildMenu.ts) jumps here, as it does to the address bar on a browser tab.
  useEffect(() => window.northstar.onFocusAddressBar(() => searchRef.current?.focus()), []);

  const limit = unit === 'all' ? 0 : HISTORY_UNIT_LIMITS[unit];
  const amount = Number.parseInt(amountText, 10);
  const canClear = unit === 'all' || (Number.isInteger(amount) && amount >= 1 && amount <= limit);

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
    const range: HistoryClearRange = unit === 'all' ? { unit: 'all' } : { unit, amount };
    void window.northstar.clearHistory(range);
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
      <input
        type="number"
        className="history-toolbar__amount"
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
      <button type="button" className="history-toolbar__clear" onClick={clear} disabled={!canClear}>
        Clear History
      </button>
    </div>
  );
}
