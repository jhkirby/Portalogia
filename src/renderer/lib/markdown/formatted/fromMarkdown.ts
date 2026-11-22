// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import type { Token, Tokens } from 'marked';
import type { Mark, Node } from 'prosemirror-model';
import { CALLOUT_PATTERN } from '@shared/markdown/callouts';
import {
  createMarkdownEngine,
  embedWidth,
  IMAGE_EXTENSION_PATTERN,
  splitImageAlt,
  type MathToken,
  type WikiLinkToken,
} from '@shared/markdown/parser';
import { noteSchema as schema, type CellAlign } from './schema';

/** One top-level block as read: the node, the exact text it came from, and the blank lines after it. */
export interface ParsedBlock {
  readonly node: Node;
  readonly raw: string;
  readonly gap: string;
}

/** A note read into blocks: any blank lines before the first, then the blocks in order. */
export interface ParsedNote {
  readonly lead: string;
  readonly blocks: readonly ParsedBlock[];
}

/** The same lexer the reader and main use, so all three agree on what a note means. */
const engine = createMarkdownEngine();

/** YAML front matter: `---` on the first line, then anything, then a closing `---` (or `...`) line. */
const FRONT_MATTER_PATTERN = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;

/**
 * Reads a note's Markdown into the formatted editor's blocks, keeping each
 * top-level block's source text so it can be written back unchanged (see
 * `SourceInfo`). Markdown the editor has no element for becomes a `raw_block`,
 * kept as written.
 * @param source The note's text, with `\n` line endings.
 */
export function parseMarkdown(source: string): ParsedNote {
  let lead = '';
  const blocks: { node: Node; raw: string; gap: string }[] = [];
  let rest = source;
  const frontMatter = FRONT_MATTER_PATTERN.exec(source);
  if (frontMatter) {
    const raw = frontMatter[0];
    const body = raw.replace(/\n+$/, '');
    blocks.push({ node: schema.node('raw_block', { text: body }), raw: body, gap: raw.slice(body.length) });
    rest = source.slice(raw.length);
  }
  for (const token of engine.lex(rest)) {
    if (token.type === 'space') {
      const last = blocks[blocks.length - 1];
      if (last) {
        last.gap += token.raw;
      } else {
        lead += token.raw;
      }
      continue;
    }
    const body = token.raw.replace(/\n+$/, '');
    const gap = token.raw.slice(body.length);
    const nodes = blockNodes(token, body);
    // A token is one block; should one ever read as several, the first keeps its text and the rest are rewritten.
    nodes.forEach((node, index) => {
      blocks.push(index === 0 ? { node, raw: body, gap } : { node, raw: '', gap: '' });
    });
    if (nodes.length === 0) {
      blocks.push({ node: schema.node('raw_block', { text: body }), raw: body, gap });
    }
  }
  return { lead, blocks };
}

/** The blocks of a nested token list (a quote's, a list item's), with nothing kept of their source. */
function childBlocks(tokens: readonly Token[]): Node[] {
  return tokens.flatMap((token) => (token.type === 'space' ? [] : blockNodes(token, token.raw.replace(/\n+$/, ''))));
}

/**
 * One block token as editor nodes.
 * @param token The token.
 * @param body Its source without the trailing newlines.
 */
function blockNodes(token: Token, body: string): Node[] {
  switch (token.type) {
    case 'paragraph':
      return [schema.node('paragraph', null, inlineNodes((token as Tokens.Paragraph).tokens, []))];
    case 'text': {
      // A tight list item's text: a paragraph by another name.
      const text = token as Tokens.Text;
      return [schema.node('paragraph', null, text.tokens ? inlineNodes(text.tokens, []) : textNodes(text.text, []))];
    }
    case 'heading': {
      const heading = token as Tokens.Heading;
      return [
        schema.node(
          'heading',
          { level: heading.depth, setext: !/^ {0,3}#/.test(body) },
          inlineNodes(heading.tokens, []),
        ),
      ];
    }
    case 'code': {
      const code = token as Tokens.Code;
      const indented = code.codeBlockStyle === 'indented';
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(body)?.[1] ?? '```';
      const text = code.text;
      return [
        schema.node(
          'code_block',
          { language: (code.lang ?? '').trim(), fence, indented },
          text === '' ? undefined : schema.text(text),
        ),
      ];
    }
    case 'math':
      return [schema.node('math_block', { tex: (token as MathToken).tex })];
    case 'blockquote':
      return [quoteNode(token as Tokens.Blockquote)];
    case 'list':
      return [listNode(token as Tokens.List)];
    case 'table':
      return [tableNode(token as Tokens.Table)];
    case 'hr':
      return [schema.node('horizontal_rule', { style: body.trim() })];
    case 'html':
      return [schema.node('html_block', { html: body })];
    default:
      return [];
  }
}

/** A `>` quote, or — when its first line is `[!type]` — a callout. */
function quoteNode(token: Tokens.Blockquote): Node {
  const match = CALLOUT_PATTERN.exec(token.text);
  if (!match) {
    const children = childBlocks(token.tokens);
    return schema.node('blockquote', null, children.length > 0 ? children : [schema.node('paragraph')]);
  }
  const children = childBlocks(engine.lex(token.text.slice(match[0].length)));
  return schema.node(
    'callout',
    { type: match[1] ?? 'note', fold: match[2] ?? '', title: (match[3] ?? '').trim() },
    children.length > 0 ? children : [schema.node('paragraph')],
  );
}

/** A bullet or numbered list, its items task items where they start with `[ ]` / `[x]`. */
function listNode(token: Tokens.List): Node {
  const items = token.items.map((item) => {
    const children = childBlocks(item.tokens);
    // An item must start with a paragraph (an item that opens with code or a quote gets an empty one first).
    if (children[0]?.type !== schema.nodes['paragraph']) {
      children.unshift(schema.node('paragraph'));
    }
    return schema.node('list_item', { checked: item.task ? Boolean(item.checked) : null }, children);
  });
  const first = token.items[0]?.raw.trimStart() ?? '';
  if (token.ordered) {
    const delimiter = /^\d+([.)])/.exec(first)?.[1] ?? '.';
    const start = typeof token.start === 'number' ? token.start : 1;
    return schema.node('ordered_list', { start, delimiter, tight: !token.loose }, items);
  }
  return schema.node('bullet_list', { marker: first.charAt(0) || '-', tight: !token.loose }, items);
}

