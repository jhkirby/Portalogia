// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/** Where a position in a note is: ordinary text, inside `$…$`, or inside a `$$…$$` block. */
export type MathContext = 'none' | 'inline' | 'display';

/** The opening of a fenced code block (backticks or tildes, three or more). */
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Whether the cursor is typing math, for deciding where LaTeX completions apply.
 *
 * Reads the note from the top down to the cursor, tracking what the Markdown
 * reader itself would: `$$` opens and closes a display block (which may span
 * lines), a single `$` opens inline math (never spanning a line, never
 * followed by a space) and the next `$` closes it, a backslash escapes the
 * next character, and nothing inside a code span or fenced code block counts.
 * It sees the note as text up to the cursor, so the formula being typed, which
 * has no closing `$` yet, is still "inside".
 * @param text The note's source.
 * @param position The cursor's offset into it.
 */
export function mathContextAt(text: string, position: number): MathContext {
  const end = Math.min(position, text.length);
  let fence: string | null = null;
  let display = false;
  let inline = false;
  let lineStart = 0;

  while (lineStart <= end) {
    const newline = text.indexOf('\n', lineStart);
    const fullLineEnd = newline === -1 ? text.length : newline;
    const lineEnd = Math.min(fullLineEnd, end);
    const line = text.slice(lineStart, lineEnd);
    // Inline math can't run over a line break.
    inline = false;

    const fenceMatch = display ? null : FENCE_PATTERN.exec(text.slice(lineStart, fullLineEnd));
    if (fence !== null) {
      const closing = new RegExp(`^\\s{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      if (closing.test(text.slice(lineStart, fullLineEnd))) {
        fence = null;
      }
    } else if (fenceMatch) {
      fence = fenceMatch[1] ?? null;
    } else {
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '\\') {
          index += 1;
        } else if (char === '`' && !display && !inline) {
          // A code span: skip to the run of backticks that closes it, if it closes on this line.
          let run = 1;
          while (line[index + run] === '`') {
            run += 1;
          }
          const closeAt = line.indexOf('`'.repeat(run), index + run);
          index = closeAt === -1 ? index + run - 1 : closeAt + run - 1;
        } else if (char === '$') {
          if (line[index + 1] === '$') {
            display = !display;
            inline = false;
            index += 1;
          } else if (display) {
            // A lone `$` inside a display block is just a character.
          } else if (inline) {
            inline = false;
          } else if (line[index + 1] === undefined || !/\s/.test(line[index + 1] ?? '')) {
            inline = true;
          }
        }
      }
    }
    if (newline === -1 || fullLineEnd >= end) {
      break;
    }
    lineStart = newline + 1;
  }
  // An unclosed fence means the cursor is in code, whatever dollars came before it.
  if (fence !== null) {
    return 'none';
  }
  return display ? 'display' : inline ? 'inline' : 'none';
}
