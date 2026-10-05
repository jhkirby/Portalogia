// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

/** The find bar's three switches, as in VS Code's: Aa, ab, .* */
export interface FindOptions {
  /** Match upper and lower case as typed, instead of ignoring case. */
  readonly matchCase: boolean;
  /** Only match whole words: "cat" doesn't match inside "concatenate". */
  readonly wholeWord: boolean;
  /** Treat the query as a regular expression instead of plain text. */
  readonly regex: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = { matchCase: false, wholeWord: false, regex: false };

/** Past this many matches a search stops counting (and the bar shows "20000+"), so a one-letter query on a huge page can't stall it. */
export const MAX_FIND_MATCHES = 20_000;

/** One match: a half-open `[start, end)` range of character offsets into the searched text. */
export interface FindMatch {
  readonly start: number;
  readonly end: number;
}

/** What a query turns into: nothing to look for, a query that isn't a valid regular expression, or a pattern to search with. */
export type FindPattern =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly regExp: RegExp };

/** Escapes every character a regular expression gives meaning to, so plain text matches literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/**
 * Turns the find bar's query and switches into one regular expression, the
 * same for every kind of tab. Plain text is escaped; whole-word wraps the
 * pattern in "not preceded or followed by a word character"; `^` and `$`
 * match at line breaks (the `m` flag), as in an editor's find.
 * @param query What was typed.
 * @param options The three switches.
 * @returns The pattern; `empty` for no query, `invalid` for a regex that won't compile.
 */
export function buildFindPattern(query: string, options: FindOptions): FindPattern {
  if (query === '') {
    return { kind: 'empty' };
  }
  const source = options.regex ? query : escapeRegExp(query);
  const bounded = options.wholeWord ? `(?<!\\w)(?:${source})(?!\\w)` : source;
  try {
    return { kind: 'ok', regExp: new RegExp(bounded, options.matchCase ? 'gm' : 'gim') };
  } catch {
    return { kind: 'invalid' };
  }
}

/**
 * Every match of a pattern in a text, in order, never overlapping. A match
 * of zero length (a regex like `a*` matches "nothing" everywhere) is skipped,
 * since there's nothing to highlight or jump to — and skipping it is what
 * stops the scan from looping on the same spot forever.
 * @param text The text to search.
 * @param regExp A global pattern from `buildFindPattern`.
 * @param cap The most matches to collect.
 * @returns The matches, and whether the cap cut the list short.
 */
export function findMatches(
  text: string,
  regExp: RegExp,
  cap: number = MAX_FIND_MATCHES,
): { readonly matches: readonly FindMatch[]; readonly capped: boolean } {
  const matches: FindMatch[] = [];
  regExp.lastIndex = 0;
  let found = regExp.exec(text);
  while (found !== null) {
    if (found[0].length === 0) {
      regExp.lastIndex += 1;
    } else {
      matches.push({ start: found.index, end: found.index + found[0].length });
      if (matches.length >= cap) {
        return { matches, capped: true };
      }
    }
    found = regExp.exec(text);
  }
  return { matches, capped: false };
}

/**
 * Steps a position through `total` matches, looping at either end — the
 * match after the last is the first, and the one before the first is the last.
 * @param index The current 0-based position.
 * @param delta `1` for the next match, `-1` for the previous.
 * @param total How many matches there are.
 * @returns The new 0-based position; `-1` if there are no matches.
 */
export function stepIndex(index: number, delta: 1 | -1, total: number): number {
  if (total <= 0) {
    return -1;
  }
  if (index < 0) {
    // No current match yet: forward starts at the first, backward at the last.
    return delta === 1 ? 0 : total - 1;
  }
  return (((index + delta) % total) + total) % total;
}

/**
 * Turns a number someone typed into the position it names: 1-based, clamped
 * to the matches that exist, so "0" lands on the first and "999" on the last.
 * @param requested The typed occurrence number.
 * @param total How many matches there are.
 * @returns A 0-based position; `-1` if there are no matches or the input isn't a number.
 */
export function clampOccurrence(requested: number, total: number): number {
  if (total <= 0 || !Number.isFinite(requested)) {
    return -1;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), total) - 1;
}
