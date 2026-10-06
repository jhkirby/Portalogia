// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/** Which line ending a note's file uses — kept so saving an edit never rewrites every line's ending. */
export type LineEnding = '\n' | '\r\n';

/**
 * The line ending a note uses: CRLF if most of its line breaks are, else LF.
 * A note with no line breaks yet follows the platform's usual choice.
 * @param text The note's source as read from disk.
 */
export function detectLineEnding(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) {
    return '\n';
  }
  return crlf > lf ? '\r\n' : '\n';
}

/** A note's source with every line break as a plain `\n` — what the editor and the renderer work in. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** A note's source (plain `\n` breaks) with the file's own line ending put back. */
export function applyLineEnding(text: string, ending: LineEnding): string {
  return ending === '\n' ? text : text.replace(/\n/g, ending);
}

/** The opening of a task list item: indent, a list marker, then `[ ]` or `[x]`. Group 1 is the text up to the box's own character. */
const TASK_PATTERN = /^(\s{0,}(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\])/;

/** The opening of a fenced code block: backticks or tildes, three or more. */
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Flips the `index`th task checkbox of a note (counting `- [ ]`/`- [x]` items
 * from 0 in reading order, skipping any inside a fenced code block) between
 * done and not done, for a click on that box in the rendered note.
 * @param source The note's source.
 * @param index Which checkbox, in the order the rendered note lists them.
 * @returns The new source, or `null` if there is no such checkbox.
 */
export function toggleTask(source: string, index: number): string | null {
  const lines = source.split('\n');
  let fence: string | null = null;
  let seen = 0;
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber] ?? '';
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const match = TASK_PATTERN.exec(line);
    if (!match) {
      continue;
    }
    if (seen === index) {
      const done = match[2] === ' ';
      const head = match[1] ?? '';
      lines[lineNumber] = `${head}${done ? 'x' : ' '}${line.slice(head.length + 1)}`;
      return lines.join('\n');
    }
    seen += 1;
  }
  return null;
}
