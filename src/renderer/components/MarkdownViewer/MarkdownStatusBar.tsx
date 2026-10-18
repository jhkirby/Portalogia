// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useEffect, useRef, useState } from 'react';

/** The fields a keyboard command jumps into, and the Alt+key for each. */
const JUMP_KEYS: Readonly<Record<string, JumpFieldName>> = { KeyG: 'line', KeyC: 'column', KeyW: 'word' };

type JumpFieldName = 'line' | 'column' | 'word';

interface MarkdownStatusBarProps {
  /** The caret's line (1-based), or `null` where there is no caret (the reader). */
  readonly line: number | null;
  readonly lineCount: number;
  /** The caret's column (1-based), or `null` where there is no caret. */
  readonly column: number | null;
  /** The word the caret is on (1-based, 0 before the first), or `null` where there is no caret. */
  readonly word: number | null;
  readonly wordCount: number;
  readonly characters: number;
  readonly links: number;
  /** The file's size on disk, in bytes. */
  readonly bytes: number;
  /** Puts the caret at the start of a line (the number is clamped by the editor). */
  readonly onGoToLine: (line: number) => void;
  /** Puts the caret at a column of its line. */
  readonly onGoToColumn: (column: number) => void;
  /** Puts the caret at the start of a word. */
  readonly onGoToWord: (word: number) => void;
}

/**
 * The bar along the bottom of a note: where the caret is (line, column and
 * word, each a box you can type a number into to jump there — Alt+G, Alt+C
 * and Alt+W go straight to them), and the note's size in words, characters,
 * lines, links and bytes.
 */
export function MarkdownStatusBar({
  line,
  lineCount,
  column,
  word,
  wordCount,
  characters,
  links,
  bytes,
  onGoToLine,
  onGoToColumn,
  onGoToWord,
}: MarkdownStatusBarProps) {
  const barRef = useRef<HTMLElement>(null);

  // Alt+G / Alt+C / Alt+W jump into their box, from anywhere on the page (the editor binds none of them).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const field = JUMP_KEYS[event.code];
      if (!field || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const input = barRef.current?.querySelector<HTMLInputElement>(`input[data-jump="${field}"]`);
      if (input && !input.disabled) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const count = (value: number): string => value.toLocaleString();

  return (
    <footer ref={barRef} className="md-status" aria-label="Note statistics">
      <span className="md-status__item">
        Ln{' '}
        <JumpField name="line" value={line} max={lineCount} shortcut="Alt+G" label="Line" onCommit={onGoToLine} />
        <span className="md-status__total">/{count(lineCount)}</span>
      </span>
      <span className="md-status__item">
        Col <JumpField name="column" value={column} max={null} shortcut="Alt+C" label="Column" onCommit={onGoToColumn} />
      </span>
      <span className="md-status__item">
        Word <JumpField name="word" value={word} max={wordCount} shortcut="Alt+W" label="Word" onCommit={onGoToWord} />
        <span className="md-status__total">/{count(wordCount)}</span>
      </span>
      <span className="md-status__item">{count(characters)} characters</span>
      <span className="md-status__item">
        {count(links)} {links === 1 ? 'link' : 'links'}
      </span>
      <span className="md-status__item">{count(bytes)} bytes</span>
    </footer>
  );
}

interface JumpFieldProps {
  readonly name: JumpFieldName;
  /** The current value, or `null` to show a dash and take no input. */
  readonly value: number | null;
  /** The largest value worth typing, which sets the box's width; `null` for no fixed largest. */
  readonly max: number | null;
  readonly shortcut: string;
  readonly label: string;
  readonly onCommit: (value: number) => void;
}

/**
 * A number in the status bar that can be typed over: Enter jumps there,
 * Escape (or leaving the box) puts the live value back.
 */
function JumpField({ name, value, max, shortcut, label, onCommit }: JumpFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const digits = Math.max(2, String(Math.max(max ?? 0, value ?? 0)).length);

  return (
    <input
      type="text"
      inputMode="numeric"
      className="md-status__field"
      data-jump={name}
      aria-label={`${label} (${shortcut})`}
      title={`${label}: type a number and press Enter to jump (${shortcut})`}
      disabled={value === null}
      value={draft ?? (value === null ? '–' : String(value))}
      style={{ width: `${digits + 1}ch` }}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const requested = Number.parseInt(draft ?? '', 10);
          setDraft(null);
          if (Number.isFinite(requested)) {
            onCommit(requested);
          }
        } else if (event.key === 'Escape') {
          setDraft(null);
        }
      }}
    />
  );
}
