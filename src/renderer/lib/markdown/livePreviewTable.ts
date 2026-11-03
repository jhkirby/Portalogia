// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

import { redo, undo } from '@codemirror/commands';
import { EditorView, WidgetType } from '@codemirror/view';
import { sourceOffsetForRendered } from './textOffsets';

// ── THE TABLE'S SOURCE ──────────────────────────────────────────────────

/** One cell of a table's source: where its text sits (offsets into the table's source) and the text itself. */
interface SourceCell {
  /** Where its text starts, past the space after the pipe. */
  readonly from: number;
  /** Where its text ends, before the space ahead of the next pipe. */
  readonly to: number;
  /** Its Markdown, trimmed. */
  readonly text: string;
}

/** One row of a table's source: its cells and the line it is on (offsets into the table's source). */
interface SourceRow {
  readonly cells: readonly SourceCell[];
  readonly lineFrom: number;
  readonly lineTo: number;
}

/** A table's source rows, the header first; the `|---|` line under the header isn't one, since it draws nothing. */
interface TableModel {
  readonly rows: readonly SourceRow[];
  /** How many columns the header has, which is how many every drawn row has. */
  readonly columns: number;
}

/** Where a cell of the drawn table is: its row (0, the header, first) and column. */
interface CellAddress {
  readonly row: number;
  readonly col: number;
}

/**
 * The cell at one stretch of a row's line, trimmed of the spaces around its text.
 * An empty cell's text sits one space in, so text typed into it keeps a space each side.
 * @param line The row's line.
 * @param start Where the stretch starts, after its pipe.
 * @param end Where it ends, at the next pipe or the line's end.
 * @param base Where the line starts in the table's source.
 */
function sourceCell(line: string, start: number, end: number, base: number): SourceCell {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(line[from]!)) {
    from += 1;
  }
  while (to > from && /\s/.test(line[to - 1]!)) {
    to -= 1;
  }
  if (from === to) {
    from = Math.min(start + 1, end);
    to = from;
  }
  return { from: base + from, to: base + to, text: line.slice(from, to) };
}

/**
 * A row's cells: the line split at each pipe a backslash doesn't escape, with
 * the pipes at either end (GitHub's tables may leave them out) not starting a cell.
 * @param line The row's line.
 * @param base Where the line starts in the table's source.
 */
function splitRow(line: string, base: number): SourceCell[] {
  let start = 0;
  while (start < line.length && /\s/.test(line[start]!)) {
    start += 1;
  }
  if (line[start] === '|') {
    start += 1;
  }
  let end = line.length;
  while (end > start && /\s/.test(line[end - 1]!)) {
    end -= 1;
  }
  const closed = end > start && line[end - 1] === '|' && line[end - 2] !== '\\';
  const cells: SourceCell[] = [];
  let cellStart = start;
  for (let at = start; at <= end; at += 1) {
    const atPipe = at < end && line[at] === '|' && line[at - 1] !== '\\';
    if (atPipe || at === end) {
      // A closing pipe ends the last cell; the nothing after it isn't one more.
      if (!(at === end && closed)) {
        cells.push(sourceCell(line, cellStart, at, base));
      }
      cellStart = at + 1;
    }
  }
  return cells;
}

/**
 * Reads a table's source into rows of cells.
 * @param source The table's source, its header line first.
 */
function parseTable(source: string): TableModel {
  const rows: SourceRow[] = [];
  let lineFrom = 0;
  source.split('\n').forEach((line, index) => {
    // Line 1 is the `|---|---|` line under the header.
    if (index !== 1) {
      rows.push({ cells: splitRow(line, lineFrom), lineFrom, lineTo: lineFrom + line.length });
    }
    lineFrom += line.length + 1;
  });
  return { rows, columns: rows[0]?.cells.length ?? 0 };
}

/** A cell's Markdown as typed in it: an escaped pipe is just a pipe there. */
function cellDisplayText(markdown: string): string {
  return markdown.replace(/\\\|/g, '|');
}

/**
 * What a cell's typed text is in the table's source: one line, with its pipes
 * escaped so they don't split the cell, and a trailing backslash doubled so it
 * doesn't escape the pipe closing the cell.
 * @param text The cell's text.
 */
function cellMarkdown(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\\$/, '\\\\');
}

/** @returns The cells of a drawn table, row by row, the header first. */
function drawnCells(block: HTMLElement): HTMLElement[][] {
  return Array.from(block.querySelectorAll('table tr')).map((row) =>
    Array.from(row.children).filter((cell): cell is HTMLElement => cell instanceof HTMLTableCellElement),
  );
}

