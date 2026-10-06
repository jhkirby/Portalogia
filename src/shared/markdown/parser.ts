// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked';

/** Escapes the five characters that matter inside HTML text and double-quoted attributes. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** File extensions an `![[embed]]` (or `![](path)`) draws as a picture rather than a link to a note. */
export const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** An `[[Note]]`, `[[Note#Heading]]`, `[[Note|alias]]` or `![[embed]]`, as the lexer sees it. */
export interface WikiLinkToken extends Tokens.Generic {
  readonly type: 'wikilink';
  readonly embed: boolean;
  /** The note (or file) named, with no heading or alias. */
  readonly target: string;
  /** What follows `#`: a heading — or a `^block` id — in that note, or `''`. */
  readonly heading: string;
  /** What follows `|`: the text to show instead of the name — or an embedded image's width — or `''`. */
  readonly alias: string;
}

/** A TeX formula, from `$…$` (inline), or `$$…$$` (display). */
export interface MathToken extends Tokens.Generic {
  readonly type: 'math' | 'mathInline';
  readonly display: boolean;
  readonly tex: string;
}

/** The pieces of `[[Note#Heading|alias]]` — the one grammar both the lexer and a click on a link read it by. */
const WIKILINK_PATTERN = /^(!?)\[\[([^[\]|#\n]+?)(?:#([^[\]|\n]*?))?(?:\|([^[\]\n]*?))?\]\]/;

/** Display math on lines of its own: `$$`, a formula that may span lines, `$$`. */
const MATH_BLOCK_PATTERN = /^ {0,3}\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n|$)/;

/** `$$…$$` inside a line of text. */
const MATH_DISPLAY_INLINE_PATTERN = /^\$\$([^\n]+?)\$\$/;

/**
 * `$…$`. The opening `$` can't be followed by a space and the closing one
 * can't follow a space or precede a digit, so "costs $5 and $6" is prose, not math.
 */
const MATH_INLINE_PATTERN = /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/;

/** `==highlighted==`. */
const HIGHLIGHT_PATTERN = /^==(?!\s)([^=\n]+?)(?<!\s)==/;

/**
 * Splits the text inside a wiki link's brackets (what a click on one sends to
 * main) into the note and the heading in it. The alias, if any, is dropped.
 * @param text e.g. `Note#Heading|alias`.
 */
export function splitWikiTarget(text: string): { readonly name: string; readonly heading: string } {
  const withoutAlias = text.split('|')[0] ?? '';
  const hash = withoutAlias.indexOf('#');
  return hash === -1
    ? { name: withoutAlias.trim(), heading: '' }
    : { name: withoutAlias.slice(0, hash).trim(), heading: withoutAlias.slice(hash + 1).trim() };
}

/** The `id`-safe, lower-case form of a heading's text, the way a link to it is written (`[[Note#My Heading]]` → `my-heading`). */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Turns an `![[img.png|300]]` alias into a usable width, or `null` if it isn't a plain number. */
function embedWidth(alias: string): number | null {
  return /^\d{1,4}$/.test(alias) ? Number(alias) : null;
}

/** The extensions that add `[[wikilinks]]`, `$math$` and `==highlights==` to Markdown — shared so the page and main read a note the same way. */
const EXTENSIONS: TokenizerAndRendererExtension[] = [
  {
    name: 'wikilink',
    level: 'inline',
    start: (src: string) => src.search(/!?\[\[/),
    tokenizer(src: string) {
      const match = WIKILINK_PATTERN.exec(src);
      if (!match) {
        return undefined;
      }
      const token: WikiLinkToken = {
        type: 'wikilink',
        raw: match[0],
        embed: match[1] === '!',
        target: (match[2] ?? '').trim(),
        heading: (match[3] ?? '').trim(),
        alias: (match[4] ?? '').trim(),
      };
      return token;
    },
    renderer(token) {
      const link = token as WikiLinkToken;
      const written = link.heading ? `${link.target}#${link.heading}` : link.target;
      if (link.embed && IMAGE_EXTENSION_PATTERN.test(link.target)) {
        const width = embedWidth(link.alias);
        const widthAttribute = width === null ? '' : ` width="${width}"`;
        return `<img class="md-embed-image" alt="${escapeHtml(link.target)}" data-md-src="${escapeHtml(link.target)}"${widthAttribute}>`;
      }
      const shown = link.alias || (link.heading ? `${link.target} > ${link.heading}` : link.target);
      const embedClass = link.embed ? ' md-wikilink--embed' : '';
      return `<a class="md-wikilink${embedClass}" href="#" data-wikilink="${escapeHtml(written)}">${escapeHtml(shown)}</a>`;
    },
  },
  {
    name: 'math',
    level: 'block',
    // Only at the start of a line, since marked cuts a paragraph off at whatever this returns.
    start: (src: string) => {
      const match = /(?:^|\n)( {0,3}\$\$)/.exec(src);
      return match ? match.index + (match[0].length - (match[1] ?? '').length) : -1;
    },
    tokenizer(src: string) {
      const match = MATH_BLOCK_PATTERN.exec(src);
      if (!match) {
        return undefined;
      }
      const token: MathToken = { type: 'math', raw: match[0], display: true, tex: (match[1] ?? '').trim() };
      return token;
    },
    renderer(token) {
      const math = token as MathToken;
      return `<div class="md-math md-math--display" data-tex="${escapeHtml(math.tex)}">${escapeHtml(math.tex)}</div>\n`;
    },
  },
  {
    name: 'mathInline',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenizer(src: string) {
      const display = MATH_DISPLAY_INLINE_PATTERN.exec(src);
      const match = display ?? MATH_INLINE_PATTERN.exec(src);
      if (!match) {
        return undefined;
      }
      const token: MathToken = {
        type: 'mathInline',
        raw: match[0],
        display: display !== null,
        tex: (match[1] ?? '').trim(),
      };
      return token;
    },
    renderer(token) {
      const math = token as MathToken;
      const kind = math.display ? 'display' : 'inline';
      const tag = math.display ? 'div' : 'span';
      return `<${tag} class="md-math md-math--${kind}" data-tex="${escapeHtml(math.tex)}">${escapeHtml(math.tex)}</${tag}>`;
    },
  },
  {
    name: 'highlight',
    level: 'inline',
    start: (src: string) => src.indexOf('=='),
    tokenizer(src: string) {
      const match = HIGHLIGHT_PATTERN.exec(src);
      if (!match) {
        return undefined;
      }
      return { type: 'highlight', raw: match[0], text: match[1] ?? '' };
    },
    renderer(token) {
      return `<mark class="md-highlight">${escapeHtml(String(token['text'] ?? ''))}</mark>`;
    },
  },
];

/** How the page tweaks what the parser writes, without this module depending on a highlighter. */
export interface MarkdownHooks {
  /** Colors a code block: its source and language in, HTML (already escaped) out. */
  readonly highlight?: (code: string, language: string) => string;
}

/** A configured Markdown reader: the same extensions and rules wherever it's built. */
export interface MarkdownEngine {
  /** Turns a note's source into HTML. It is **not** sanitized — the page must do that before showing it. */
  render(source: string): string;
  /** Turns a note's source into tokens, extensions included. */
  lex(source: string): Token[];
}

/**
 * Builds a Markdown reader with GitHub-style tables, task lists and
 * strikethrough plus the Obsidian-style extras: `[[wikilinks]]`, `![[embeds]]`,
 * `$math$` and `==highlights==`. Each fenced code block gets a `data-code-index`
 * counting from 0 in reading order, which is how the page names a block to
 * main when running it (see `listCodeBlocks`).
 * @param hooks Optional page-side tweaks (syntax highlighting).
 */
export function createMarkdownEngine(hooks: MarkdownHooks = {}): MarkdownEngine {
  let codeIndex = 0;
  const marked = new Marked({ gfm: true, breaks: false, extensions: EXTENSIONS });
  marked.use({
    renderer: {
      // Marked's own checkbox has no class, so the page couldn't tell a task item's box from one in a note's raw HTML.
      checkbox({ checked }) {
        return `<input class="md-task" type="checkbox" disabled${checked ? ' checked' : ''}> `;
      },
      code({ text, lang }) {
        const language = (lang ?? '').trim().split(/\s+/)[0] ?? '';
        const body = hooks.highlight ? hooks.highlight(text, language) : escapeHtml(text);
        const index = codeIndex;
        codeIndex += 1;
        return `<pre class="md-code" data-code-index="${index}" data-lang="${escapeHtml(language)}"><code>${body}</code></pre>\n`;
      },
    },
  });
  return {
    render(source) {
      codeIndex = 0;
      return marked.parse(source, { async: false });
    },
    lex(source) {
      return marked.lexer(source);
    },
  };
}

/** One fenced (or indented) code block of a note. */
export interface CodeBlock {
  /** The word after the opening fence (`python`), or `''`. */
  readonly language: string;
  readonly code: string;
}

/**
 * Every code block of a note in reading order — the same order, and so the
 * same numbering, as the `data-code-index` the page's rendering gives them.
 * Main uses this on the note it holds rather than trusting code sent by the page.
 * @param source The note's source.
 */
export function listCodeBlocks(source: string): CodeBlock[] {
  const engine = createMarkdownEngine();
  const blocks: CodeBlock[] = [];
  const visit = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'code') {
        const code = token as Tokens.Code;
        blocks.push({ language: (code.lang ?? '').trim().split(/\s+/)[0] ?? '', code: code.text });
      }
      const generic = token as Tokens.Generic;
      if (generic.tokens && token.type !== 'paragraph' && token.type !== 'text' && token.type !== 'heading') {
        visit(generic.tokens);
      }
      // A list's items and a table's cells hold their blocks one level further down.
      const items = (token as Tokens.List).items;
      if (token.type === 'list' && items) {
        visit(items);
      }
    }
  };
  visit(engine.lex(source));
  return blocks;
}
