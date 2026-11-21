// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { test, expect } from '@playwright/test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { moveTableColumn, moveTableRow } from '../../src/renderer/lib/markdown/formatted/commands';
import { markdownToDoc } from '../../src/renderer/lib/markdown/formatted/document';
import { docToMarkdown } from '../../src/renderer/lib/markdown/formatted/toMarkdown';

const TABLE = '| A | B |\n| :-- | --: |\n| 1 | 2 |\n| 3 | 4 |\n';

/** An editor state over the table with the caret in the cell holding `text`. */
function caretIn(text: string): EditorState {
  const doc = markdownToDoc(TABLE);
  let at = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      at = pos;
    }
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, at) });
}

/** Runs a command and gives back the note it leaves. */
function after(state: EditorState, command: ReturnType<typeof moveTableRow>): string | null {
  let result: string | null = null;
  const ran = command(state, (tr) => {
    result = docToMarkdown(state.apply(tr).doc);
  });
  return ran ? result : null;
}

test.describe('moving table rows and columns', () => {
  test('a row moves down and up past its neighbour', () => {
    expect(after(caretIn('1'), moveTableRow(1))).toBe('| A | B |\n| :--- | ---: |\n| 3 | 4 |\n| 1 | 2 |\n');
    expect(after(caretIn('3'), moveTableRow(-1))).toBe('| A | B |\n| :--- | ---: |\n| 3 | 4 |\n| 1 | 2 |\n');
  });

  test('the header row stays first: it neither moves nor is moved over', () => {
    expect(after(caretIn('A'), moveTableRow(1))).toBeNull();
    expect(after(caretIn('1'), moveTableRow(-1))).toBeNull();
    expect(after(caretIn('3'), moveTableRow(1))).toBeNull();
  });

  test('a column moves with its header and its alignment', () => {
    expect(after(caretIn('2'), moveTableColumn(-1))).toBe('| B | A |\n| ---: | :--- |\n| 2 | 1 |\n| 4 | 3 |\n');
    expect(after(caretIn('A'), moveTableColumn(-1))).toBeNull();
    expect(after(caretIn('B'), moveTableColumn(1))).toBeNull();
  });
});
