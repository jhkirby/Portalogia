// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { Fragment, type Mark, type Node } from 'prosemirror-model';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { noteSchema as schema } from './schema';

/** A block that contains the selection: the node and where it starts. */
export interface FoundBlock {
  readonly node: Node;
  readonly pos: number;
  readonly depth: number;
}

/**
 * The innermost node around the selection's start that passes a test.
 * @param state The editor state.
 * @param test Which node to look for.
 */
export function findAncestor(state: EditorState, test: (node: Node) => boolean): FoundBlock | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (test(node)) {
      return { node, pos: $from.before(depth), depth };
    }
  }
  return null;
}

/** The node a node selection holds, if the selection is one and it's of this type. */
export function selectedNode(state: EditorState, typeName?: string): { readonly node: Node; readonly pos: number } | null {
  const selection = state.selection;
  if (selection instanceof NodeSelection && (typeName === undefined || selection.node.type.name === typeName)) {
    return { node: selection.node, pos: selection.from };
  }
  return null;
}

// ── MARKS ───────────────────────────────────────────────────────────────

/** Bold on or off over the selection (or for what's typed next). */
export const toggleBold: Command = toggleMark(schema.marks['strong']!);

/** Italic on or off over the selection (or for what's typed next). */
export const toggleItalic: Command = toggleMark(schema.marks['em']!);

/** Highlight on or off. */
export const toggleHighlight: Command = toggleMark(schema.marks['highlight']!);

/** Strikethrough on or off. */
export const toggleStrike: Command = toggleMark(schema.marks['strike']!);

/** Inline code on or off. */
export const toggleCode: Command = toggleMark(schema.marks['code']!);

/**
 * The stretch of a mark of this type around a position: where a link the caret sits in starts and ends.
 * @param state The editor state.
 * @param pos A position inside (or at the edge of) the marked text.
 * @param typeName The mark's type.
 */
export function markExtent(state: EditorState, pos: number, typeName: string): { from: number; to: number; mark: Mark } | null {
  const type = schema.marks[typeName]!;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const around = parent.maybeChild(index) ?? parent.maybeChild(index - 1);
  const mark = (parent.maybeChild(index)?.marks ?? []).find((m) => m.type === type) ??
    (parent.maybeChild(index - 1)?.marks ?? []).find((m) => m.type === type);
  if (!around || !mark) {
    return null;
  }
  // Walk the parent's children, collecting the run that carries this exact mark and touches the position.
  const start = $pos.start();
  let from = -1;
  let to = -1;
  let offset = start;
  let result: { from: number; to: number; mark: Mark } | null = null;
  parent.forEach((child) => {
    const childFrom = offset;
    const childTo = offset + child.nodeSize;
    offset = childTo;
    if (mark.isInSet(child.marks)) {
      if (from === -1) {
        from = childFrom;
      }
      to = childTo;
    } else {
      if (from !== -1 && from <= pos && pos <= to) {
        result ??= { from, to, mark };
      }
      from = -1;
    }
  });
  if (from !== -1 && from <= pos && pos <= to) {
    result ??= { from, to, mark };
  }
  return result;
}

// ── BLOCKS ──────────────────────────────────────────────────────────────

/**
 * Makes the blocks in the selection headings of a level, or (level 0) plain paragraphs.
 * @param level 0 for normal text, 1–6 for a heading.
 */
export function setHeading(level: number): Command {
  return level === 0
    ? setBlockType(schema.nodes['paragraph']!)
    : setBlockType(schema.nodes['heading']!, { level: Math.max(1, Math.min(6, level)) });
}

/** The kind of list a toolbar button makes. */
export type ListKind = 'bullet' | 'ordered' | 'task';

/** The kind of list a list node is: a bullet list whose items all carry a checkbox is a checklist. */
function listKindOf(list: Node): ListKind {
  if (list.type.name === 'ordered_list') {
    return 'ordered';
  }
  let allTasks = list.childCount > 0;
  list.forEach((item) => {
    if (item.attrs['checked'] === null) {
      allTasks = false;
    }
  });
  return allTasks ? 'task' : 'bullet';
}

/**
 * The list toolbar buttons: inside a list of the same kind, takes the
 * selection out of it; inside another kind, turns that list into this kind;
 * elsewhere, wraps the selected blocks in a new list.
 * @param kind Bullets, numbers or checkboxes.
 */