// ── EDITING THE DRAWN TABLE ─────────────────────────────────────────────

/** Draws a block of the note as the reader draws it (`drawRenderedBlock`), for a table to redraw itself with. */
export type BlockDrawer = (source: string, first: boolean, view: EditorView) => HTMLElement;

/** The class on a cell while it is being typed in. */
const EDITING_CLASS = 'cm-lp-table__cell--editing';

/** Each drawn table's editor, by its block. */
const editors = new WeakMap<HTMLElement, TableEditor>();

/**
 * Lets a drawn table be edited where it stands, as a table is in Google Docs:
 * a press on a cell puts the caret in it, showing that cell's Markdown while
 * the rest of the table stays drawn, and what's typed goes straight into the
 * note's source. Tab and Shift+Tab step between cells (Tab past the last adds
 * a row), Enter goes down a row, the arrows leave a cell at its edges, and
 * Escape (or an arrow off the table's top or bottom) goes back to the note's
 * text. Undo and redo are the note's own.
 */
class TableEditor {
  private model: TableModel;
  private cells: HTMLElement[][] = [];
  private editing: CellAddress | null = null;

  /**
   * @param block The drawn table's block.
   * @param source The table's source.
   * @param first Whether it is the note's first block.
   * @param view The editor.
   * @param draw Draws a block, for redrawing a cell or the table.
   */
  public constructor(
    private readonly block: HTMLElement,
    private source: string,
    private readonly first: boolean,
    private readonly view: EditorView,
    private readonly draw: BlockDrawer,
  ) {
    this.model = parseTable(source);
    this.bindCells();
    block.addEventListener('mousedown', (event) => this.handlePress(event));
    block.addEventListener('click', (event) => event.preventDefault());
    block.addEventListener('focusout', () => this.handleFocusOut());
  }

  /** Whether a cell is being typed in. */
  public get isEditing(): boolean {
    return this.editing !== null;
  }

  /**
   * Takes on the table's new source after an edit, keeping the cell being
   * typed in (and its caret) as it is — unless the edit changed the table's
   * shape, which needs it drawn afresh.
   * @param source The new source.
   * @returns Whether it was taken on; `false` means the table must be drawn again.
   */
  public adopt(source: string): boolean {
    const model = parseTable(source);
    if (model.rows.length !== this.model.rows.length || model.columns !== this.model.columns) {
      return false;
    }
    this.source = source;
    this.model = model;
    const editing = this.editing;
    const cell = editing ? this.cells[editing.row]?.[editing.col] : undefined;
    if (editing && cell) {
      // An edit made somewhere other than this cell (undo, redo) shows in it; one typed here already does.
      const shown = cellDisplayText(this.model.rows[editing.row]?.cells[editing.col]?.text ?? '');
      if ((cell.textContent ?? '').trim() !== shown) {
        cell.textContent = shown;
        placeCaret(cell, shown.length);
      }
    }
    return true;
  }

  /**
   * Starts typing in a cell, its Markdown shown in place of its drawing.
   * @param address The cell.
   * @param caret Where in its Markdown the caret goes; past the end goes at the end.
   */
  public beginEdit(address: CellAddress, caret: number): void {
    const cell = this.cells[address.row]?.[address.col];
    if (!cell || this.view.state.readOnly) {
      return;
    }
    if (this.editing && (this.editing.row !== address.row || this.editing.col !== address.col)) {
      this.finishCell(this.editing);
    }
    if (!this.editing || this.editing.row !== address.row || this.editing.col !== address.col) {
      const text = cellDisplayText(this.model.rows[address.row]?.cells[address.col]?.text ?? '');
      cell.textContent = text;
      cell.contentEditable = 'plaintext-only';
      cell.spellcheck = false;
      cell.classList.add(EDITING_CLASS);
      this.editing = address;
    }
    cell.focus({ preventScroll: true });
    placeCaret(cell, caret);
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** @returns Where the table starts in the note. */
  private tableStart(): number {
    return this.view.posAtDOM(this.block);
  }

  /** Finds the drawn cells and wires the keys and typing of each. */
  private bindCells(): void {
    this.cells = drawnCells(this.block);
    // The drawing must match the source row for row, or what's typed could land in the wrong cell; such a table is
    // only drawn.
    if (this.cells.length !== this.model.rows.length) {
      this.cells = [];
      return;
    }
    this.cells.forEach((row, rowIndex) =>
      row.forEach((cell, colIndex) => {
        cell.classList.add('cm-lp-table__cell');
        cell.addEventListener('input', () => this.commit({ row: rowIndex, col: colIndex }));
        cell.addEventListener('keydown', (event) => this.handleKey(event, { row: rowIndex, col: colIndex }));
        cell.addEventListener('beforeinput', (event) => {
          // A cell is one line of the source: Enter moves down a row instead (see `handleKey`).
          if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
            event.preventDefault();
          }
        });
      }),
    );
  }

