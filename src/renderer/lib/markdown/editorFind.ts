// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** The find bar's matches in the editor: half-open `[from, to)` ranges of the source, and which one is current (`-1` for none). */
export interface EditorFindState {
  readonly matches: readonly { readonly from: number; readonly to: number }[];
  readonly current: number;
}

export const setEditorFind = StateEffect.define<EditorFindState>();

const matchMark = Decoration.mark({ class: 'cm-find-match' });
const currentMark = Decoration.mark({ class: 'cm-find-match cm-find-match--current' });

/** Paints the find bar's matches in the editor, the current one stronger. Edits map the marks along until the next search replaces them. */
export const editorFindField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setEditorFind)) {
        next = Decoration.set(
          effect.value.matches.map((match, index) =>
            (index === effect.value.current ? currentMark : matchMark).range(match.from, match.to),
          ),
          true,
        );
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
