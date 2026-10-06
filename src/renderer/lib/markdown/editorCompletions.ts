// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { LATEX_ENVIRONMENTS, matchLatexCommands, type LatexCommand } from './latexCommands';
import { mathContextAt } from './mathContext';

/** How many suggestions the list shows at most. */
const MAX_OPTIONS = 14;

/** A command as a completion entry: the snippet's template inserts its argument braces, and the entry reads `\name` with its hint. */
function toCompletion(command: LatexCommand, rank: number): Completion {
  const label = `\\${command.name}`;
  const info = { label, detail: command.detail, type: command.template ? 'function' : 'keyword', boost: rank };
  return command.template ? snippetCompletion(command.template, info) : { ...info, apply: label };
}

/**
 * Completes LaTeX while the cursor is in math (`$…$` or a `$$` block):
 *
 * - **`\comm`** — the commands that begin that way. Ones that take arguments
 *   are inserted with their braces and the cursor in the first.
 * - **a bare word** (`alp`, `sin`) — the same commands without the typed
 *   backslash, which then is added, since `sin` in math is nearly always `\sin`.
 *   It waits for two letters so ordinary variables (`x`, `n`) stay quiet.
 * - **`\begin{`** / **`\end{`** — the environments.
 *
 * Outside math it offers nothing, so prose and code stay unbothered.
 */
export const latexCompletionSource: CompletionSource = (context: CompletionContext): CompletionResult | null => {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  // Cheap checks first: most keystrokes aren't in a candidate token at all.
  const environment = /\\(?:begin|end)\{([A-Za-z*]*)$/.exec(before);
  const command = /\\([A-Za-z]*)$/.exec(before);
  const word = /(?<![\\A-Za-z])([A-Za-z]{2,})$/.exec(before);
  if (!environment && !command && !word) {
    return null;
  }
  if (mathContextAt(state.doc.sliceString(0, pos), pos) === 'none') {
    return null;
  }

  if (environment) {
    const typed = environment[1] ?? '';
    const options = LATEX_ENVIRONMENTS.filter((name) => name.startsWith(typed)).map(
      (name): Completion => ({
        label: name,
        type: 'class',
        // Closing the brace too, unless it is already there.
        apply: state.doc.sliceString(pos, pos + 1) === '}' ? name : `${name}}`,
      }),
    );
    return options.length === 0 ? null : { from: pos - typed.length, options, filter: false };
  }

  const typed = command ? (command[1] ?? '') : (word?.[1] ?? '');
  const from = command ? pos - (typed.length + 1) : pos - typed.length;
  const matches = matchLatexCommands(typed, MAX_OPTIONS);
  if (matches.length === 0) {
    return null;
  }
  // `filter: false`: the list is already the commands that start with what's typed, and a fuzzy match would also offer `\aleph` for "alp".
  return { from, options: matches.map((match, index) => toCompletion(match, MAX_OPTIONS - index)), filter: false };
};

/**
 * Completes `[[` with the names of the notes in the vault.
 * @param listNotes Where the names come from — asked once per use, then remembered by the caller.
 */
export function wikiLinkCompletionSource(listNotes: () => Promise<readonly string[]>): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\[\[[^\]\n|#]*/);
    if (!match) {
      return null;
    }
    const names = await listNotes();
    const typed = match.text.slice(2).toLowerCase();
    const options = names
      .filter((name) => name.toLowerCase().includes(typed))
      .sort((a, b) => Number(b.toLowerCase().startsWith(typed)) - Number(a.toLowerCase().startsWith(typed)) || a.localeCompare(b))
      .slice(0, 40)
      .map(
        (name): Completion => ({
          label: name,
          type: 'text',
          // Closes the link, unless its brackets are already there.
          apply: context.state.doc.sliceString(context.pos, context.pos + 2) === ']]' ? name : `${name}]]`,
        }),
      );
    return options.length === 0 ? null : { from: match.from + 2, options, filter: false };
  };
}
