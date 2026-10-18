// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { test, expect } from '@playwright/test';
import {
  countCharacters,
  extractHeadings,
  extractOutboundLinks,
  fileByteSize,
  wordIndexAt,
  wordStarts,
} from '../../src/shared/markdown/structure';

test.describe('extractHeadings', () => {
  test('finds # headings at every level, with their lines, and strips inline markup', () => {
    const source = '# One\n\ntext\n\n## **Two** `x`\n###### [Six](http://a)\n';
    expect(extractHeadings(source)).toEqual([
      { level: 1, text: 'One', line: 1 },
      { level: 2, text: 'Two x', line: 5 },
      { level: 6, text: 'Six', line: 6 },
    ]);
  });

  test('finds underlined (setext) headings', () => {
    expect(extractHeadings('Title\n=====\n\nSub\n---\n')).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Sub', line: 4 },
    ]);
  });

  test('a rule after a blank line is not a heading, and #tags are not headings', () => {
    expect(extractHeadings('para\n\n---\n#tag text\n')).toEqual([]);
  });

  test('ignores anything inside fenced code, until the fence closes', () => {
    const source = '```sh\n# not a heading\n```\n# Real\n~~~\n## nor this\n~~~~\n';
    expect(extractHeadings(source)).toEqual([{ level: 1, text: 'Real', line: 4 }]);
  });

  test('drops the closing #s of a heading', () => {
    expect(extractHeadings('## Closed ##')).toEqual([{ level: 2, text: 'Closed', line: 1 }]);
  });
});

test.describe('extractOutboundLinks', () => {
  test('finds wikilinks, Markdown links, autolinks and bare addresses in reading order', () => {
    const source = 'See [[Note A]] and [site](https://a.example/x) or <https://b.example> and https://c.example/y.\n[[Other#Part|alias]]';
    expect(extractOutboundLinks(source)).toEqual([
      { kind: 'wiki', target: 'Note A', label: 'Note A', line: 1 },
      { kind: 'link', target: 'https://a.example/x', label: 'site', line: 1 },
      { kind: 'link', target: 'https://b.example', label: 'https://b.example', line: 1 },
      { kind: 'link', target: 'https://c.example/y', label: 'https://c.example/y', line: 1 },
      { kind: 'wiki', target: 'Other#Part', label: 'alias', line: 2 },
    ]);
  });

  test('pictures and embeds are not links, and a picture’s address is not counted as a bare one', () => {
    expect(extractOutboundLinks('![pic](https://a.example/p.png) ![[img.png]]')).toEqual([]);
  });

  test('nothing inside code counts', () => {
    expect(extractOutboundLinks('`[[no]]` and\n```\nhttps://no.example\n```\n')).toEqual([]);
  });
});

test.describe('words', () => {
  test('counts runs of letters and digits, keeping apostrophes and hyphens inside a word', () => {
    expect(wordStarts("It's a well-known **fact**: 42 café — ok")).toEqual([0, 5, 7, 20, 28, 31, 38]);
  });

  test('a caret is on the word it is in, or the last one before it; 0 before the first', () => {
    const starts = wordStarts('  alpha beta gamma');
    expect(wordIndexAt(starts, 0)).toBe(0);
    expect(wordIndexAt(starts, 2)).toBe(1);
    expect(wordIndexAt(starts, 6)).toBe(1);
    expect(wordIndexAt(starts, 8)).toBe(2);
    expect(wordIndexAt(starts, 100)).toBe(3);
  });

  test('an empty text has no words', () => {
    expect(wordStarts('')).toEqual([]);
    expect(wordIndexAt([], 5)).toBe(0);
  });
});

test.describe('sizes', () => {
  test('characters count code points, not UTF-16 units', () => {
    expect(countCharacters('a😀b')).toBe(3);
    expect(countCharacters('')).toBe(0);
  });

  test('bytes are UTF-8, with the file’s own line endings', () => {
    expect(fileByteSize('é\nb', '\n')).toBe(4);
    expect(fileByteSize('é\nb\n', '\r\n')).toBe(7);
  });
});
