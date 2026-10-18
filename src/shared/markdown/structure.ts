// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import type { LineEnding } from './source';

/** One heading of a note, as its outline lists it. */
export interface NoteHeading {
  /** 1 (`#`) to 6 (`######`). */
  readonly level: number;
  /** The heading's words, with inline markup (`**`, `` ` ``, link syntax) taken off. */
  readonly text: string;
  /** The 1-based line it starts on. */
  readonly line: number;
}

/** A link going out of a note. */
export interface NoteLink {
  /** `'wiki'` for `[[Note]]`, `'link'` for a Markdown link, an `<autolink>` or a bare web address. */
  readonly kind: 'wiki' | 'link';
  /** Where it goes: the note name (with any `#heading`) or the address. */
  readonly target: string;
  /** What it reads as in the note. */
  readonly label: string;
  /** The 1-based line it's on. */
  readonly line: number;
}

/** The opening or closing of a fenced code block: three or more backticks or tildes. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)[ \t]*$/;
/** A line that can't be a setext heading's text: blank, or the start of another kind of block. */
const NOT_PARAGRAPH = /^\s*$|^\s{0,3}(?:[-*+]\s|\d{1,9}[.)]\s|>|#|`{3}|~{3}|\||<)/;

const WIKI_LINK = /(!?)\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/g;
const MARKDOWN_LINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const AUTOLINK = /<((?:https?|mailto):[^>\s]+)>/g;
const BARE_URL = /\bhttps?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/g;
const INLINE_CODE = /(`+)[^`\n]*?\1/g;

/**
 * Each line of a note, with whether it sits inside a fenced code block —
 * where nothing (a `#`, a `[[link]]`) means what it would in prose.
 * @param source The note's source.
 * @returns The lines, in order.
 */
function linesWithFences(source: string): { readonly text: string; readonly inCode: boolean }[] {
  let fence: string | null = null;
  return source.split('\n').map((text) => {
    const match = FENCE.exec(text);
    if (fence === null && match) {
      fence = match[1]!.charAt(0).repeat(match[1]!.length);
      return { text, inCode: true };
    }
    if (fence !== null) {
      if (match && match[1]!.startsWith(fence.charAt(0)) && match[1]!.length >= fence.length) {
        fence = null;
      }
      return { text, inCode: true };
    }
    return { text, inCode: false };
  });
}

/**
 * Takes the inline markup off a heading's text, so the outline reads as the
 * rendered heading does: links become their labels, and emphasis, code and
 * highlight marks go.
 * @param text The heading's raw text.
 * @returns Its plain words.
 */
function plainHeading(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|==|`)(.+?)\1/g, '$2')
    .trim();
}

/**
 * Every heading of a note, in order: `#` headings and underlined (setext)
 * ones, but nothing inside a fenced code block.
 * @param source The note's source (plain `\n` breaks).
 * @returns The headings.
 */
export function extractHeadings(source: string): NoteHeading[] {
  const lines = linesWithFences(source);
  const headings: NoteHeading[] = [];
  lines.forEach((line, index) => {
    if (line.inCode) {
      return;
    }
    const atx = ATX_HEADING.exec(line.text);
    if (atx) {
      const text = plainHeading(atx[2] ?? '');
      if (text !== '') {
        headings.push({ level: atx[1]!.length, text, line: index + 1 });
      }
      return;
    }
    const next = lines[index + 1];
    const underline = next && !next.inCode ? SETEXT_UNDERLINE.exec(next.text) : null;
    if (underline && !NOT_PARAGRAPH.test(line.text)) {
      headings.push({ level: underline[1]!.startsWith('=') ? 1 : 2, text: plainHeading(line.text), line: index + 1 });
    }
  });
  return headings;
}

/**
 * Every link going out of a note, in reading order: `[[wikilinks]]`
 * (`[[Note|label]]` too), `[label](address)`, `<https://…>`, and bare web
 * addresses. Pictures (`![…]`) aren't links, and nothing inside code counts.
 * @param source The note's source (plain `\n` breaks).
 * @returns The links.
 */
export function extractOutboundLinks(source: string): NoteLink[] {
  const links: NoteLink[] = [];
  linesWithFences(source).forEach((line, index) => {
    if (line.inCode) {
      return;
    }
    // Inline code is blanked out (same length, so positions hold) before looking for links.
    let text = line.text.replace(INLINE_CODE, (match) => ' '.repeat(match.length));
    const found: { at: number; link: NoteLink }[] = [];
    const take = (pattern: RegExp, make: (match: RegExpMatchArray) => NoteLink | null): void => {
      for (const match of text.matchAll(pattern)) {
        const link = make(match);
        if (link) {
          found.push({ at: match.index ?? 0, link });
        }
      }
      // Blanked once found (pictures too), so a bare address inside a link isn't counted a second time.
      text = text.replace(pattern, (whole) => ' '.repeat(whole.length));
    };
    const line1 = index + 1;
    take(WIKI_LINK, (m) => {
      if (m[1] === '!') {
        return null;
      }
      const target = String(m[2]).trim();
      return { kind: 'wiki', target, label: (m[3] ?? '').trim() || target, line: line1 };
    });
    take(MARKDOWN_LINK, (m) =>
      m[1] === '!' ? null : { kind: 'link', target: String(m[3]), label: String(m[2]).trim() || String(m[3]), line: line1 },
    );
    take(AUTOLINK, (m) => ({ kind: 'link', target: String(m[1]), label: String(m[1]), line: line1 }));
    take(BARE_URL, (m) => ({ kind: 'link', target: String(m[0]), label: String(m[0]), line: line1 }));
    found.sort((a, b) => a.at - b.at).forEach(({ link }) => links.push(link));
  });
  return links;
}

/** A word: a run of letters and digits, with apostrophes, hyphens and underscores inside it. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu;

/**
 * Where each word of a text starts.
 * @param text The text.
 * @returns The offsets (UTF-16 code units) of the first character of each word, ascending.
 */
export function wordStarts(text: string): number[] {
  const starts: number[] = [];
  for (const match of text.matchAll(WORD)) {
    starts.push(match.index ?? 0);
  }
  return starts;
}

/**
 * Which word a caret is on: the number of words that start at or before it,
 * so a caret inside a word (or in the space after it) is on that word.
 * @param starts The text's word starts, from `wordStarts`.
 * @param offset The caret's offset.
 * @returns The 1-based word number, or 0 before the first word.
 */
export function wordIndexAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (starts[middle]! <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * The number of characters a person would count: each emoji or accented
 * letter written as one code point is one, not the two UTF-16 units it may take.
 * @param text The text.
 * @returns Its length in code points.
 */
export function countCharacters(text: string): number {
  let surrogates = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) {
      surrogates += 1;
    }
  }
  return text.length - surrogates;
}

/**
 * How many bytes the note takes on disk: UTF-8, with the file's own line
 * endings (a CRLF file spends two bytes per line break).
 * @param source The note's source (plain `\n` breaks).
 * @param ending The line ending the file uses.
 * @returns The file's size in bytes.
 */
export function fileByteSize(source: string, ending: LineEnding): number {
  const utf8 = new TextEncoder().encode(source).length;
  if (ending === '\n') {
    return utf8;
  }
  let breaks = 0;
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
    breaks += 1;
  }
  return utf8 + breaks;
}
