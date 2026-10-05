// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import type { IDecoration, Terminal as XTerm } from '@xterm/xterm';
import type { RGB } from '@shared/color';
import type { FindCommand, FindResult } from '@shared/ipc-contract';
import {
  buildFindPattern,
  clampOccurrence,
  findMatches,
  stepIndex,
  type FindMatch,
  type FindOptions,
} from '@shared/find';

/** How strongly the accent tints the other matches, and the current one, over the terminal's own background. */
const MATCH_ALPHA = 0.4;
const CURRENT_ALPHA = 0.9;

/** Past this many matches, only the current one is painted — a decoration per match is a lot of elements to ask xterm to track. */
const MAX_PAINTED_MATCHES = 3000;

/** The buffer's rows as one string: a wrapped line continues without a break, any other row ends with one. `rowStarts[y]` is where row `y`'s text begins. */
interface IndexedBuffer {
  readonly text: string;
  readonly rowStarts: readonly number[];
  readonly rowLengths: readonly number[];
}

function hexToRgb(hex: string): RGB {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  };
}

function channel(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');
}

/** A decoration's color must be an opaque `#rrggbb`, so a tint is the accent blended over the terminal's background. */
function blend(color: RGB, backgroundHex: string, alpha: number): string {
  const bg = hexToRgb(backgroundHex);
  return `#${channel(color.r * alpha + bg.r * (1 - alpha))}${channel(color.g * alpha + bg.g * (1 - alpha))}${channel(color.b * alpha + bg.b * (1 - alpha))}`;
}

/** Reads every row of the buffer — scrollback and screen — into one searchable string. */
function indexBuffer(term: XTerm): IndexedBuffer {
  const buffer = term.buffer.active;
  let text = '';
  const rowStarts: number[] = [];
  const rowLengths: number[] = [];
  for (let y = 0; y < buffer.length; y += 1) {
    const line = buffer.getLine(y);
    const nextIsContinuation = buffer.getLine(y + 1)?.isWrapped ?? false;
    const raw = line?.translateToString(false) ?? '';
    // A row that wraps onto the next keeps its trailing spaces (they're part of the line); one that ends a line drops them.
    const kept = nextIsContinuation ? raw : raw.replace(/\s+$/, '');
    rowStarts.push(text.length);
    rowLengths.push(kept.length);
    text += kept + (nextIsContinuation ? '' : '\n');
  }
  return { text, rowStarts, rowLengths };
}

/** The row holding a character offset: the last row that starts at or before it. */
function rowAt(indexed: IndexedBuffer, offset: number): number {
  let low = 0;
  let high = indexed.rowStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((indexed.rowStarts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * Find-bar search for one terminal. The bar lives in its own view; this
 * answers its commands for this terminal's buffer, and paints matches with
 * xterm decorations (one per row a match spans), the same way the terminal's
 * highlighter paints its highlights.
 * @param term The terminal whose buffer is searched.
 * @param report Sends the bar the count and current position after every command.
 * @returns `handle` for a command from the bar, and `dispose` to clear everything.
 */
export function createTerminalFind(
  term: XTerm,
  report: (result: FindResult) => void,
): { readonly handle: (command: FindCommand) => void; readonly dispose: () => void } {
  let indexed: IndexedBuffer | null = null;
  let matches: readonly FindMatch[] = [];
  let current = -1;
  let capped = false;
  let color: RGB = { r: 26, g: 115, b: 232 };
  let matchDecorations: IDecoration[] = [];
  let currentDecorations: IDecoration[] = [];

  const backgroundHex = (): string => (term.options.theme?.background as string | undefined) ?? '#1e1e1e';

  const disposeAll = (decorations: IDecoration[]): void => {
    decorations.forEach((decoration) => decoration.dispose());
  };

  /** One decoration per row the match covers, each tinted `colorHex`. */
  const decorate = (match: FindMatch, colorHex: string): IDecoration[] => {
    if (!indexed) {
      return [];
    }
    const buffer = term.buffer.active;
    const cursorAbsoluteY = buffer.baseY + buffer.cursorY;
    const firstRow = rowAt(indexed, match.start);
    const lastRow = rowAt(indexed, match.end - 1);
    const made: IDecoration[] = [];
    for (let y = firstRow; y <= lastRow; y += 1) {
      const rowStart = indexed.rowStarts[y] ?? 0;
      const rowLength = indexed.rowLengths[y] ?? 0;
      const fromCol = y === firstRow ? match.start - rowStart : 0;
      const toCol = y === lastRow ? match.end - rowStart : rowLength;
      const marker = term.registerMarker(y - cursorAbsoluteY);
      if (!marker) {
        continue;
      }
      const decoration = term.registerDecoration({
        marker,
        x: Math.max(0, fromCol),
        width: Math.max(1, toCol - fromCol),
        backgroundColor: colorHex,
      });
      if (decoration) {
        made.push(decoration);
      } else {
        marker.dispose();
      }
    }
    return made;
  };

  const clearAll = (): void => {
    disposeAll(matchDecorations);
    disposeAll(currentDecorations);
    matchDecorations = [];
    currentDecorations = [];
    matches = [];
    indexed = null;
    current = -1;
    capped = false;
  };

  /** Re-paints the current match, and brings it into view if it's off screen. */
  const showCurrent = (): void => {
    disposeAll(currentDecorations);
    currentDecorations = [];
    const match = matches[current];
    if (!match || !indexed) {
      return;
    }
    currentDecorations = decorate(match, blend(color, backgroundHex(), CURRENT_ALPHA));
    const row = rowAt(indexed, match.start);
    const top = term.buffer.active.viewportY;
    if (row < top || row >= top + term.rows) {
      term.scrollToLine(Math.max(0, row - Math.floor(term.rows / 2)));
    }
  };

  const send = (invalid: boolean): void => {
    report({ index: matches.length === 0 ? 0 : current + 1, total: matches.length, capped, invalid });
  };

  const search = (query: string, options: FindOptions): void => {
    clearAll();
    const pattern = buildFindPattern(query, options);
    if (pattern.kind !== 'ok') {
      send(pattern.kind === 'invalid');
      return;
    }
    indexed = indexBuffer(term);
    const found = findMatches(indexed.text, pattern.regExp);
    matches = found.matches;
    capped = found.capped;
    if (matches.length <= MAX_PAINTED_MATCHES) {
      const tint = blend(color, backgroundHex(), MATCH_ALPHA);
      matchDecorations = matches.flatMap((match) => decorate(match, tint));
    }
    // Start at the first match at or below the top of what's on screen, as an editor's find does.
    const top = term.buffer.active.viewportY;
    const firstFromHere = matches.findIndex((match) => rowAt(indexed as IndexedBuffer, match.start) >= top);
    current = matches.length === 0 ? -1 : Math.max(firstFromHere, 0);
    showCurrent();
    send(false);
  };

  const moveTo = (index: number): void => {
    if (index >= 0 && matches.length > 0) {
      current = index;
      showCurrent();
    }
    send(false);
  };

  return {
    handle: (command) => {
      switch (command.action) {
        case 'search':
          color = command.color;
          search(command.query, command.options);
          break;
        case 'step':
          moveTo(stepIndex(current, command.direction, matches.length));
          break;
        case 'goto':
          moveTo(clampOccurrence(command.index, matches.length));
          break;
        case 'clear':
          clearAll();
          break;
      }
    },
    dispose: clearAll,
  };
}