export function toggleList(kind: ListKind): Command {
  return (state, dispatch) => {
    const list = findAncestor(state, (node) => node.type.name === 'bullet_list' || node.type.name === 'ordered_list');
    if (list) {
      if (listKindOf(list.node) === kind) {
        return liftListItem(schema.nodes['list_item']!)(state, dispatch);
      }
      if (dispatch) {
        const type = kind === 'ordered' ? schema.nodes['ordered_list']! : schema.nodes['bullet_list']!;
        const tr = state.tr.setNodeMarkup(list.pos, type, type === list.node.type ? list.node.attrs : null);
        let itemPos = list.pos + 1;
        list.node.forEach((item) => {
          tr.setNodeMarkup(itemPos, undefined, { ...item.attrs, checked: kind === 'task' ? Boolean(item.attrs['checked']) : null });
          itemPos += item.nodeSize;
        });
        dispatch(tr);
      }
      return true;
    }
    const type = kind === 'ordered' ? schema.nodes['ordered_list']! : schema.nodes['bullet_list']!;
    return wrapInList(type)(state, (tr) => {
      if (kind === 'task' && dispatch) {
        // The new list's items become task items.
        const $from = tr.selection.$from;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type === type) {
            const start = $from.before(depth);
            let itemPos = start + 1;
            node.forEach((item) => {
              tr.setNodeMarkup(itemPos, undefined, { ...item.attrs, checked: false });
              itemPos += item.nodeSize;
            });
            break;
          }
        }
      }
      dispatch?.(tr);
    });
  };
}

/**
 * Puts the selected blocks in a callout of a type — or, already in one,
 * changes its type.
 * @param type The callout type (`note`, `tip`, `warning`…).
 */
export function insertCallout(type: string): Command {
  return (state, dispatch) => {
    const callout = findAncestor(state, (node) => node.type.name === 'callout');
    if (callout) {
      dispatch?.(state.tr.setNodeMarkup(callout.pos, undefined, { ...callout.node.attrs, type }));
      return true;
    }
    return wrapIn(schema.nodes['callout']!, { type })(state, dispatch);
  };
}

/**
 * Takes a callout or quote's blocks out of it, keeping them.
 * @param pos Where the callout starts.
 */
export function unwrapBlock(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr.replaceWith(pos, pos + node.nodeSize, node.content);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Puts a block node after the block the caret is in (or in place of an
 * empty paragraph), and the caret where it makes sense: inside the new block
 * if it holds text, else on a fresh paragraph after it.
 * @param tr The transaction to add to (its selection says where).
 * @param node The block to put in.
 * @param select Select the new block itself (an atom whose node view edits it).
 */
export function placeBlock(tr: Transaction, node: Node, select = false): Transaction {
  const { $from } = tr.selection;
  // The deepest block around the caret whose parent may hold the new block after it (a table cell can't; the table can).
  let depth = $from.depth;
  while (depth > 1) {
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1) + 1;
    if (parent.canReplaceWith(index, index, node.type)) {
      break;
    }
    depth -= 1;
  }
  depth = Math.max(depth, 1);
  const block = $from.node(depth);
  let at: number;
  if (block.type.name === 'paragraph' && block.content.size === 0) {
    at = $from.before(depth);
    tr.replaceWith(at, at + block.nodeSize, node);
  } else {
    at = $from.after(depth);
    tr.insert(at, node);
  }
  const after = at + node.nodeSize;
  if (select && node.isAtom) {
    tr.setSelection(NodeSelection.create(tr.doc, at));
  } else if (node.isTextblock || node.type.name === 'table' || node.type.name === 'callout') {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  } else {
    if (!tr.doc.resolve(after).nodeAfter?.isTextblock) {
      tr.insert(after, schema.node('paragraph'));
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
  }
  return tr.scrollIntoView();
}

/** `placeBlock` as a command. */
export function insertBlock(node: Node, select = false): Command {
  return (state, dispatch) => {
    dispatch?.(placeBlock(state.tr, node, select));
    return true;
  };
}

/** A horizontal rule after the current block, with the caret on a paragraph after it. */
export const insertDivider: Command = (state, dispatch) => insertBlock(schema.node('horizontal_rule'))(state, dispatch);

/**
 * A code block: the selected text, if any, moved into one; otherwise the
 * caret's paragraph turned into one (or a new one put after it).
 */
export const insertCodeBlock: Command = (state, dispatch) => {
  const { from, to, empty, $from } = state.selection;
  const codeType = schema.nodes['code_block']!;
  if (!empty) {
    const text = state.doc.textBetween(from, to, '\n');
    dispatch?.(placeBlock(state.tr.deleteSelection(), codeType.create(null, text === '' ? null : schema.text(text))));
    return true;
  }
  if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
    return setBlockType(codeType)(state, dispatch);
  }
  return insertBlock(codeType.create())(state, dispatch);
};

/** A display-math block holding the selected text as its TeX (or empty), selected so its editor opens. */
export const insertMathBlock: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  const tex = empty ? '' : state.doc.textBetween(from, to, ' ');
  const tr = empty ? state.tr : state.tr.deleteSelection();
  dispatch?.(placeBlock(tr, schema.node('math_block', { tex }), true));
  return true;
};

