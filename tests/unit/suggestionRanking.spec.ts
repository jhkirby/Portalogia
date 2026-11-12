// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { test, expect } from '@playwright/test';
import { rankSuggestions, type SuggestionCandidate } from '../../src/renderer/lib/suggestionRanking';

const bookmark = (id: string, title: string, url: string): SuggestionCandidate => ({ id, title, url });
const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

test.describe('rankSuggestions', () => {
  test('a bookmark whose name matches comes before one that matches only by address', () => {
    const rows = rankSuggestions(
      [
        bookmark('by-url', 'Search', 'https://www.google.com/search?q=notes'),
        bookmark('by-name', 'My notes', 'https://example.com/'),
      ],
      [],
      'notes',
      10,
    );
    expect(ids(rows)).toEqual(['by-name', 'by-url']);
  });

  test("a name matched at a word's start beats one matched mid-word, and order holds within a tier", () => {
    const rows = rankSuggestions(
      [
        bookmark('mid', 'Keynotes', 'a'),
        bookmark('start-newer', 'Notes 2', 'b'),
        bookmark('start-older', 'Old notes', 'c'),
      ],
      [],
      'notes',
      10,
    );
    expect(ids(rows)).toEqual(['start-newer', 'start-older', 'mid']);
  });

  test('a bookmark matching neither name nor address is left out', () => {
    expect(rankSuggestions([bookmark('x', 'Weather', 'https://weather.com/')], [], 'notes', 10)).toEqual([]);
  });

  test('history comes after every bookmark, its name deciding its place among the history', () => {
    const rows = rankSuggestions(
      [bookmark('b', 'Docs', 'https://docs.example.com/guide')],
      [
        { id: 'h-path', title: 'lecture.pdf', url: 'C:\\guide\\lecture.pdf' },
        { id: 'h-name', title: 'guide.pdf', url: 'C:\\files\\guide.pdf' },
      ],
      'guide',
      10,
    );
    expect(ids(rows)).toEqual(['b', 'h-name', 'h-path']);
    expect(rows.map((row) => row.kind)).toEqual(['bookmark', 'history', 'history']);
  });

  test('a bookmarked address is not listed again from the history', () => {
    const rows = rankSuggestions(
      [bookmark('b', 'Lecture', 'C:\\Files\\Lecture.pdf')],
      [{ id: 'h', title: 'Lecture.pdf', url: 'c:\\files\\lecture.pdf' }],
      'lecture',
      10,
      (path) => path.toLowerCase(),
    );
    expect(ids(rows)).toEqual(['b']);
  });

  test('nothing typed lists everything in the given order', () => {
    const rows = rankSuggestions([bookmark('b1', 'One', '1'), bookmark('b2', 'Two', '2')], [{ id: 'h', title: 'h', url: 'h' }], '', 10);
    expect(ids(rows)).toEqual(['b1', 'b2', 'h']);
  });

  test('the list is capped at the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) => bookmark(`b${i}`, `Note ${i}`, `${i}`));
    expect(rankSuggestions(many, [], 'note', 3)).toHaveLength(3);
  });

  test('a later word-start occurrence counts even when the first occurrence is mid-word', () => {
    const rows = rankSuggestions(
      [bookmark('inside', 'Mygoogle', 'a'), bookmark('later-word', 'Mygoogle google', 'b')],
      [],
      'google',
      10,
    );
    expect(ids(rows)).toEqual(['later-word', 'inside']);
  });
});
