// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import type { Mark, Node } from 'prosemirror-model';
import { parseMarkdown } from './fromMarkdown';
import type { SourceInfo } from './schema';

/**
 * How text is escaped. `minimal` writes it as typed, which reads best and is
 * right almost always; `full` backslash-escapes every character Markdown (or
 * one of the note extensions) could take as syntax. A block is written
 * minimally first and read back; only if that reads as something else is it
 * written fully — so typing `**`, `[[` or `$` can never turn into formatting.
 */
type EscapeMode = 'minimal' | 'full';

/** What a block was last written as, by node — an unchanged node is the same object, so most blocks are never rewritten. */
const written = new WeakMap<Node, string>();

/** Marks, outermost first, as they nest when written. Code is written on its own (it can't hold the others). */
const MARK_ORDER = ['link', 'strong', 'em', 'strike', 'highlight'];

/**
 * The whole note as Markdown. A top-level block that still reads as it did
 * when the note was opened is written exactly as it was in the file; an
 * edited one is written afresh, in the note's own style where it had one.
 * @param doc The editor's document.
 */
export function docToMarkdown(doc: Node): string {
  return writeDoc(doc).text;
}

/**
 * The note as Markdown, with where each top-level block starts in it — how a
 * caret in the editor is turned into a place in the file (and back).
 * @param doc The editor's document.
 */
export function writeDoc(doc: Node): { readonly text: string; readonly starts: readonly number[] } {
  let out = String(doc.attrs['lead'] ?? '');
  const starts: number[] = [];
  const count = doc.childCount;
  doc.forEach((block, _offset, index) => {
    const md = block.attrs['md'] as SourceInfo | null | undefined;
    const fresh = serializeBlock(block);
    const untouched = md !== null && md !== undefined && md.fresh === fresh;
    starts.push(out.length);
    out += untouched ? md.raw : fresh;
    if (index === count - 1) {
      out += md ? md.gap : '\n';
      return;
    }
    // The blank lines that followed it — exactly, between two unedited blocks; otherwise at least one blank line, to
    // keep an edited or new block from running into its neighbour.
    const gap = md?.gap ?? '';
    const next = doc.child(index + 1);
    const nextMd = next.attrs['md'] as SourceInfo | null | undefined;
    const nextUntouched = nextMd !== null && nextMd !== undefined && nextMd.fresh === serializeBlock(next);
    out += (untouched && nextUntouched) || /\n[ \t]*\n/.test(gap) ? gap : '\n\n';
  });
  return { text: out, starts };
}

/**
 * One block written afresh, without its source: minimally escaped if that
 * reads back as the same block, fully escaped otherwise.
 * @param node A block node.
 */
export function serializeBlock(node: Node): string {
  const cached = written.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const minimal = writeBlock(node, 'minimal');
  const full = writeBlock(node, 'full');
  const out = minimal === full || readsAs(minimal, node) ? minimal : full;
  written.set(node, out);
  return out;
}

/** Whether Markdown reads back as exactly this one block. */
function readsAs(markdown: string, node: Node): boolean {
  const { blocks } = parseMarkdown(markdown);
  return blocks.length === 1 && sameContent(blocks[0]!.node, node);
}

/**
 * Whether two nodes hold the same content — type, attributes (bar where they
 * came from), marks and children.
 */
export function sameContent(a: Node, b: Node): boolean {
  if (a.type !== b.type || a.childCount !== b.childCount || !sameAttrs(a.attrs, b.attrs)) {
    return false;
  }
  if (a.isText) {
    return a.text === b.text && a.marks.length === b.marks.length && a.marks.every((mark, index) => sameMark(mark, b.marks[index]!));
  }
  if (a.marks.length !== b.marks.length || !a.marks.every((mark, index) => sameMark(mark, b.marks[index]!))) {
    return false;
  }
  for (let index = 0; index < a.childCount; index += 1) {
    if (!sameContent(a.child(index), b.child(index))) {
      return false;
    }
  }
  return true;
}