/** A GFM table: the header row's cells as header cells, each column's alignment on every cell of it. */
function tableNode(token: Tokens.Table): Node {
  const align = (index: number): CellAlign => token.align[index] ?? null;
  const row = (cells: readonly Tokens.TableCell[], type: 'table_header' | 'table_cell'): Node =>
    schema.node(
      'table_row',
      null,
      cells.map((cell, index) => schema.node(type, { align: align(index) }, inlineNodes(cell.tokens, []))),
    );
  return schema.node('table', null, [row(token.header, 'table_header'), ...token.rows.map((cells) => row(cells, 'table_cell'))]);
}

/** Text as editor text nodes: a soft line break is a space, as the reader draws it; empty text is nothing. */
function textNodes(text: string, marks: readonly Mark[]): Node[] {
  const flat = text.replace(/[ \t]*\n[ \t]*/g, ' ');
  return flat === '' ? [] : [schema.text(flat, marks)];
}

/**
 * Inline tokens as editor nodes, carrying the marks of everything they're inside.
 * @param tokens The tokens.
 * @param marks The marks around them.
 */
function inlineNodes(tokens: readonly Token[] | undefined, marks: readonly Mark[]): Node[] {
  const out: Node[] = [];
  for (const token of tokens ?? []) {
    out.push(...inlineNode(token, marks));
  }
  return out;
}

/** One inline token as editor nodes. */
function inlineNode(token: Token, marks: readonly Mark[]): Node[] {
  const withMark = (name: string, attrs: Record<string, unknown> | null = null): readonly Mark[] =>
    schema.marks[name]!.create(attrs).addToSet(marks);
  switch (token.type) {
    case 'text': {
      const text = token as Tokens.Text;
      return text.tokens && text.tokens.length > 0 ? inlineNodes(text.tokens, marks) : textNodes(text.text, marks);
    }
    case 'escape':
      return textNodes((token as Tokens.Escape).text, marks);
    case 'strong':
      return inlineNodes((token as Tokens.Strong).tokens, withMark('strong', { marker: token.raw.slice(0, 2) }));
    case 'em':
      return inlineNodes((token as Tokens.Em).tokens, withMark('em', { marker: token.raw.charAt(0) }));
    case 'del':
      return inlineNodes((token as Tokens.Del).tokens, withMark('strike', { marker: token.raw.startsWith('~~') ? '~~' : '~' }));
    case 'codespan':
      return (token as Tokens.Codespan).text === '' ? [] : [schema.text((token as Tokens.Codespan).text, withMark('code'))];
    case 'highlight':
      return textNodes(String(token['text'] ?? ''), withMark('highlight'));
    case 'link': {
      const link = token as Tokens.Link;
      const auto = token.raw.startsWith('[') ? '' : token.raw.startsWith('<') ? 'angle' : 'bare';
      return inlineNodes(link.tokens, withMark('link', { href: link.href, title: link.title ?? '', auto }));
    }
    case 'image': {
      const image = token as Tokens.Image;
      const { alt, width } = splitImageAlt(image.text);
      return [schema.node('image', { src: image.href, alt, title: image.title ?? '', width }, undefined, marks)];
    }
    case 'br':
      return [schema.node('hard_break', { style: token.raw.startsWith('\\') ? '\\' : '  ' }, undefined, marks)];
    case 'html':
      return [schema.node('html_inline', { html: token.raw }, undefined, marks)];
    case 'checkbox':
      // A task item's box: the item carries it (`checked`).
      return [];
    case 'wikilink': {
      const link = token as WikiLinkToken;
      if (link.embed && IMAGE_EXTENSION_PATTERN.test(link.target)) {
        const width = embedWidth(link.alias);
        return [
          schema.node('image', { src: link.target, alt: width === null ? link.alias : '', width, embed: true }, undefined, marks),
        ];
      }
      return [
        schema.node('wikilink', { target: link.target, heading: link.heading, alias: link.alias, embed: link.embed }, undefined, marks),
      ];
    }
    case 'mathInline': {
      const math = token as MathToken;
      return [schema.node('math_inline', { tex: math.tex, display: math.display }, undefined, marks)];
    }
    default:
      return textNodes(token.raw, marks);
  }
}
