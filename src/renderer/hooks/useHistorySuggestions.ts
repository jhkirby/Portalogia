// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useState } from 'react';
import type { HistoryEntry, HistorySuggestion } from '@shared/ipc-contract';

/** How long typing must pause before the history is asked: a search per keystroke is wasted work when the next key is already on its way. */
const DEBOUNCE_MS = 60;

/**
 * The most recent pages (or PDFs) from the history that match what's typed
 * in a search bar — what its dropdown lists after the bookmarks. The history
 * lives in the main process, so this asks it (`searchHistory`) as the text
 * changes.
 *
 * An answer that arrives after the text has moved on is dropped, so a slow
 * reply to "pu" can't overwrite the list for "purd". The previous matches
 * stay up while the next are fetched rather than flashing empty, and clear
 * once there's nothing typed (or the box loses focus).
 * @param type Pages (`'url'`) or PDFs (`'pdf'`).
 * @param query The text typed so far.
 * @param enabled Whether the dropdown can show at all (the box is focused).
 * @param listWhenEmpty Whether nothing typed lists everything (the PDF and note search) rather than nothing.
 * @returns The matches, newest first.
 */
export function useHistorySuggestions(
  type: HistoryEntry['type'],
  query: string,
  enabled: boolean,
  listWhenEmpty = false,
): readonly HistorySuggestion[] {
  const [matches, setMatches] = useState<readonly HistorySuggestion[]>([]);

  useEffect(() => {
    const needle = query.trim();
    if (!enabled || (!needle && !listWhenEmpty)) {
      setMatches([]);
      return undefined;
    }
    let isStale = false;
    const timer = window.setTimeout(() => {
      void window.northstar.searchHistory(type, needle).then((result) => {
        if (!isStale && result.ok) {
          setMatches(result.data);
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      isStale = true;
      window.clearTimeout(timer);
    };
  }, [type, query, enabled, listWhenEmpty]);

  return matches;
}