function sameMark(a: Mark, b: Mark): boolean {
  return a.type === b.type && sameAttrs(a.attrs, b.attrs);
}

function sameAttrs(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(a).every((key) => key === 'md' || a[key] === b[key]);
}

// ── BLOCKS ──────────────────────────────────────────────────────────────

/**
 * A block as Markdown, without a trailing newline.
 * @param node The block.
 * @param mode How its text is escaped.
 */
function writeBlock(node: Node, mode: EscapeMode): string {
  const attrs = node.attrs;
  switch (node.type.name) {
    case 'paragraph':
      return writeInline(node, mode, false);
    case 'heading': {
      const level = Number(attrs['level']);
      const text = writeInline(node, mode, false);
      if (attrs['setext'] === true && level <= 2 && text !== '') {
        return `${text}\n${(level === 1 ? '=' : '-').repeat(Math.max(3, Math.min(text.length, 80)))}`;
      }
      return text === '' ? '#'.repeat(level) : `${'#'.repeat(level)} ${text}`;
    }
    case 'blockquote':
      return quoteLines(writeChildren(node, mode, '\n\n'));
    case 'callout': {
      const title = String(attrs['title'] ?? '');
      const header = `[!${String(attrs['type'])}]${String(attrs['fold'] ?? '')}${title === '' ? '' : ` ${title}`}`;
      const body = writeChildren(node, mode, '\n\n');
      return quoteLines(body === '' ? header : `${header}\n${body}`);
    }
    case 'bullet_list':
    case 'ordered_list':
      return writeList(node, mode);
    case 'code_block':
      return writeCode(node);
    case 'math_block':
      return `$$\n${String(attrs['tex'])}\n$$`;
    case 'html_block':
      return String(attrs['html']);
    case 'raw_block':
      return String(attrs['text']);
    case 'horizontal_rule':
      return String(attrs['style'] || '---');
    case 'table':
      return writeTable(node, mode);
    default:
      return node.textContent;
  }
}

/** A container's blocks, written and joined. */
function writeChildren(node: Node, mode: EscapeMode, separator: string): string {
  const parts: string[] = [];
  node.forEach((child) => parts.push(writeBlock(child, mode)));
  return parts.join(separator);
}

/** Lines prefixed with `> ` (a bare `>` on an empty line), as a quote or callout writes them. */
function quoteLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** A bullet or numbered list: each item's marker, then its blocks indented under it. */
function writeList(node: Node, mode: EscapeMode): string {
  const ordered = node.type.name === 'ordered_list';
  const tight = node.attrs['tight'] !== false;
  const start = Number(node.attrs['start'] ?? 1);
  const items: string[] = [];
  node.forEach((item, _offset, index) => {
    const marker = ordered ? `${start + index}${String(node.attrs['delimiter'] ?? '.')} ` : `${String(node.attrs['marker'] ?? '-')} `;
    const checked = item.attrs['checked'] as boolean | null;
    const box = checked === null ? '' : `[${checked ? 'x' : ' '}] `;
    const body = writeChildren(item, mode, tight ? '\n' : '\n\n');
    const indent = ' '.repeat(marker.length);
    const lines = body.split('\n').map((line, lineIndex) => (lineIndex === 0 ? line : line === '' ? '' : `${indent}${line}`));
    items.push(`${marker}${box}${lines.join('\n')}`.replace(/[ \t]+$/, (trailing) => (box === '' ? '' : trailing)));
  });
  return items.join(tight ? '\n' : '\n\n');
}

/** A code block: fenced (with a fence longer than any run of its character inside), or indented if it was. */
function writeCode(node: Node): string {
  const text = node.textContent;
  if (node.attrs['indented'] === true && text.trim() !== '') {
    return text
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
  }
  let fence = String(node.attrs['fence'] || '```');
  const char = fence.charAt(0);
  const longestRun = Math.max(0, ...(text.match(new RegExp(`\\${char}+`, 'g')) ?? []).map((run) => run.length));
  if (longestRun >= fence.length) {
    fence = char.repeat(longestRun + 1);
  }
  const language = String(node.attrs['language'] ?? '');
  return text === '' ? `${fence}${language}\n${fence}` : `${fence}${language}\n${text}\n${fence}`;
}

