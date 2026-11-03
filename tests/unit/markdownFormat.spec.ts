// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { test, expect } from '@playwright/test';
import { applyLink, isWebAddress, linkMarkdown, toggleWrap, wrapInBlock } from '../../src/renderer/lib/markdown/editorFormat';

/** The least of an editor the formatting commands use — a state they change by dispatching — so they run without a DOM. */
function fakeEditor(doc: string, from: number, to: number = from): { view: EditorView; text: () => string; selection: () => [number, number] } {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: Parameters<EditorState['update']>[0]) => {
      state = state.update(spec).state;
    },
    focus: () => undefined,
  } as unknown as EditorView;
  return {
    view,
    text: () => state.doc.toString(),
    selection: () => [state.selection.main.from, state.selection.main.to],
  };
}

test.describe('bold and italic', () => {
  test('wrap the selection and keep it selected', () => {
    const editor = fakeEditor('make this loud', 5, 9);
    toggleWrap(editor.view, '**');
    expect(editor.text()).toBe('make **this** loud');
    expect(editor.selection()).toEqual([7, 11]);
  });

  test('a second press takes the markers off again', () => {
    const editor = fakeEditor('make this loud', 5, 9);
    toggleWrap(editor.view, '**');
    toggleWrap(editor.view, '**');
    expect(editor.text()).toBe('make this loud');
  });

  test('with nothing selected a pair goes down with the cursor between', () => {
    const editor = fakeEditor('ab', 1);
    toggleWrap(editor.view, '*');
    expect(editor.text()).toBe('a**b');
    expect(editor.selection()).toEqual([2, 2]);
  });

  test('italic is not fooled by the stars of bold', () => {
    const editor = fakeEditor('a **bold** b', 4, 8);
    toggleWrap(editor.view, '*');
    expect(editor.text()).toBe('a ***bold*** b');
  });

  test('a selection that includes its own markers is unwrapped', () => {
    const editor = fakeEditor('x **bold** y', 2, 10);
    toggleWrap(editor.view, '**');
    expect(editor.text()).toBe('x bold y');
  });
});

test.describe('blocks', () => {
  test('a LaTeX block gets lines of its own around a mid-line selection', () => {
    const editor = fakeEditor('see x^2 here', 4, 7);
    wrapInBlock(editor.view, '$$');
    expect(editor.text()).toBe('see \n$$\nx^2\n$$\n here');
  });

  test('with nothing selected the block is empty and the cursor is inside it', () => {
    const editor = fakeEditor('', 0);
    wrapInBlock(editor.view, '```');
    expect(editor.text()).toBe('```\n\n```');
    expect(editor.selection()).toEqual([4, 4]);
  });

  test('a whole selected line is wrapped without extra blank lines', () => {
    const editor = fakeEditor('one\ncode()\ntwo', 4, 10);
    wrapInBlock(editor.view, '```');
    expect(editor.text()).toBe('one\n```\ncode()\n```\ntwo');
  });
});

test.describe('links', () => {
  test('web addresses and note names are told apart', () => {
    expect(isWebAddress('https://example.com/a')).toBe(true);
    expect(isWebAddress('example.com')).toBe(true);
    expect(isWebAddress('www.example.com/x')).toBe(true);
    expect(isWebAddress('Project Notes')).toBe(false);
    expect(isWebAddress('notes.md')).toBe(false);
  });

  test('a web link wraps the text, adding https:// when it is missing', () => {
    expect(linkMarkdown('example.com', 'the site')).toBe('[the site](https://example.com)');
    expect(linkMarkdown('http://a.test/x', '')).toBe('[a.test/x](http://a.test/x)');
  });

  test('a note link is a wikilink, aliased when the text differs from the name', () => {
    expect(linkMarkdown('Project Notes', '')).toBe('[[Project Notes]]');
    expect(linkMarkdown('Project Notes.md', 'my project')).toBe('[[Project Notes|my project]]');
    expect(linkMarkdown('b', 'b')).toBe('[[b]]');
  });

  test('applyLink replaces the selected range', () => {
    const editor = fakeEditor('see the guide now', 4, 13);
    applyLink(editor.view, 4, 13, 'Guide');
    expect(editor.text()).toBe('see [[Guide|the guide]] now');
  });
});
