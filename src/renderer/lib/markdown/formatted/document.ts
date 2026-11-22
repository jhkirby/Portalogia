// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import type { Node } from 'prosemirror-model';
import { parseMarkdown } from './fromMarkdown';
import { noteSchema as schema } from './schema';
import { serializeBlock, writeDoc } from './toMarkdown';

/**
 * A note's Markdown as the formatted editor's document. Each top-level block
 * remembers the text it was read from (see `SourceInfo`), so writing the
 * document back gives the same file until something is edited.
 * @param source The note's text, with `\n` line endings.
 */
export function markdownToDoc(source: string): Node {
  const { lead, blocks } = parseMarkdown(source);
  const children = blocks.map(({ node, raw, gap }) =>
    node.type.create({ ...node.attrs, md: { raw, gap, fresh: serializeBlock(node) } }, node.content, node.marks),
  );
  if (children.length === 0) {
    children.push(schema.node('paragraph'));
  }
  return schema.node('doc', { lead }, children);
}

/**
 * Where a position in the document falls in the note's Markdown: the start of
 * its top-level block, plus how far into the block's text it is (clamped to
 * the block). Close enough for the status bar's line and column, and for
 * keeping the place when switching to the raw text.
 * @param doc The document.
 * @param pos A position in it.
 */
export function sourceOffsetOf(doc: Node, pos: number): number {
  const { text, starts } = writeDoc(doc);
  const index = Math.min(doc.childCount - 1, Math.max(0, doc.resolve(Math.min(pos, doc.content.size)).index(0)));
  let blockStart = 0;
  for (let i = 0; i < index; i += 1) {
    blockStart += doc.child(i).nodeSize;
  }
  const into = doc.textBetween(blockStart, Math.max(blockStart, Math.min(pos, doc.content.size)), '\n', ' ').length;
  const start = starts[index] ?? 0;
  const end = starts[index + 1] ?? text.length;
  // The block's own text sits after its marker (`# `, `- `, `> `); land on it rather than on the marker.
  const marker = /^(?:#{1,6} |> ?|[-*+] (?:\[[ xX]\] )?|\d+[.)] )/.exec(text.slice(start, end))?.[0].length ?? 0;
  return Math.min(end, start + marker + into);
}

/**
 * The document position nearest a place in the note's Markdown: inside the
 * top-level block that holds it, as far in as the offset is past the block's start.
 * @param doc The document.
 * @param offset An offset into the Markdown.
 */
export function posOfSourceOffset(doc: Node, offset: number): number {
  const { starts } = writeDoc(doc);
  let index = 0;
  while (index + 1 < starts.length && starts[index + 1]! <= offset) {
    index += 1;
  }
  let blockStart = 0;
  for (let i = 0; i < index; i += 1) {
    blockStart += doc.child(i).nodeSize;
  }
  const block = doc.child(Math.min(index, doc.childCount - 1));
  let remaining = Math.max(0, offset - (starts[index] ?? 0));
  let found = blockStart + 1;
  // Walk the block's text until the offset is used up.
  block.descendants((node, pos) => {
    if (remaining <= 0) {
      return false;
    }
    if (node.isText) {
      const take = Math.min(remaining, node.nodeSize);
      found = blockStart + 1 + pos + take;
      remaining -= take;
    }
    return true;
  });
  return Math.min(found, blockStart + block.nodeSize - 1);
}