  /**
   * A press on the table: on a cell, the caret goes to the matching point of
   * its Markdown; Ctrl+press on a link follows it. A press in the cell already
   * being typed in is left to place the caret itself.
   * @param event The press.
   */
  private handlePress(event: MouseEvent): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest<HTMLElement>('th, td');
    const address = cell ? this.addressOf(cell) : null;
    if (address && this.editing && address.row === this.editing.row && address.col === this.editing.col) {
      return;
    }
    event.preventDefault();
    const link = target?.closest<HTMLAnchorElement>('a');
    if (link && (event.ctrlKey || event.metaKey)) {
      const wiki = link.dataset['wikilink'];
      const href = link.getAttribute('href') ?? '';
      if (wiki !== undefined && !wiki.startsWith('#')) {
        void window.portalogiaMarkdown.openLink('wiki', wiki, true);
      } else if (href !== '' && !href.startsWith('#')) {
        void window.portalogiaMarkdown.openLink('link', href, true);
      }
      return;
    }
    if (!cell || !address) {
      return;
    }
    const markdown = cellDisplayText(this.model.rows[address.row]?.cells[address.col]?.text ?? '');
    let caret = markdown.length;
    const point = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (point && cell.contains(point.startContainer)) {
      const before = document.createRange();
      before.setStart(cell, 0);
      before.setEnd(point.startContainer, point.startOffset);
      caret = sourceOffsetForRendered(markdown, before.toString());
    }
    this.beginEdit(address, caret);
  }

  /** @returns Which cell an element of the drawn table is, or `null` for one that isn't a cell. */
  private addressOf(cell: HTMLElement): CellAddress | null {
    for (let row = 0; row < this.cells.length; row += 1) {
      const col = this.cells[row]!.indexOf(cell);
      if (col !== -1) {
        return { row, col };
      }
    }
    return null;
  }

  /**
   * Writes what's in a cell into the note's source, in place of the cell's old text.
   * @param address The cell typed in.
   */
  private commit(address: CellAddress): void {
    const cell = this.cells[address.row]?.[address.col];
    const row = this.model.rows[address.row];
    if (!cell || !row) {
      return;
    }
    const markdown = cellMarkdown((cell.textContent ?? '').trim());
    const start = this.tableStart();
    const sourceCell = row.cells[address.col];
    if (sourceCell) {
      // The note's caret follows into the cell's source, so undo comes back here and Find starts from here.
      const from = start + sourceCell.from;
      this.view.dispatch({
        changes: { from, to: start + sourceCell.to, insert: markdown },
        selection: { anchor: from + markdown.length },
      });
      return;
    }
    // A row written with fewer cells than the header is drawn with empty ones; typing in one writes the row out whole.
    const texts = Array.from({ length: this.model.columns }, (_, col) =>
      col === address.col ? markdown : (row.cells[col]?.text ?? ''),
    );
    this.view.dispatch({
      changes: { from: start + row.lineFrom, to: start + row.lineTo, insert: `| ${texts.join(' | ')} |` },
    });
  }

  /**
   * The keys that move between cells or leave the table, and undo and redo.
   * @param event The key.
   * @param address The cell it was pressed in.
   */
  private handleKey(event: KeyboardEvent, address: CellAddress): void {
    const cell = event.currentTarget as HTMLElement;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) {
        redo(this.view);
      } else {
        undo(this.view);
      }
      return;
    }
    if (mod || event.altKey) {
      return;
    }
    const lastRow = this.cells.length - 1;
    const lastCol = this.model.columns - 1;
    const { start, end, length } = caretIn(cell);
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        if (event.shiftKey) {
          if (address.col > 0) {
            this.beginEdit({ row: address.row, col: address.col - 1 }, Infinity);
          } else if (address.row > 0) {
            this.beginEdit({ row: address.row - 1, col: lastCol }, Infinity);
          }
        } else if (address.col < lastCol) {
          this.beginEdit({ row: address.row, col: address.col + 1 }, Infinity);
        } else if (address.row < lastRow) {
          this.beginEdit({ row: address.row + 1, col: 0 }, Infinity);
        } else {
          this.addRow();
        }
        return;
      case 'Enter':
        event.preventDefault();
        if (event.shiftKey) {
          if (address.row > 0) {
            this.beginEdit({ row: address.row - 1, col: address.col }, Infinity);
          }
        } else if (address.row < lastRow) {
          this.beginEdit({ row: address.row + 1, col: address.col }, Infinity);
        } else {
          this.leave(1);
        }
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.leave(1);
        return;
      case 'ArrowUp':
        if (event.shiftKey) {
          return;
        }
        event.preventDefault();
        if (address.row > 0) {
          this.beginEdit({ row: address.row - 1, col: address.col }, start);
        } else {
          this.leave(-1);
        }
        return;
      case 'ArrowDown':
        if (event.shiftKey) {
          return;
        }
        event.preventDefault();
        if (address.row < lastRow) {
          this.beginEdit({ row: address.row + 1, col: address.col }, start);
        } else {
          this.leave(1);
        }
        return;
      case 'ArrowLeft':
        if (!event.shiftKey && start === 0 && end === 0) {
          event.preventDefault();
          if (address.col > 0) {
            this.beginEdit({ row: address.row, col: address.col - 1 }, Infinity);
          } else if (address.row > 0) {
            this.beginEdit({ row: address.row - 1, col: lastCol }, Infinity);
          } else {
            this.leave(-1);
          }
        }
        return;
      case 'ArrowRight':
        if (!event.shiftKey && start === length && end === length) {
          event.preventDefault();
          if (address.col < lastCol) {
            this.beginEdit({ row: address.row, col: address.col + 1 }, 0);
          } else if (address.row < lastRow) {
            this.beginEdit({ row: address.row + 1, col: 0 }, 0);
          } else {
            this.leave(1);
          }
        }
        return;
      default:
        return;
    }
  }

  /** Adds an empty row under the last one and puts the caret in its first cell (Tab from the table's last cell). */
  private addRow(): void {
    const start = this.tableStart();
    const row = `\n|${' |'.repeat(this.model.columns).replace(/ \|/g, '   |')}`;
    const at = start + this.source.length;
    const address = { row: this.model.rows.length, col: 0 };
    this.view.dispatch({ changes: { from: at, insert: row } });
    focusTableCell(this.view, start, address, 0);
  }

  /**
   * Leaves the table for the note's text: the line above it, or the line
   * below. A table with no line there gets one, since the caret can't sit
   * inside the table's own source without typing into it.
   * @param direction `-1` for above, `1` for below.
   */
  private leave(direction: -1 | 1): void {
    const { state } = this.view;
    const start = this.tableStart();
    const end = start + this.source.length;
    this.finish();
    if (direction === -1) {
      if (start > 0) {
        this.view.dispatch({ selection: { anchor: start - 1 }, scrollIntoView: true });
      } else {
        this.view.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 }, scrollIntoView: true });
      }
    } else if (end < state.doc.length) {
      this.view.dispatch({ selection: { anchor: end + 1 }, scrollIntoView: true });
    } else {
      this.view.dispatch({ changes: { from: end, insert: '\n' }, selection: { anchor: end + 1 }, scrollIntoView: true });
    }
    this.view.focus();
  }

  /** Focus has left a cell: once it settles, if it went somewhere outside the table, typing in it is over. */
  private handleFocusOut(): void {
    setTimeout(() => {
      // The window losing focus leaves the cell as it was, ready to type in again on return.
      if (this.editing && !this.block.contains(document.activeElement)) {
        this.finish();
      }
    }, 0);
  }

  /** Stops typing in the table: the cell being typed in is drawn again. */
  private finish(): void {
    if (this.editing) {
      this.finishCell(this.editing);
    }
  }

  /**
   * Draws a cell that was being typed in as the reader would, from the table's current source.
   * @param address The cell.
   */
  private finishCell(address: CellAddress): void {
    const cell = this.cells[address.row]?.[address.col];
    if (this.editing && this.editing.row === address.row && this.editing.col === address.col) {
      this.editing = null;
    }
    if (!cell) {
      return;
    }
    cell.removeAttribute('contenteditable');
    cell.classList.remove(EDITING_CLASS);
    const drawn = drawnCells(this.draw(this.source, this.first, this.view))[address.row]?.[address.col];
    cell.innerHTML = drawn?.innerHTML ?? '';
  }
}

