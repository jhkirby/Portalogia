// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { formatPointerPosition, usePointerPosition } from '../../hooks/usePointerPosition';

/** What the terminal's stat bar shows, counted by `Terminal` from xterm's buffer. */
export interface TerminalStats {
  /** The line the cursor is on, counting from the top of the scrollback (1-based). */
  readonly line: number;
  /** Words in the rows on screen. */
  readonly words: number;
  /** Characters in the rows on screen, trailing blanks left off each row. */
  readonly characters: number;
  /** Commands entered in this session (Enter pressed on a line with something typed). */
  readonly commands: number;
  /** The selection's words and characters, or `null` when nothing is selected. */
  readonly selection: { readonly words: number; readonly characters: number } | null;
}

interface TerminalStatusBarProps {
  readonly stats: TerminalStats;
}

/**
 * The bar along the bottom of a terminal tab, like a note's, a PDF's and a web
 * page's: where the pointer is, the cursor's line, the words and characters on
 * screen, the commands entered this session, and while text is selected, its
 * words and characters.
 */
export function TerminalStatusBar({ stats }: TerminalStatusBarProps) {
  const pointer = usePointerPosition();
  const count = (value: number, one: string, many: string): string =>
    `${value.toLocaleString()} ${value === 1 ? one : many}`;

  return (
    <footer className="terminal-status" aria-label="Terminal statistics">
      <span className="terminal-status__item terminal-status__pointer" title="Pointer position in the terminal (x×y, in CSS pixels from its top-left)">
        {formatPointerPosition(pointer)}
      </span>
      <span className="terminal-status__item">Ln {stats.line.toLocaleString()}</span>
      <span className="terminal-status__item">{count(stats.words, 'word', 'words')}</span>
      <span className="terminal-status__item">{count(stats.characters, 'character', 'characters')}</span>
      <span className="terminal-status__item">{count(stats.commands, 'command', 'commands')}</span>
      {stats.selection && (
        <span className="terminal-status__selection" aria-label="Selection">
          <span className="terminal-status__item">Selected:</span>
          <span className="terminal-status__item">{count(stats.selection.words, 'word', 'words')}</span>
          <span className="terminal-status__item">{count(stats.selection.characters, 'character', 'characters')}</span>
        </span>
      )}
    </footer>
  );
}