/** A GFM table: `| a | b |` rows, the `---` row (with each column's alignment) after the first. */
function writeTable(node: Node, mode: EscapeMode): string {
  const rows: string[][] = [];
  const aligns: string[] = [];
  node.forEach((row, _offset, rowIndex) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(writeInline(cell, mode, true));
      if (rowIndex === 0) {
        const align = cell.attrs['align'] as string | null;
        aligns.push(align === 'left' ? ':---' : align === 'right' ? '---:' : align === 'center' ? ':---:' : '---');
      }
    });
    rows.push(cells);
  });
  const line = (cells: readonly string[]): string => `| ${cells.map((cell) => (cell === '' ? ' ' : cell)).join(' | ')} |`;
  const [header, ...body] = rows;
  return [line(header ?? []), line(aligns), ...body.map(line)].join('\n');
}

// ── INLINE ──────────────────────────────────────────────────────────────

/** Characters `full` escapes anywhere in text. */
const FULL_ESCAPE = /[\\`*_[\]$=~<>|]/g;

/**
 * Text escaped for where it sits.
 * @param text The text as typed.
 * @param mode How much to escape.
 * @param lineStart Whether it begins a line, where `#`, `-`, `+`, `>` and `1.` start blocks.
 * @param inTable Whether it's in a table cell, where `|` always ends the cell.
 */
function escapeText(text: string, mode: EscapeMode, lineStart: boolean, inTable: boolean): string {
  if (mode === 'minimal') {
    return inTable ? text.replace(/\|/g, '\\|') : text;
  }
  let out = text.replace(FULL_ESCAPE, (char) => `\\${char}`);
  if (lineStart) {
    out = out.replace(/^(\s*)([#+-])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2');
  }
  return out;
}

/** Text in a code span: backticks enough to hold any run inside, and a space where the text touches one. */
function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longestRun + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/** A link or image destination: in `<…>` if it has spaces or brackets that would end it early. */
function destination(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, (char) => encodeURIComponent(char))}>` : href;
}

/** A link or image title, quoted. */
function titlePart(title: string): string {
  return title === '' ? '' : ` "${title.replace(/"/g, '\\"')}"`;
}

/** A mark's opening delimiter. */
function openMark(mark: Mark): string {
  switch (mark.type.name) {
    case 'link':
      return '[';
    case 'highlight':
      return '==';
    default:
      return String(mark.attrs['marker'] ?? '');
  }
}

/** A mark's closing delimiter. */
function closeMark(mark: Mark): string {
  switch (mark.type.name) {
    case 'link':
      return `](${destination(String(mark.attrs['href']))}${titlePart(String(mark.attrs['title'] ?? ''))})`;
    case 'highlight':
      return '==';
    default:
      return String(mark.attrs['marker'] ?? '');
  }
}

/** A node's marks that nest (all but code), outermost first. */
function nestingMarks(node: Node): Mark[] {
  return node.marks
    .filter((mark) => mark.type.name !== 'code')
    .sort((a, b) => MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name));
}

/** How many marks two stacks share from the outside in. */
function sharedPrefix(a: readonly Mark[], b: readonly Mark[]): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count]!.eq(b[count]!)) {
    count += 1;
  }
  return count;
}

