// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { EditorSelection, type SelectionRange } from '@codemirror/state';
import type { Command, EditorView, KeyBinding } from '@codemirror/view';

/**
 * Up or Down that never skips a line of the note. The live preview draws a
 * block the caret isn't in (a whole list, a table) as one rendered widget,
 * and CodeMirror's own vertical motion steps over a widget in one go — past
 * every bullet in the list. So the usual motion is tried first, which keeps
 * moving through a long wrapped line one screen row at a time, and only when
 * it would land more than one line away is the caret put on the very next
 * line instead (at the same column, or its end if shorter). Entering that line
 * turns its block back into text, so the next press carries on line by line.
 * @param forward Down (`true`) or up.
 * @param extend Whether the selection grows (Shift) rather than moving.
 * @returns The command.
 */
function moveOneLine(forward: boolean, extend: boolean): Command {
  return (view: EditorView): boolean => {
    const { state } = view;
    if (state.selection.ranges.length !== 1) {
      return false;
    }
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    const targetNumber = forward ? line.number + 1 : line.number - 1;
    if (targetNumber < 1 || targetNumber > state.doc.lines) {
      return false;
    }
    const moved = view.moveVertically(range, forward);
    if (Math.abs(state.doc.lineAt(moved.head).number - line.number) <= 1) {
      return false;
    }
    const target = state.doc.line(targetNumber);
    const head = target.from + Math.min(range.head - line.from, target.length);
    const next: SelectionRange = extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    view.dispatch({ selection: EditorSelection.create([next]), scrollIntoView: true, userEvent: 'select' });
    return true;
  };
}

/** The bindings, placed ahead of the default keymap so they get the keys first; each falls back to it when not needed. */
export const lineMotionKeymap: readonly KeyBinding[] = [
  { key: 'ArrowDown', run: moveOneLine(true, false), shift: moveOneLine(true, true) },
  { key: 'ArrowUp', run: moveOneLine(false, false), shift: moveOneLine(false, true) },
];
