// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import type { EditorView } from '@codemirror/view';

/**
 * Wraps the selection in `marker` on both sides — or takes the marker off if
 * the selection already has it (just outside it, or as its own first and last
 * characters). With nothing selected it puts a pair down with the cursor
 * between, ready to type the bold or italic text.
 * @param marker `**` for bold, `*` for italic.
 */
export function toggleWrap(view: EditorView, marker: string): void {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const width = marker.length;
  const selected = doc.sliceString(from, to);

  // A single `*` next to another is part of a bold marker, not an italic one.
  const isMarkerAt = (start: number): boolean => {
    if (start < 0 || start + width > doc.length || doc.sliceString(start, start + width) !== marker) {
      return false;
    }
    if (marker === '*') {
      return doc.sliceString(start - 1, start) !== '*' && doc.sliceString(start + 1, start + 2) !== '*';
    }
    return true;
  };

  if (from !== to && isMarkerAt(from - width) && isMarkerAt(to)) {
    // The markers sit just outside the selection: remove them, keeping the text selected.
    view.dispatch({
      changes: [
        { from: from - width, to: from },
        { from: to, to: to + width },
      ],
      selection: { anchor: from - width, head: to - width },
    });
  } else if (selected.length > 2 * width && selected.startsWith(marker) && selected.endsWith(marker) && !(marker === '*' && selected.startsWith('**'))) {
    // The selection includes its own markers.
    view.dispatch({
      changes: { from, to, insert: selected.slice(width, selected.length - width) },
      selection: { anchor: from, head: to - 2 * width },
    });
  } else if (from === to) {
    view.dispatch({ changes: { from, insert: marker + marker }, selection: { anchor: from + width } });
  } else {
    view.dispatch({
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      selection: { anchor: from + width, head: to + width },
    });
  }
  view.focus();
}

/**
 * Wraps the selection in a block with its own opening and closing lines
 * (`$$ … $$` for LaTeX, a fenced block for code), starting on a fresh line and
 * ending the line after, so the fences are always on lines of their own. With
 * nothing selected it makes an empty block and puts the cursor inside it.
 * @param fence `$$` or three backticks.
 */
export function wrapInBlock(view: EditorView, fence: string): void {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const selected = doc.sliceString(from, to);
  const startsLine = doc.lineAt(from).from === from;
  const endsLine = doc.lineAt(to).to === to;
  const before = startsLine ? '' : '\n';
  const after = endsLine ? '' : '\n';
  const body = selected === '' ? '\n\n' : `\n${selected}\n`;
  const insert = `${before}${fence}${body}${fence}${after}`;
  // Empty: the cursor goes on the blank line between the fences. Otherwise it goes after the block.
  const cursor = selected === '' ? from + before.length + fence.length + 1 : from + insert.length;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor } });
  view.focus();
}

/** Whether what was typed into the link box is a web address, as opposed to the name of a note. */
export function isWebAddress(target: string): boolean {
  // `.md` is a country domain too, but a name ending in it is far more likely a note.
  if (/\.(md|markdown)$/i.test(target)) {
    return false;
  }
  return /^(https?:\/\/|mailto:)/i.test(target) || /^(www\.)?[^\s/]+\.[a-z]{2,}(?::\d+)?(\/\S*)?$/i.test(target);
}

/**
 * The Markdown for a link to `target` showing `label`: an ordinary link for a
 * web address (a bare `example.com` gets `https://`), or a `[[wikilink]]` for
 * the name of a note.
 * @param target What was typed into the link box.
 * @param label The text the link shows — the selection, or `''`.
 */
export function linkMarkdown(target: string, label: string): string {
  const trimmed = target.trim();
  if (isWebAddress(trimmed)) {
    const address = /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return `[${label === '' ? trimmed.replace(/^https?:\/\//i, '') : label}](${address})`;
  }
  const name = trimmed.replace(/\.(md|markdown)$/i, '');
  return label === '' || label === name ? `[[${name}]]` : `[[${name}|${label}]]`;
}

/**
 * Replaces the range `[from, to)` (what was selected when the link box
 * opened) with a link to `target`.
 */
export function applyLink(view: EditorView, from: number, to: number, target: string): void {
  const insert = linkMarkdown(target, view.state.doc.sliceString(from, to));
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
  view.focus();
}

/** The most rows and columns the table box takes: bigger is a spreadsheet's job, and the Markdown gets unreadable. */
export const TABLE_MAX_ROWS = 50;
export const TABLE_MAX_COLUMNS = 20;

/**
 * The Markdown for an empty table: a header row of "Column 1", "Column 2"…, the `---` row under it, then empty rows.
 * @param rows How many rows, the header row included (at least 1).
 * @param columns How many columns (at least 1).
 */
export function tableMarkdown(rows: number, columns: number): string {
  const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const header = Array.from({ length: columns }, (_, index) => `Column ${index + 1}`);
  const lines = [row(header), row(header.map(() => '---'))];
  for (let index = 1; index < rows; index += 1) {
    lines.push(row(header.map(() => ' ')));
  }
  return lines.join('\n');
}

/**
 * Puts an empty table at the caret: on the caret's line if it's blank, otherwise on a new line after it. A blank line
 * sets it off from the text before and after, which Markdown needs to read it as a table rather than as part of a
 * paragraph. The first header cell's name is left selected, ready to type over.
 * @param at Where the caret was when the table box opened.
 * @param rows How many rows, the header row included.
 * @param columns How many columns.
 */
export function insertTable(view: EditorView, at: number, rows: number, columns: number): void {
  const doc = view.state.doc;
  const line = doc.lineAt(Math.min(at, doc.length));
  const blank = line.text.trim() === '';
  // A blank line is replaced by the table; any other is kept, and the table goes after it.
  const from = blank ? line.from : line.to;
  const to = line.to;
  const previous = blank ? (line.number > 1 ? doc.line(line.number - 1).text : '') : line.text;
  const next = line.number < doc.lines ? doc.line(line.number + 1).text : null;
  // A blank line before, unless the table starts the note or already follows one; one after, unless one follows.
  const before = blank ? (previous.trim() === '' ? '' : '\n') : '\n\n';
  const after = next === null ? '\n' : next.trim() === '' ? '' : '\n';
  const table = tableMarkdown(Math.max(1, rows), Math.max(1, columns));
  const insert = `${before}${table}${after}`;
  const firstCell = from + before.length + 2;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: firstCell, head: firstCell + 'Column 1'.length },
    scrollIntoView: true,
  });
  view.focus();
}