/**
 * Where the caret (or selection) is in a cell's text.
 * @param cell The cell, holding plain text.
 */
function caretIn(cell: HTMLElement): { start: number; end: number; length: number } {
  const length = cell.textContent?.length ?? 0;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !cell.contains(selection.anchorNode)) {
    return { start: length, end: length, length };
  }
  const range = selection.getRangeAt(0);
  const measure = (node: Node, offset: number): number => {
    const before = document.createRange();
    before.setStart(cell, 0);
    before.setEnd(node, offset);
    return before.toString().length;
  };
  return { start: measure(range.startContainer, range.startOffset), end: measure(range.endContainer, range.endOffset), length };
}

/**
 * Puts the caret at a point of a cell's text.
 * @param cell The cell, holding plain text.
 * @param offset Where; past the end goes at the end.
 */
function placeCaret(cell: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const text = cell.firstChild;
  const range = document.createRange();
  if (text instanceof Text) {
    range.setStart(text, Math.min(Math.max(offset, 0), text.length));
  } else {
    range.selectNodeContents(cell);
    range.collapse(offset <= 0);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Puts the caret in a cell of the table starting at a point of the note, once
 * the editor has drawn it — for after an edit that drew the table afresh.
 * @param view The editor.
 * @param tableStart Where the table starts in the note.
 * @param address The cell.
 * @param caret Where in its Markdown the caret goes.
 */
function focusTableCell(view: EditorView, tableStart: number, address: CellAddress, caret: number): void {
  requestAnimationFrame(() => {
    for (const block of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-lp-table'))) {
      const editor = editors.get(block);
      if (editor && view.posAtDOM(block) === tableStart) {
        editor.beginEdit(address, caret);
        return;
      }
    }
  });
}

/**
 * Puts the caret in a table the note's own caret has just moved onto — with
 * the arrows from the line above or below — so the keys carry on into its
 * cells: the first cell from above, the last row's first from below.
 * @param view The editor.
 * @param tableStart Where the table starts in the note.
 * @param fromAbove Whether the caret came from above.
 */
export function enterTable(view: EditorView, tableStart: number, fromAbove: boolean): void {
  requestAnimationFrame(() => {
    for (const block of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-lp-table'))) {
      const editor = editors.get(block);
      if (editor && view.posAtDOM(block) === tableStart) {
        const rows = block.querySelectorAll('table tr').length;
        editor.beginEdit({ row: fromAbove ? 0 : Math.max(rows - 1, 0), col: 0 }, fromAbove ? 0 : Infinity);
        return;
      }
    }
  });
}

/**
 * A table of the note, drawn as the reader draws it and kept drawn while it's
 * edited (see `TableEditor`), rather than turning to its Markdown when the
 * caret comes to it as other blocks do.
 */
export class TableWidget extends WidgetType {
  /**
   * @param source The table's source.
   * @param first Whether it is the note's first block.
   * @param draw Draws a block as the reader does.
   */
  public constructor(
    private readonly source: string,
    private readonly first: boolean,
    private readonly draw: BlockDrawer,
  ) {
    super();
  }

  /**
   * @param other The widget it would replace.
   * @returns Whether it draws the same thing.
   */
  public override eq(other: TableWidget): boolean {
    return other.source === this.source && other.first === this.first;
  }

  /** @returns A guess at its height before it's drawn. */
  public override get estimatedHeight(): number {
    return this.source.split('\n').length * 36;
  }

  /**
   * @param view The editor.
   * @returns The drawn, editable table.
   */
  public override toDOM(view: EditorView): HTMLElement {
    const block = this.draw(this.source, this.first, view);
    block.classList.add('cm-lp-table');
    editors.set(block, new TableEditor(block, this.source, this.first, view, this.draw));
    return block;
  }

  /**
   * Keeps the table's DOM through an edit typed into one of its cells, so the
   * caret stays put; any other change draws it afresh.
   * @param dom The table's block.
   * @param view The editor.
   * @returns Whether the DOM was kept.
   */
  public override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const editor = editors.get(dom);
    if (!editor?.isEditing || this.first !== dom.classList.contains('cm-lp-block--first')) {
      return false;
    }
    if (editor.adopt(this.source)) {
      return true;
    }
    // The table changed shape (an undone row): drawn afresh, the caret goes back to its first cell.
    focusTableCell(view, view.posAtDOM(dom), { row: 0, col: 0 }, Infinity);
    return false;
  }

  /** @returns `true`: the table handles its own presses and keys. */
  public override ignoreEvent(): boolean {
    return true;
  }
}
