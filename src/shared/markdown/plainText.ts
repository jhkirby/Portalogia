// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import type { Token, Tokens } from 'marked';
import { createMarkdownEngine, type MathToken, type WikiLinkToken } from './parser';

/** Decodes the handful of entities Markdown text commonly carries, so `&amp;` exports as `&`. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Removes HTML tags from a raw-HTML token — what's left is whatever text was between them. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ''));
}

/** The text of a run of inline tokens, without any of the Markdown's markers. */
function inlineText(tokens: readonly Token[] | undefined): string {
  if (!tokens) {
    return '';
  }
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'br':
          return '\n';
        case 'codespan':
          return decodeEntities((token as Tokens.Codespan).text);
        case 'html':
        case 'tag':
          return stripTags((token as Tokens.HTML).text);
        case 'image':
          return (token as Tokens.Image).text;
        case 'link': {
          const link = token as Tokens.Link;
          const label = inlineText(link.tokens);
          // A link whose text *is* its address (an autolink) isn't written twice.
          return link.href === label || link.href === `mailto:${label}` ? label : `${label} (${link.href})`;
        }
        case 'wikilink': {
          const wiki = token as WikiLinkToken;
          return wiki.alias || (wiki.heading ? `${wiki.target} > ${wiki.heading}` : wiki.target);
        }
        case 'mathInline':
          return `$${(token as MathToken).tex}$`;
        default: {
          const generic = token as Tokens.Generic;
          if (generic.tokens) {
            return inlineText(generic.tokens);
          }
          return decodeEntities(String(generic['text'] ?? generic.raw));
        }
      }
    })
    .join('');
}

/** Prefixes every line of `text` (blank ones too, trimmed) with `prefix`. */
function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? prefix.trimEnd() : `${prefix}${line}`))
    .join('\n');
}

/** A list rendered as lines, each item under its marker (`- `, `3. `, `- [x] `), nested lists indented under it. */
function listText(list: Tokens.List): string {
  const first = Number(list.start) || 1;
  return list.items
    .map((item, index) => {
      const marker = list.ordered ? `${first + index}. ` : '- ';
      const task = item.task ? (item.checked ? '[x] ' : '[ ] ') : '';
      const body = blocksText(item.tokens.filter((token) => token.type !== 'checkbox'), '\n').trimEnd();
      const indent = ' '.repeat(marker.length);
      const [firstLine = '', ...rest] = body.split('\n');
      return [`${marker}${task}${firstLine}`, ...rest.map((line) => (line === '' ? '' : `${indent}${line}`))].join('\n');
    })
    .join('\n');
}

/** A table rendered as plain rows: cells separated by ` | `, the header row first. */
function tableText(table: Tokens.Table): string {
  const row = (cells: readonly Tokens.TableCell[]): string => cells.map((cell) => inlineText(cell.tokens)).join(' | ');
  return [row(table.header), ...table.rows.map(row)].join('\n');
}

/** One block-level token as text (no trailing blank line). */
function blockText(token: Token): string {
  switch (token.type) {
    case 'heading':
    case 'paragraph':
    case 'text':
      return inlineText((token as Tokens.Generic).tokens) || decodeEntities(String((token as Tokens.Generic)['text'] ?? ''));
    case 'code':
      return (token as Tokens.Code).text;
    case 'blockquote': {
      const inner = blocksText((token as Tokens.Blockquote).tokens, '\n\n').trimEnd();
      // A callout (`> [!warning] Careful`) reads as "Warning: Careful", not as the marker.
      const callout = /^\[!([A-Za-z]+)\][+-]?[ \t]*([^\n]*)/.exec(inner);
      const type = callout?.[1] ?? '';
      const text = callout
        ? `${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()}${callout[2] ? `: ${callout[2]}` : ''}${inner.slice(callout[0].length)}`
        : inner;
      return prefixLines(text, '> ');
    }
    case 'list':
      return listText(token as Tokens.List);
    case 'table':
      return tableText(token as Tokens.Table);
    case 'hr':
      return '----------';
    case 'html':
      return stripTags((token as Tokens.HTML).text).trim();
    case 'math':
      return (token as MathToken).tex;
    default:
      return '';
  }
}

/** A run of block tokens as text, separated by `separator`; spacing and definition tokens contribute nothing. */
function blocksText(tokens: readonly Token[], separator: string): string {
  return tokens
    .filter((token) => token.type !== 'space' && token.type !== 'def')
    .map(blockText)
    .filter((text) => text !== '')
    .join(separator);
}

/**
 * A note as plain text, for the `.txt` export: headings and paragraphs as
 * their words, lists with their bullets or numbers, code and formulas as
 * written, links as `text (address)`, `[[wikilinks]]` as the name they show,
 * tables as rows. The Markdown's own markers (`#`, `**`, backticks, brackets)
 * are gone.
 * @param source The note's source.
 */
export function markdownToPlainText(source: string): string {
  const tokens = createMarkdownEngine().lex(source);
  return `${blocksText(tokens, '\n\n')}\n`;
}
