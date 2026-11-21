// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { test, expect } from '@playwright/test';
import type { Node } from 'prosemirror-model';
import { listCodeBlocks } from '../../src/shared/markdown/parser';
import { markdownToDoc, posOfSourceOffset, sourceOffsetOf } from '../../src/renderer/lib/markdown/formatted/document';
import { noteSchema as schema } from '../../src/renderer/lib/markdown/formatted/schema';
import { docToMarkdown } from '../../src/renderer/lib/markdown/formatted/toMarkdown';

/** A note using every construct the editor knows, plus some it only carries along. */
const SAMPLE = `---
title: Lighthouse
tags: [a, b]
---

# Portalogia Field Notes: The Lighthouse Project

Tags: #project/lighthouse #draft

Some **bold**, *italic*, ***both***, __under__, _under em_, ~~struck~~, \`code\`, and ==highlighted== text.
A second line of the same paragraph, with a [link](https://example.com "Title") and https://bare.example.com.

- A plain wiki link: [[Lighthouse Budget]]
- To a heading: [[Lighthouse Budget#Q3 Costs]]
- With an alias: [[Keeper's Log|the keeper's diary]]
- Embedded: ![[Weather Station Readings]]

![[lamp.png|200]]

![Lighthouse at dusk](https://example.com/lighthouse.jpg)

![Local|320](../pics/my%20lamp.png)

> [!note]
> The lamp is serviced every Tuesday.

> [!warning]- Folded warning
> The third stair from the top is loose.

> A plain quote.
>> Nested.

1. Climb the stairs
2. Check the lamp
   1. Wipe the lens
3. Log the results
   - Wind speed

* star bullets
* second

- [x] Order bulbs
- [ ] Fix the stair
  - [ ] Draft

Inline math $d = \\sqrt{2Rh}$ and prose costs $5 and $6.

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`python
print("hi")
\`\`\`

~~~
tilde fence
~~~

    indented code

| Keeper | Shift   | Hours |
| :----- | :-----: | ----: |
| Ada    | Night   |    12 |
| Grace  | Morning |     8 |

<details>
<summary>Raw HTML</summary>

Hidden **content**.

</details>

Keyboard: <kbd>Ctrl</kbd> + <kbd>M</kbd>

[ref]: https://example.com/ref

---

Setext heading
==============

***

Last line with a hard break
and after it.
`;

/** The document with one top-level paragraph replaced by a new one holding `text`. */
function replaceBlock(doc: Node, index: number, replacement: Node): Node {
  const children: Node[] = [];
  doc.forEach((child, _offset, i) => children.push(i === index ? replacement : child));
  return doc.type.create(doc.attrs, children);
}

test.describe('untouched notes', () => {
  test('the sample note writes back byte for byte', () => {
    expect(docToMarkdown(markdownToDoc(SAMPLE))).toBe(SAMPLE);
  });

  test('notes without a trailing newline, or with extra blank lines, are kept', () => {
    for (const note of ['one line', '\n\nleading blanks\n', 'a\n\n\n\nb\n\n\n', '', '# only a heading']) {
      expect(docToMarkdown(markdownToDoc(note))).toBe(note === '' ? '\n' : note);
    }
  });

  test('code blocks are numbered the same before and after', () => {
    const after = docToMarkdown(markdownToDoc(SAMPLE));
    expect(listCodeBlocks(after)).toEqual(listCodeBlocks(SAMPLE));
  });
});

test.describe('edits', () => {
  test('editing one paragraph rewrites only that paragraph', () => {
    const source = 'First *para*.\n\n* a\n* b\n\nThird   para.\n';
    const doc = markdownToDoc(source);
    const edited = replaceBlock(doc, 2, schema.node('paragraph', null, schema.text('Changed.')));
    expect(docToMarkdown(edited)).toBe('First *para*.\n\n* a\n* b\n\nChanged.\n');
  });

  test('typed Markdown stays literal text', () => {
    const typed = ['**not bold**', '*nor italic*', '`not code`', '[[not a link]]', '$not math$', '==not marked==', '~~not struck~~', '# not a heading', '- not a list', '1. not numbered', '> not a quote', '---', '<b>not html</b>', '[x](not-a-link)', '| a | b |'];
    for (const text of typed) {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]);
      const written = docToMarkdown(doc);
      const back = markdownToDoc(written);
      expect(back.childCount, `${text} → ${written}`).toBe(1);
      expect(back.child(0).type.name, `${text} → ${written}`).toBe('paragraph');
      expect(back.child(0).textContent, `${text} → ${written}`).toBe(text);
      expect(back.child(0).firstChild?.marks.length ?? 0, `${text} → ${written}`).toBe(0);
    }
  });

  test('ordinary prose is written without needless escapes', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('It costs $5, a_b_c and 2 * 3.'))]);
    expect(docToMarkdown(doc)).toBe('It costs $5, a_b_c and 2 * 3.\n');
  });

  test('marks keep their spelling and expel edge spaces', () => {
    const strong = schema.marks['strong']!.create({ marker: '__' });
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('a'), schema.text(' bold ', [strong]), schema.text('b')]),
    ]);
    expect(docToMarkdown(doc)).toBe('a __bold__ b\n');
  });

  test('every callout type, fold and title survives an edit', () => {
    for (const fold of ['', '+', '-']) {
      const callout = schema.node('callout', { type: 'tip', fold, title: 'My title' }, [
        schema.node('paragraph', null, schema.text('Body')),
      ]);
      const written = docToMarkdown(schema.node('doc', null, [callout]));
      expect(written).toBe(`> [!tip]${fold} My title\n> Body\n`);
      const back = markdownToDoc(written).child(0);
      expect(back.type.name).toBe('callout');
      expect(back.attrs).toMatchObject({ type: 'tip', fold, title: 'My title' });
    }
  });

  test('lists, tasks and tables written afresh read back the same', () => {
    const doc = markdownToDoc(SAMPLE);
    const fresh: Node[] = [];
    doc.forEach((child) => fresh.push(child.type.create({ ...child.attrs, md: null }, child.content, child.marks)));
    const rewritten = docToMarkdown(schema.node('doc', doc.attrs, fresh));
    const again = markdownToDoc(rewritten);
    expect(again.childCount).toBe(doc.childCount);
    doc.forEach((child, _offset, index) => {
      expect(again.child(index).type.name).toBe(child.type.name);
      expect(again.child(index).textContent).toBe(child.textContent);
    });
  });

  test('images keep their width', () => {
    const image = schema.node('image', { src: '../pics/a%20b.png', alt: 'A', width: 240 });
    const written = docToMarkdown(schema.node('doc', null, [schema.node('paragraph', null, [image])]));
    expect(written).toBe('![A|240](../pics/a%20b.png)\n');
    const back = markdownToDoc(written).child(0).firstChild;
    expect(back?.attrs).toMatchObject({ src: '../pics/a%20b.png', alt: 'A', width: 240 });
  });
});

test.describe('caret mapping', () => {
  test('a source offset maps into its block and back', () => {
    const source = '# Title\n\nSome text here.\n';
    const doc = markdownToDoc(source);
    const offset = source.indexOf('text');
    const pos = posOfSourceOffset(doc, offset);
    expect(sourceOffsetOf(doc, pos)).toBe(offset);
  });
});