/** A raw HTML block, selected so its source box opens. */
export const insertHtmlBlock: Command = (state, dispatch) => insertBlock(schema.node('html_block', { html: '' }), true)(state, dispatch);

/**
 * An empty table: a header row of "Column 1", "Column 2"… and empty rows under it.
 * @param rows How many rows, the header row included.
 * @param columns How many columns.
 */
export function insertTable(rows: number, columns: number): Command {
  const header = schema.node(
    'table_row',
    null,
    Array.from({ length: columns }, (_, index) => schema.node('table_header', null, schema.text(`Column ${index + 1}`))),
  );
  const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
    schema.node('table_row', null, Array.from({ length: columns }, () => schema.node('table_cell'))),
  );
  return insertBlock(schema.node('table', null, [header, ...body]));
}

/**
 * A picture at the caret (replacing the selection).
 * @param src Its path relative to the note (or a web address).
 * @param alt Its description.
 */
export function insertImage(src: string, alt: string): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(schema.node('image', { src, alt })).scrollIntoView());
    return true;
  };
}

/**
 * Removes the node at a position, leaving the caret where it stood.
 * @param pos Where the node starts.
 */
export function removeNodeAt(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr.delete(pos, pos + node.nodeSize);
      if (tr.doc.content.size === 0 || tr.doc.childCount === 0) {
        tr.insert(0, schema.node('paragraph'));
      }
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Lifts the selected blocks out of whatever wraps them (a quote's ✕ falls back on this). */
export const liftOut: Command = lift;

/** An empty paragraph-only fragment — what an emptied container is refilled with. */
export const EMPTY_PARAGRAPH = Fragment.from(schema.node('paragraph'));

// ── MOVING TABLE ROWS AND COLUMNS ───────────────────────────────────────

/** Where the caret's cell sits in its table: the table, and the cell's row and column. */
function cellPlace(state: EditorState): { table: FoundBlock; row: number; column: number } | null {
  const table = findAncestor(state, (node) => node.type.name === 'table');
  const cell = findAncestor(state, (node) => node.type.name === 'table_cell' || node.type.name === 'table_header');
  if (!table || !cell) {
    return null;
  }
  const $cell = state.doc.resolve(cell.pos);
  return { table, row: $cell.index(-1), column: $cell.index() };
}

/**
 * Replaces a table with one built from new rows of cells, and puts the caret in the cell at `[row, column]`.
 * @param rows Each row's cells, in order.
 */
function rebuildTable(state: EditorState, table: FoundBlock, rows: Node[][], row: number, column: number): Transaction {
  const rowType = schema.nodes['table_row']!;
  const rebuilt = table.node.type.create(
    table.node.attrs,
    rows.map((cells) => rowType.create(null, cells)),
  );
  const tr = state.tr.replaceWith(table.pos, table.pos + table.node.nodeSize, rebuilt);
  // The caret goes back into the cell that moved: walk to it in the new table.
  let pos = table.pos + 1;
  for (let index = 0; index < row; index += 1) {
    pos += rebuilt.child(index).nodeSize;
  }
  pos += 1;
  for (let index = 0; index < column; index += 1) {
    pos += rebuilt.child(row).child(index).nodeSize;
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  return tr.scrollIntoView();
}

/** A table's rows as arrays of cells. */
function tableCells(table: Node): Node[][] {
  const rows: Node[][] = [];
  table.forEach((row) => {
    const cells: Node[] = [];
    row.forEach((cell) => cells.push(cell));
    rows.push(cells);
  });
  return rows;
}

/**
 * Moves the caret's row up or down one place. The header row stays first: a
 * Markdown table's first row is always its header, so it neither moves nor is
 * swapped with.
 * @param direction `-1` up, `1` down.
 */
export function moveTableRow(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const place = cellPlace(state);
    if (!place) {
      return false;
    }
    const target = place.row + direction;
    const rows = tableCells(place.table.node);
    if (place.row === 0 || target < 1 || target >= rows.length) {
      return false;
    }
    if (dispatch) {
      [rows[place.row], rows[target]] = [rows[target]!, rows[place.row]!];
      dispatch(rebuildTable(state, place.table, rows, target, place.column));
    }
    return true;
  };
}

/**
 * Moves the caret's column left or right one place, in every row (the
 * header's cell, and the column's alignment, go with it).
 * @param direction `-1` left, `1` right.
 */
export function moveTableColumn(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const place = cellPlace(state);
    if (!place) {
      return false;
    }
    const target = place.column + direction;
    const rows = tableCells(place.table.node);
    if (target < 0 || rows.some((cells) => target >= cells.length || place.column >= cells.length)) {
      return false;
    }
    if (dispatch) {
      for (const cells of rows) {
        [cells[place.column], cells[target]] = [cells[target]!, cells[place.column]!];
      }
      dispatch(rebuildTable(state, place.table, rows, place.row, target));
    }
    return true;
  };
}
