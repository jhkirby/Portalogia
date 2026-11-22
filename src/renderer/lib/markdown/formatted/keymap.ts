// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { baseKeymap, chainCommands, setBlockType } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { NodeSelection, TextSelection, type Command, type Plugin } from 'prosemirror-state';
import { addRowAfter, goToNextCell, isInTable } from 'prosemirror-tables';
import { findAncestor } from './commands';
import { focusSourceEditor } from './nodeViews';
import { noteSchema as schema } from './schema';

const listItem = schema.nodes['list_item']!;

/** Shift+Enter: a line break inside the paragraph (in a code block, just a new line). */
const insertHardBreak: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.spec.code) {
    dispatch?.(state.tr.insertText('\n').scrollIntoView());
    return true;
  }
  dispatch?.(state.tr.replaceSelectionWith(schema.node('hard_break')).scrollIntoView());
  return true;
};

/** Tab in the last cell of a table: a new row, and the caret in its first cell. */
const addRowAtEnd: Command = (state, dispatch, view) => {
  if (!isInTable(state)) {
    return false;
  }
  if (!addRowAfter(state, dispatch)) {
    return false;
  }
  if (dispatch && view) {
    goToNextCell(1)(view.state, view.dispatch);
  }
  return true;
};

/** Tab in a code block: two spaces, rather than leaving it. */
const indentCode: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.type.spec.code) {
    return false;
  }
  dispatch?.(state.tr.insertText('  ').scrollIntoView());
  return true;
};

/**
 * Backspace at the very start of a block that is "something" — a heading, a
 * code block, a list item — makes it plain text again first, as a word
 * processor does, rather than joining it to the block before.
 */
const unformatAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) {
    return false;
  }
  const parent = $from.parent;
  if (parent.type.name === 'heading' || (parent.type.name === 'code_block' && parent.content.size === 0)) {
    return setBlockType(schema.nodes['paragraph']!)(state, dispatch);
  }
  if ($from.depth >= 2 && $from.node(-1).type === listItem && $from.index(-1) === 0) {
    return liftListItem(listItem)(state, dispatch);
  }
  return false;
};

/**
 * Enter on an empty last line of a callout or quote leaves it, as Enter on
 * an empty list item leaves the list.
 */
const leaveContainer: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0 || $from.depth < 2) {
    return false;
  }
  const container = $from.node(-1);
  if ((container.type.name !== 'callout' && container.type.name !== 'blockquote') || $from.index(-1) !== container.childCount - 1) {
    return false;
  }
  if (dispatch) {
    const paragraphStart = $from.before();
    const containerEnd = $from.after(-1);
    const tr = state.tr.delete(paragraphStart, paragraphStart + 2);
    const after = tr.mapping.map(containerEnd);
    tr.insert(after, schema.node('paragraph'));
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Enter on a selected formula or HTML block opens its source for typing. */
const editSelectedAtom: Command = (state, _dispatch, view) =>
  state.selection instanceof NodeSelection && view !== undefined && focusSourceEditor(view);

/** Escape takes the caret out of the note, as in every text box of the app. */
const blur: Command = (_state, _dispatch, view) => {
  (view?.dom as HTMLElement | undefined)?.blur();
  return true;
};

/**
 * The formatted editor's keys. There are no input rules: nothing typed turns
 * into formatting — the toolbar, its shortcuts (sent by main) and the
 * right-click menu do that.
 */
export function buildKeymap(): Plugin[] {
  return [
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      Enter: chainCommands(editSelectedAtom, splitListItem(listItem), leaveContainer),
      'Shift-Enter': insertHardBreak,
      Tab: chainCommands(goToNextCell(1), addRowAtEnd, sinkListItem(listItem), indentCode, () => true),
      'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(listItem), () => true),
      Backspace: unformatAtStart,
      Escape: blur,
    }),
    keymap(baseKeymap),
  ];
}

/** Whether the caret is inside a node of this type (for the toolbar state). */
export function inNode(state: Parameters<Command>[0], typeName: string): boolean {
  return findAncestor(state, (node) => node.type.name === typeName) !== null;
}
