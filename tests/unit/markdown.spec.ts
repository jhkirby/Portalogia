// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { test, expect } from '@playwright/test';
import { createMarkdownEngine, listCodeBlocks, slugifyHeading, splitWikiTarget } from '../../src/shared/markdown/parser';
import { markdownToPlainText } from '../../src/shared/markdown/plainText';
import { applyLineEnding, detectLineEnding, normalizeLineEndings, toggleTask } from '../../src/shared/markdown/source';

const engine = createMarkdownEngine();

test.describe('wiki links', () => {
  test('a plain link names the note and shows its name', () => {
    const html = engine.render('See [[Project Notes]] now.');
    expect(html).toContain('data-wikilink="Project Notes"');
    expect(html).toContain('>Project Notes</a>');
  });

  test('an alias is what is shown, a heading is kept in the target', () => {
    const html = engine.render('[[Note#Setup|the setup]]');
    expect(html).toContain('data-wikilink="Note#Setup"');
    expect(html).toContain('>the setup</a>');
  });

  test('an embedded image becomes an image to be loaded by main, with its width', () => {
    const html = engine.render('![[diagram.png|300]]');
    expect(html).toContain('data-md-src="diagram.png"');
    expect(html).toContain('width="300"');
  });

  test('markup in a link name can not break out of its attribute', () => {
    const html = engine.render('[[a"><img src=x onerror=alert(1)>]]');
    expect(html).not.toContain('<img src=x');
  });

  test('splitWikiTarget separates the note from the heading and drops the alias', () => {
    expect(splitWikiTarget('Note#Heading|alias')).toEqual({ name: 'Note', heading: 'Heading' });
    expect(splitWikiTarget('Plain')).toEqual({ name: 'Plain', heading: '' });
  });

  test('slugifyHeading lowercases, drops punctuation and joins words with dashes', () => {
    expect(slugifyHeading('  My Heading, Part 2! ')).toBe('my-heading-part-2');
  });
});

test.describe('math', () => {
  test('inline and display formulas keep their TeX source', () => {
    const html = engine.render('Euler: $e^{i\\pi}+1=0$ and\n\n$$\n\\int_0^1 x\\,dx\n$$\n');
    expect(html).toContain('md-math--inline" data-tex="e^{i\\pi}+1=0"');
    expect(html).toContain('md-math--display" data-tex="\\int_0^1 x\\,dx"');
  });

  test('dollar amounts in prose are not math', () => {
    const html = engine.render('It costs $5 and then $6 more.');
    expect(html).not.toContain('md-math');
  });

  test('a formula inside a code span is left alone', () => {
    const html = engine.render('Use `$x$` literally.');
    expect(html).not.toContain('md-math');
  });
});

test.describe('code blocks', () => {
  const note = [
    '```python',
    'print(1)',
    '```',
    '',
    '- item',
    '',
    '  ```js',
    '  console.log(2)',
    '  ```',
    '',
    '> ```bash',
    '> echo 3',
    '> ```',
  ].join('\n');

  test('are numbered in reading order in the rendering', () => {
    const html = engine.render(note);
    expect(html).toContain('data-code-index="0" data-lang="python"');
    expect(html).toContain('data-code-index="1"');
    expect(html).toContain('data-code-index="2" data-lang="bash"');
  });

  test('are listed by main in that same order', () => {
    const blocks = listCodeBlocks(note);
    expect(blocks.map((block) => block.language)).toEqual(['python', 'js', 'bash']);
    expect(blocks[0]?.code).toBe('print(1)');
  });

  test('the numbering restarts on every render', () => {
    engine.render(note);
    expect(engine.render('```\nx\n```')).toContain('data-code-index="0"');
  });
});

test.describe('highlights', () => {
  test('==text== becomes a mark', () => {
    expect(engine.render('a ==big== deal')).toContain('<mark class="md-highlight">big</mark>');
  });
});

test.describe('markdownToPlainText', () => {
  test('drops the markers and keeps the words', () => {
    const text = markdownToPlainText('# Title\n\nSome **bold** and *italic* with `code` and [a link](https://x.test).');
    expect(text).toBe('Title\n\nSome bold and italic with code and a link (https://x.test).\n');
  });

  test('writes lists with their bullets, numbers and task boxes', () => {
    const text = markdownToPlainText('- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo');
    expect(text).toContain('- one\n- two\n  - nested');
    expect(text).toContain('1. first\n2. second');
    expect(text).toContain('- [x] done\n- [ ] todo');
  });

  test('shows a wiki link as the name it displays and keeps formulas as written', () => {
    const text = markdownToPlainText('See [[Note|that note]] and $a^2$.');
    expect(text).toBe('See that note and $a^2$.\n');
  });

  test('writes a callout as its title, not its marker', () => {
    expect(markdownToPlainText('> [!warning] Careful\n> Body text')).toBe('> Warning: Careful\n> Body text\n');
  });

  test('keeps code as written and tables as rows', () => {
    const text = markdownToPlainText('```py\nprint(1)\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(text).toContain('print(1)');
    expect(text).toContain('a | b\n1 | 2');
  });
});

test.describe('line endings', () => {
  test('are detected by majority and restored on save', () => {
    expect(detectLineEnding('a\r\nb\r\nc')).toBe('\r\n');
    expect(detectLineEnding('a\nb\nc')).toBe('\n');
    expect(detectLineEnding('no breaks')).toBe('\n');
    const source = normalizeLineEndings('a\r\nb\r\n');
    expect(source).toBe('a\nb\n');
    expect(applyLineEnding(source, '\r\n')).toBe('a\r\nb\r\n');
  });
});

test.describe('toggleTask', () => {
  const note = '- [ ] one\n- [x] two\n\n```\n- [ ] not a task\n```\n\n1. [ ] three';

  test('flips the nth checkbox, counting only real ones', () => {
    expect(toggleTask(note, 0)).toContain('- [x] one');
    expect(toggleTask(note, 1)).toContain('- [ ] two');
    expect(toggleTask(note, 2)).toContain('1. [x] three');
  });

  test('a checkbox past the end is not found', () => {
    expect(toggleTask(note, 3)).toBeNull();
  });
});
