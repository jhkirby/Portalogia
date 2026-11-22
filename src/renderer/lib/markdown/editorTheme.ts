// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { EditorView } from '@codemirror/view';

/**
 * The editor's look, drawn from the page's own colour tokens so it follows
 * the light/dark theme and the accent with no theme switch of its own.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--color-tab-text-active)',
    backgroundColor: 'transparent',
    fontSize: 'var(--md-editor-font-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--md-font-mono)',
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--color-accent-text)',
    maxWidth: 'var(--md-column-width)',
    margin: '0 auto',
    padding: '2rem 1.5rem 40vh',
  },
  // The formatted editor is as wide as the toolbar's width slider says (`useNoteWidth`); the raw text keeps its column.
  '&.cm-live-preview .cm-content': { maxWidth: 'var(--md-formatted-width, var(--md-column-width))' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(var(--color-accent-rgb), 0.35)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(var(--color-accent-rgb), 0.06)' },
  // The caret's line is only marked while there is a caret: an editor without focus shows none.
  '&:not(.cm-focused) .cm-activeLine': { backgroundColor: 'transparent' },
  // Line numbers are handles, not text: they can't be selected, and a press selects their line (`MarkdownEditor`).
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--color-address-placeholder)',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.9em 0 1.2em', borderRadius: '4px 0 0 4px', cursor: 'pointer' },
  // Hovering one lights it up in place, no movement.
  '.cm-lineNumbers .cm-gutterElement:hover': {
    color: 'var(--color-tab-text-active)',
    backgroundColor: 'var(--color-button-hover-bg)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLineGutter': { color: 'var(--color-tab-text-active)' },
  // Raw text reads like a code editor: from the left edge, beside its line numbers, rather than in the reading column.
  // Raw text is the characters as typed: no font ligatures either (a monospace font draws `->` as an arrow).
  '&.cm-raw .cm-content': {
    maxWidth: 'none',
    margin: '0',
    padding: '2rem 1.5rem 40vh 0',
    fontVariantLigatures: 'none',
    fontFeatureSettings: '"liga" 0, "calt" 0',
  },

  '.cm-line': { padding: '0' },
  // The text-box look of the app's other inputs for the completion list.
  '.cm-tooltip': {
    backgroundColor: 'var(--color-panel-bg)',
    border: '1px solid var(--color-panel-border)',
    borderRadius: 'var(--size-radius-sm)',
    color: 'var(--color-tab-text-active)',
    fontFamily: 'var(--md-font-ui)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--md-font-mono)', maxHeight: '16em' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--color-selection-bg)',
    color: 'var(--color-tab-text-active)',
  },
  '.cm-completionDetail': { color: 'var(--color-address-placeholder)', fontStyle: 'normal', marginLeft: '0.8em' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--color-accent-text)', fontWeight: '600' },
  '.cm-snippetField': { backgroundColor: 'rgba(var(--color-accent-rgb), 0.2)' },
  '.cm-wikilink': { color: 'var(--color-accent-text)' },
  '.cm-math': { color: 'var(--md-math-color)' },
  '.cm-find-match': { backgroundColor: 'rgba(var(--color-accent-rgb), 0.35)', borderRadius: '2px' },
  '.cm-find-match--current': { backgroundColor: 'rgba(var(--color-accent-rgb), 0.75)' },
});