/** An inline atom as Markdown. */
function writeAtom(node: Node, mode: EscapeMode): string {
  const attrs = node.attrs;
  switch (node.type.name) {
    case 'image': {
      const width = attrs['width'] as number | null;
      const alt = String(attrs['alt'] ?? '');
      if (attrs['embed'] === true) {
        const suffix = width !== null ? `|${width}` : alt !== '' ? `|${alt}` : '';
        return `![[${String(attrs['src'])}${suffix}]]`;
      }
      const label = `${alt}${width === null ? '' : `|${width}`}`.replace(/[[\]\\]/g, (char) => `\\${char}`);
      return `![${label}](${destination(String(attrs['src']))}${titlePart(String(attrs['title'] ?? ''))})`;
    }
    case 'wikilink': {
      const heading = String(attrs['heading'] ?? '');
      const alias = String(attrs['alias'] ?? '');
      return `${attrs['embed'] === true ? '!' : ''}[[${String(attrs['target'])}${heading === '' ? '' : `#${heading}`}${alias === '' ? '' : `|${alias}`}]]`;
    }
    case 'math_inline':
      return attrs['display'] === true ? `$$${String(attrs['tex'])}$$` : `$${String(attrs['tex'])}$`;
    case 'html_inline':
      return String(attrs['html']);
    default:
      return escapeText(node.textContent, mode, false, false);
  }
}

/**
 * A block's inline content as Markdown: marks opened and closed around the
 * text they cover, with spaces at a mark's edges moved outside it (`** a**`
 * isn't bold).
 * @param parent The textblock.
 * @param mode How text is escaped.
 * @param inTable Whether it's a table cell.
 */
function writeInline(parent: Node, mode: EscapeMode, inTable: boolean): string {
  const children: Node[] = [];
  parent.forEach((child) => children.push(child));
  let out = '';
  const active: Mark[] = [];
  let lineStart = true;

  const closeTo = (keep: number): void => {
    while (active.length > keep) {
      out += closeMark(active.pop()!);
    }
  };

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const marks = nestingMarks(child);

    // A bare or `<…>` link whose text is its address is written back that way.
    const link = marks.find((mark) => mark.type.name === 'link');
    if (link && link.attrs['auto'] !== '' && !active.some((mark) => mark.eq(link))) {
      let end = index;
      let text = '';
      while (end < children.length && children[end]!.isText && link.isInSet(children[end]!.marks) && children[end]!.marks.length === 1) {
        text += children[end]!.text ?? '';
        end += 1;
      }
      const href = String(link.attrs['href']);
      const nextHasLink = end < children.length && link.isInSet(children[end]!.marks);
      if (end > index && !nextHasLink && (text === href || `mailto:${text}` === href)) {
        closeTo(0);
        out += link.attrs['auto'] === 'angle' ? `<${text}>` : text;
        lineStart = false;
        index = end - 1;
        continue;
      }
    }

    if (child.type.name === 'hard_break') {
      closeTo(sharedPrefix(active, marks));
      out += inTable ? ' ' : child.attrs['style'] === '\\' ? '\\\n' : '  \n';
      lineStart = !inTable;
      continue;
    }

    const isCode = child.isText && child.marks.some((mark) => mark.type.name === 'code');
    const text = child.isText ? (child.text ?? '') : '';
    const leading = child.isText && !isCode ? (/^\s+/.exec(text)?.[0] ?? '') : '';
    const trailing = child.isText && !isCode && leading.length < text.length ? (/\s+$/.exec(text)?.[0] ?? '') : '';
    const core = child.isText ? text.slice(leading.length, text.length - trailing.length) : '';

    if (child.isText && core === '' && !isCode) {
      // Only spaces: they stay inside marks that go on past them, and open none of their own.
      closeTo(sharedPrefix(active, marks));
      out += escapeText(text, mode, lineStart, inTable);
      continue;
    }

    closeTo(sharedPrefix(active, marks));
    out += leading;
    for (const mark of marks.slice(active.length)) {
      out += openMark(mark);
      active.push(mark);
    }
    if (isCode) {
      out += codeSpan(text);
    } else if (child.isText) {
      out += escapeText(core, mode, lineStart && leading === '' && active.length === 0, inTable);
    } else {
      out += writeAtom(child, mode);
    }
    lineStart = false;
    if (trailing !== '') {
      const next = children[index + 1];
      closeTo(next ? sharedPrefix(active, nestingMarks(next)) : 0);
      out += trailing;
    }
  }
  closeTo(0);
  return out;
}
