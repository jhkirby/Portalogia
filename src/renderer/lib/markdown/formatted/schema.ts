// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

/**
 * Where a top-level block came from: the exact text it was read from, the
 * blank lines after it, and what this module would have written for it at
 * the time. While the block still serializes to `fresh`, it is unedited and
 * `raw` is written back instead — so opening and saving a note changes
 * nothing that wasn't touched. Copied along with the node's other attributes
 * (a split paragraph carries it into both halves), which is harmless: an
 * edited copy no longer matches `fresh`.
 */
export interface SourceInfo {
  readonly raw: string;
  readonly gap: string;
  readonly fresh: string;
}

/** The attribute every block that can sit at the top of a note carries — see `SourceInfo`. */
const source = { md: { default: null as SourceInfo | null } };

/** One column's alignment in a table, as its `---` row spells it. */
export type CellAlign = 'left' | 'center' | 'right' | null;

/** A GFM table: header cells in the first row, plain cells after; each cell holds one line of text. */
const TABLE_NODES = tableNodes({
  tableGroup: 'block',
  cellContent: 'inline*',
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => (dom.style.textAlign || null) as CellAlign,
      setDOMAttr: (value, attrs) => {
        if (value) {
          attrs['style'] = `text-align: ${String(value)}`;
        }
      },
    },
  },
});

/**
 * The formatted editor's blocks. Each mirrors a Markdown construct and draws
 * with the reader's own classes (`markdown-viewer.css`), so a note looks the
 * same being edited as being read. Atoms (`math_block`, `html_block`,
 * `raw_block`) are edited through their node views, never as loose text.
 */
const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+', attrs: { lead: { default: '' } } },
  text: { group: 'inline' },
  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: { ...source },
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },
  heading: {
    content: 'inline*',
    group: 'block',
    defining: true,
    attrs: { level: { default: 1 }, setext: { default: false }, ...source },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs['level'] as number}`, 0],
  },
  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { ...source },
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },
  callout: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { type: { default: 'note' }, title: { default: '' }, fold: { default: '' }, ...source },
    // Drawn by its node view; this is the copy-out form.
    toDOM: (node) => ['div', { class: 'md-callout', 'data-callout': node.attrs['type'] as string }, 0],
  },
  bullet_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { marker: { default: '-' }, tight: { default: true }, ...source },
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },
  ordered_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { start: { default: 1 }, delimiter: { default: '.' }, tight: { default: true }, ...source },
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom) => ({ start: Number((dom as HTMLOListElement).getAttribute('start') ?? 1) || 1 }),
      },
    ],
    toDOM: (node) => ['ol', { start: node.attrs['start'] as number }, 0],
  },
  list_item: {
    // A task item is a list item with `checked` set; `null` is an ordinary item.
    content: 'paragraph block*',
    defining: true,
    attrs: { checked: { default: null as boolean | null } },
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
  },
  code_block: {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    attrs: { language: { default: '' }, fence: { default: '```' }, indented: { default: false }, ...source },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', { class: 'md-code' }, ['code', 0]],
  },
  math_block: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { tex: { default: '' }, ...source },
    toDOM: (node) => ['div', { class: 'md-math md-math--display', 'data-tex': node.attrs['tex'] as string }],
  },
  html_block: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { html: { default: '' }, ...source },
    toDOM: () => ['div', { class: 'fm-html' }],
  },
  raw_block: {
    // Markdown the editor has no element for — front matter, link definitions — kept exactly and editable as text.
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { text: { default: '' }, ...source },
    toDOM: (node) => ['pre', { class: 'fm-raw' }, node.attrs['text'] as string],
  },
  horizontal_rule: {
    group: 'block',
    selectable: true,
    attrs: { style: { default: '---' }, ...source },
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },
  ...TABLE_NODES,
  // The table itself also remembers its source, like any other top-level block.
  table: { ...TABLE_NODES['table'], attrs: { ...source } },
  image: {
    inline: true,
    group: 'inline',
    atom: true,
    draggable: true,
    attrs: {
      src: { default: '' },
      alt: { default: '' },
      title: { default: '' },
      width: { default: null as number | null },
      // `![[name.png]]` rather than `![alt](path)`.
      embed: { default: false },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => ({ src: (dom as HTMLImageElement).getAttribute('src') ?? '', alt: (dom as HTMLImageElement).alt }),
      },
    ],
    toDOM: (node) => ['img', { src: node.attrs['src'] as string, alt: node.attrs['alt'] as string }],
  },
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    attrs: { style: { default: '\\' } },
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
  math_inline: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { tex: { default: '' }, display: { default: false } },
    toDOM: (node) => ['span', { class: 'md-math md-math--inline', 'data-tex': node.attrs['tex'] as string }],
  },
  wikilink: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { target: { default: '' }, heading: { default: '' }, alias: { default: '' }, embed: { default: false } },
    toDOM: (node) => ['a', { class: 'md-wikilink', href: '#' }, wikiLinkLabel(node.attrs)],
  },
  html_inline: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { html: { default: '' } },
    toDOM: (node) => ['code', { class: 'fm-html-inline' }, node.attrs['html'] as string],
  },
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: { default: '' }, title: { default: '' }, auto: { default: '' } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => ({ href: (dom as HTMLAnchorElement).getAttribute('href') ?? '', title: (dom as HTMLAnchorElement).title }),
      },
    ],
    toDOM: (mark) => ['a', { href: mark.attrs['href'] as string, class: 'fm-anchor' }, 0],
  },
  strong: {
    attrs: { marker: { default: '**' } },
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }],
    toDOM: () => ['strong', 0],
  },
  em: {
    attrs: { marker: { default: '*' } },
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  strike: {
    attrs: { marker: { default: '~~' } },
    parseDOM: [{ tag: 'del' }, { tag: 's' }],
    toDOM: () => ['del', 0],
  },
  highlight: {
    parseDOM: [{ tag: 'mark' }],
    toDOM: () => ['mark', { class: 'md-highlight' }, 0],
  },
  code: {
    excludes: '_',
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
};

/**
 * What a `[[wikilink]]` shows: its alias, or the note's name (and heading).
 * @param attrs The link's attributes.
 */
export function wikiLinkLabel(attrs: Readonly<Record<string, unknown>>): string {
  const alias = String(attrs['alias'] ?? '');
  const target = String(attrs['target'] ?? '');
  const heading = String(attrs['heading'] ?? '');
  return alias !== '' ? alias : heading !== '' ? `${target} > ${heading}` : target;
}

/** The formatted editor's schema. */
export const noteSchema = new Schema({ nodes, marks });
