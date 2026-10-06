// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

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
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(var(--color-accent-rgb), 0.35)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(var(--color-accent-rgb), 0.06)' },
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

/** Syntax colours for the Markdown source: headings and emphasis in the text colour, markup dimmed, code and links in the accent. */
export const editorHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: 'var(--color-tab-text-active)', fontWeight: '700' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: 'var(--color-accent-text)' },
    { tag: tags.url, color: 'var(--color-accent-text)' },
    { tag: tags.monospace, color: 'var(--md-code-color)' },
    { tag: tags.quote, color: 'var(--color-tab-text)', fontStyle: 'italic' },
    { tag: tags.processingInstruction, color: 'var(--color-address-placeholder)' },
    { tag: tags.contentSeparator, color: 'var(--color-address-placeholder)' },
    { tag: tags.meta, color: 'var(--color-address-placeholder)' },
    { tag: tags.comment, color: 'var(--color-address-placeholder)' },
    { tag: tags.keyword, color: 'var(--md-syntax-keyword)' },
    { tag: [tags.string, tags.regexp], color: 'var(--md-syntax-string)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--md-syntax-number)' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--md-syntax-function)' },
    { tag: [tags.typeName, tags.className], color: 'var(--md-syntax-type)' },
  ]),
);
