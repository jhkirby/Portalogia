// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { test, expect } from '@playwright/test';
import {
  buildFindPattern,
  clampOccurrence,
  DEFAULT_FIND_OPTIONS,
  findMatches,
  stepIndex,
  type FindOptions,
} from '../../src/shared/find';

/** Runs a search the way every tab kind does: build the pattern, then collect the matches as `[start, end]` pairs. */
function search(text: string, query: string, options: Partial<FindOptions> = {}): number[][] | 'invalid' | 'empty' {
  const pattern = buildFindPattern(query, { ...DEFAULT_FIND_OPTIONS, ...options });
  if (pattern.kind !== 'ok') {
    return pattern.kind;
  }
  return findMatches(text, pattern.regExp).matches.map((match) => [match.start, match.end]);
}

test.describe('buildFindPattern', () => {
  test('an empty query has nothing to look for', () => {
    expect(buildFindPattern('', DEFAULT_FIND_OPTIONS).kind).toBe('empty');
  });

  test('plain text is matched literally, never as a pattern', () => {
    expect(search('a.b axb a+b', 'a.b')).toEqual([[0, 3]]);
    expect(search('1+1=2 and 11', '1+1')).toEqual([[0, 3]]);
    expect(search('(x) [y] {z} ^$ \\ /', '(x)')).toEqual([[0, 3]]);
    expect(search('a|b', 'a|b')).toEqual([[0, 3]]);
  });

  test('ignores case by default, and respects it when asked', () => {
    expect(search('Cat cat CAT', 'cat')).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(search('Cat cat CAT', 'cat', { matchCase: true })).toEqual([[4, 7]]);
    expect(search('Cat cat CAT', 'CAT', { matchCase: true })).toEqual([[8, 11]]);
  });

  test('whole word skips matches inside a longer word', () => {
    expect(search('cat concatenate cat.', 'cat')).toEqual([[0, 3], [7, 10], [16, 19]]);
    expect(search('cat concatenate cat.', 'cat', { wholeWord: true })).toEqual([[0, 3], [16, 19]]);
  });

  test('whole word treats digits and underscores as part of a word', () => {
    expect(search('cat cat2 cat_ _cat', 'cat', { wholeWord: true })).toEqual([[0, 3]]);
  });

  test('whole word applies to a phrase as a unit, and to every alternative of a regex', () => {
    expect(search('big cat, bigcat', 'big cat', { wholeWord: true })).toEqual([[0, 7]]);
    expect(search('cat dog catalog', 'cat|dog', { regex: true, wholeWord: true })).toEqual([[0, 3], [4, 7]]);
  });

  test('regex mode uses the query as a pattern', () => {
    expect(search('a1 b22 c333', '\\d+', { regex: true })).toEqual([[1, 2], [4, 6], [8, 11]]);
    expect(search('foo.bar', 'o.b', { regex: true })).toEqual([[2, 5]]);
  });

  test('regex mode honours case sensitivity too', () => {
    expect(search('Ab ab', 'ab', { regex: true })).toEqual([[0, 2], [3, 5]]);
    expect(search('Ab ab', 'ab', { regex: true, matchCase: true })).toEqual([[3, 5]]);
  });

  test('^ and $ match at line breaks', () => {
    // Both "two" and "three" are whole lines starting with t.
    expect(search('one\ntwo\nthree', '^t\\w+$', { regex: true })).toEqual([[4, 7], [8, 13]]);
    expect(search('one\ntwo\nthree', '^two$', { regex: true })).toEqual([[4, 7]]);
    expect(search('one\ntwo\nthree', '^\\w', { regex: true })).toEqual([[0, 1], [4, 5], [8, 9]]);
  });

  test('a regex that does not compile is reported, not thrown', () => {
    expect(search('abc', '(', { regex: true })).toBe('invalid');
    expect(search('abc', '[a-', { regex: true })).toBe('invalid');
    expect(search('abc', '*a', { regex: true })).toBe('invalid');
    // The same text is fine as plain text.
    expect(search('f(x)', '(', {})).toEqual([[1, 2]]);
  });
});

test.describe('findMatches', () => {
  test('matches never overlap', () => {
    expect(search('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]);
  });

  test('a pattern that can match nothing neither hangs nor reports empty matches', () => {
    expect(search('baaab', 'a*', { regex: true })).toEqual([[1, 4]]);
    expect(search('abc', 'x*', { regex: true })).toEqual([]);
    expect(search('', 'a*', { regex: true })).toEqual([]);
  });

  test('empty text has no matches', () => {
    expect(search('', 'a')).toEqual([]);
  });

  test('stops at the cap and says so', () => {
    const pattern = buildFindPattern('a', DEFAULT_FIND_OPTIONS);
    if (pattern.kind !== 'ok') {
      throw new Error('expected a pattern');
    }
    const result = findMatches('a'.repeat(50), pattern.regExp, 10);
    expect(result.matches).toHaveLength(10);
    expect(result.capped).toBe(true);
    expect(findMatches('a'.repeat(10), pattern.regExp, 10).capped).toBe(true);
    expect(findMatches('a'.repeat(9), pattern.regExp, 10).capped).toBe(false);
  });

  test('can be run again with the same pattern (no state left over from the last scan)', () => {
    const pattern = buildFindPattern('a', DEFAULT_FIND_OPTIONS);
    if (pattern.kind !== 'ok') {
      throw new Error('expected a pattern');
    }
    expect(findMatches('aaa', pattern.regExp).matches).toHaveLength(3);
    expect(findMatches('aaa', pattern.regExp).matches).toHaveLength(3);
  });

  test('finds unicode text', () => {
    expect(search('café CAFÉ', 'café')).toEqual([[0, 4], [5, 9]]);
    expect(search('日本語のテキスト', 'テキスト')).toEqual([[4, 8]]);
  });
});

test.describe('stepIndex', () => {
  test('moves forward and back', () => {
    expect(stepIndex(0, 1, 5)).toBe(1);
    expect(stepIndex(3, -1, 5)).toBe(2);
  });

  test('loops past either end', () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
  });

  test('a single match loops onto itself', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
  });

  test('with no matches there is nowhere to go', () => {
    expect(stepIndex(-1, 1, 0)).toBe(-1);
    expect(stepIndex(0, -1, 0)).toBe(-1);
  });

  test('steps on from "no current match" to the first or last', () => {
    expect(stepIndex(-1, 1, 5)).toBe(0);
    expect(stepIndex(-1, -1, 5)).toBe(4);
  });
});

test.describe('clampOccurrence', () => {
  test('turns a 1-based number into a 0-based position', () => {
    expect(clampOccurrence(1, 5)).toBe(0);
    expect(clampOccurrence(5, 5)).toBe(4);
  });

  test('clamps out-of-range numbers to the nearest end', () => {
    expect(clampOccurrence(0, 5)).toBe(0);
    expect(clampOccurrence(-3, 5)).toBe(0);
    expect(clampOccurrence(999, 5)).toBe(4);
  });

  test('drops a fraction, and refuses what is not a number', () => {
    expect(clampOccurrence(2.9, 5)).toBe(1);
    expect(clampOccurrence(Number.NaN, 5)).toBe(-1);
    expect(clampOccurrence(Number.POSITIVE_INFINITY, 5)).toBe(-1);
  });

  test('with no matches there is nothing to land on', () => {
    expect(clampOccurrence(1, 0)).toBe(-1);
  });
});
