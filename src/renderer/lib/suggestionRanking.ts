// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import type { AddressSuggestionItem } from '@shared/ipc-contract';

/** One candidate row: what it's called, and the address or path it leads to. */
export interface SuggestionCandidate {
  readonly id: string;
  readonly title: string;
  /** A page's URL, or a file's path. */
  readonly url: string;
}

/**
 * How well a name matches what's typed: its start (or a word's start) beats anywhere in it.
 * @param name The bookmark's name, or a history entry's site or file name.
 * @param query The typed text, trimmed and lower-cased.
 * @returns 0 for the start of a word, 1 for anywhere, `null` for no match.
 */
function nameRank(name: string, query: string): 0 | 1 | null {
  const lower = name.toLowerCase();
  let at = lower.indexOf(query);
  if (at === -1) {
    return null;
  }
  // A word's start: the name's start, or just after anything that isn't a letter or digit ("ch5b" in "ece_ch5b").
  // Every place it occurs counts, so "google" in "www.google.com" still finds the word after the first dot.
  while (at !== -1) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1] ?? '')) {
      return 0;
    }
    at = lower.indexOf(query, at + 1);
  }
  return 1;
}

/**
 * Orders one group of candidates by how well each matches: names first (a word's start before anywhere in the
 * name), then those that match only by their URL or path. Within each tier the given order (newest first) holds.
 * Nothing typed keeps every candidate, in its given order.
 * @param candidates The group, newest first.
 * @param query The typed text, trimmed and lower-cased.
 * @param matchesUrl Whether a candidate's URL or path matches, for those whose name doesn't.
 */
function rankGroup<T extends SuggestionCandidate>(
  candidates: readonly T[],
  query: string,
  matchesUrl: (candidate: T) => boolean,
): T[] {
  if (!query) {
    return [...candidates];
  }
  const tiers: T[][] = [[], [], []];
  for (const candidate of candidates) {
    const rank = nameRank(candidate.title, query);
    if (rank !== null) {
      tiers[rank]!.push(candidate);
    } else if (matchesUrl(candidate)) {
      tiers[2]!.push(candidate);
    }
  }
  return tiers.flat();
}

/**
 * The rows a search bar's dropdown lists (the address bar's, and the PDF and note search's): the bookmarks whose
 * name matches, then the bookmarks that match only by address, then the history the same way, a bookmarked address
 * never listed twice. Capped at `limit`.
 * @param bookmarks The bookmarks to search, newest first, each with the address or path it opens.
 * @param history The history's matches (already matched by the main process on the address), newest first.
 * @param query The typed text, trimmed and lower-cased.
 * @param limit The most rows to list.
 * @param sameAddress Normalises an address for spotting a bookmarked one in the history (paths ignore case on Windows).
 */
export function rankSuggestions(
  bookmarks: readonly SuggestionCandidate[],
  history: readonly SuggestionCandidate[],
  query: string,
  limit: number,
  sameAddress: (address: string) => string = (address) => address,
): AddressSuggestionItem[] {
  const bookmarkRows = rankGroup(bookmarks, query, (bookmark) => bookmark.url.toLowerCase().includes(query)).map(
    (bookmark): AddressSuggestionItem => ({ ...bookmark, kind: 'bookmark' }),
  );
  const listed = new Set(bookmarkRows.map((row) => sameAddress(row.url)));
  // The main process matched these on the address already, so each is kept: its name only decides how high it goes.
  const historyRows = rankGroup(
    history.filter((entry) => !listed.has(sameAddress(entry.url))),
    query,
    () => true,
  ).map((entry): AddressSuggestionItem => ({ ...entry, kind: 'history' }));
  return [...bookmarkRows, ...historyRows].slice(0, limit);
}
