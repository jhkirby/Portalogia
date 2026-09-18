// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import type { TabState } from '@shared/tab-state';

/**
 * Common words that carry no search signal in a phrase like "that page
 * about hiking I had open" — dropped before matching so a naturally
 * phrased query still lands on the tabs whose title or URL contains the
 * words that do.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'my',
  'that',
  'this',
  'about',
  'page',
  'pages',
  'tab',
  'tabs',
  'on',
  'in',
  'at',
  'for',
  'with',
  'of',
  'to',
  'where',
  'is',
  'was',
  'show',
  'me',
  'find',
  'open',
  'i',
  'had',
  'have',
  'and',
  'or',
]);

/** Splits text into lowercase word tokens, discarding punctuation. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Scores one tab against a set of already-tokenized, already-stopword-
 * filtered query terms: a title match counts more than a URL match, since
 * the title is what a person actually remembers about a page.
 * @param tab The tab to score.
 * @param tokens Query tokens to look for.
 * @returns A score of 0 (no match) or higher.
 */
function scoreTab(tab: TabState, tokens: readonly string[]): number {
  const title = tab.title.toLowerCase();
  const url = tab.kind === 'browser' ? tab.url.toLowerCase() : '';
  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) {
      score += 3;
    }
    if (url.includes(token)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Ranks tabs against free-text query, tolerant of natural phrasing like
 * "that page about hiking" — stopwords are dropped and the remaining
 * tokens are matched against each tab's title (weighted highest) and URL.
 * This is heuristic keyword matching, not true natural-language
 * understanding, but it's pure and synchronous, so it's cheap to call on
 * every keystroke without a network round trip.
 * @param tabs Tabs to search, in their current order (used as a tiebreak).
 * @param query Free-text search input.
 * @returns Matching tabs, best match first; all tabs (in their given
 *   order) if the query is blank or has no non-stopword terms.
 */
export function searchTabs(tabs: readonly TabState[], query: string): readonly TabState[] {
  const tokens = tokenize(query).filter((token) => !STOPWORDS.has(token));
  if (tokens.length === 0) {
    return tabs;
  }

  return tabs
    .map((tab, index) => ({ tab, index, score: scoreTab(tab, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.tab);
}
