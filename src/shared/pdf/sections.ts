// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { findDuplicates } from '../duplicates';

/** A section of a PDF, as its side panel lists it: a name, the 1-based page it starts on, and how deep it sits. */
export interface PdfSection {
  readonly title: string;
  readonly page: number;
  /** 0 for a top-level section, 1 for one under it, and so on (at most `MAX_SECTION_LEVEL`). */
  readonly level: number;
}

/** One line of a page's text, as read from pdf.js: what it says, its font size, and how far down the page it is. */
export interface PdfTextLine {
  readonly page: number;
  readonly text: string;
  /** The line's largest font size, in PDF points. */
  readonly size: number;
  /** The baseline's height above the page's bottom, in PDF points (pdf.js's `transform[5]`). */
  readonly y: number;
}

/** A run of text from pdf.js's `getTextContent`, the fields read here. */
export interface PdfTextRun {
  readonly str: string;
  readonly height: number;
  readonly transform: readonly number[];
  readonly hasEOL: boolean;
}

/** The deepest a section may sit (the stored sections' cap too, see `ipc-schemas.ts`). */
export const MAX_SECTION_LEVEL = 5;

/** The most sections read from a file, so a huge outline or a page of large type can't flood the panel. */
export const MAX_SECTIONS = 2000;

/** A line this much larger than the body text (or more) is taken for a heading. */
const HEADING_SIZE_RATIO = 1.18;

/** A heading is a short line: past this many characters it's a paragraph set large (a pull quote, a slide). */
const MAX_HEADING_CHARS = 120;

/** How many heading sizes become levels; any smaller heading sizes share the last level. */
const MAX_HEADING_LEVELS = 3;

/** A line on more pages than this, word for word, is a running header or footer, not a heading. */
const MAX_REPEATS = 2;

/** Font sizes closer than this (in points) count as the same size. */
const SIZE_TOLERANCE = 0.6;

/**
 * Joins a page's text runs into lines: a run ends its line where pdf.js marks
 * the end of one, or where the next run's baseline is elsewhere.
 * @param page The page's 1-based number.
 * @param runs The page's runs, in reading order.
 * @returns The page's non-blank lines.
 */
export function linesOfPage(page: number, runs: readonly PdfTextRun[]): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  let text = '';
  let size = 0;
  let y: number | null = null;
  const end = (): void => {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed !== '' && y !== null) {
      lines.push({ page, text: trimmed, size, y });
    }
    text = '';
    size = 0;
    y = null;
  };
  for (const run of runs) {
    const baseline = run.transform[5] ?? 0;
    if (y !== null && Math.abs(baseline - y) > Math.max(2, size * 0.5)) {
      end();
    }
    if (run.str.trim() !== '') {
      y ??= baseline;
      size = Math.max(size, Math.abs(run.height));
    }
    text += run.str;
    if (run.hasEOL) {
      end();
    }
  }
  end();
  return lines;
}

/**
 * The size most of the document's text is set in: the size carrying the most
 * characters.
 * @param lines Every line of the document.
 * @returns That size in points, or 0 for a document with no text.
 */
function bodySize(lines: readonly PdfTextLine[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const key = Math.round(line.size * 2) / 2;
    weights.set(key, (weights.get(key) ?? 0) + line.text.length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

/** Whether a line reads like a heading's words rather than a number, a stray mark, or a sentence run large. */
function looksLikeHeading(text: string): boolean {
  return text.length >= 2 && text.length <= MAX_HEADING_CHARS && /\p{L}/u.test(text) && !/^[\d\s.,:;/–—-]+$/.test(text);
}

/**
 * The sections of a PDF that has no outline of its own, read from its text:
 * one per page at most, the page's title — its largest line, if that's set
 * noticeably larger than the body text. A title that runs onto further lines
 * (same size, straight below) is joined into one; a line repeated on many
 * pages (a running header) is never a title. The largest titles are the top
 * level, the next size down under them, and so on.
 * @param lines Every line of the document, in order (see `linesOfPage`).
 * @returns The sections found, in page order — none if the text is all one size.
 */
export function detectHeadings(lines: readonly PdfTextLine[]): PdfSection[] {
  const body = bodySize(lines);
  if (body <= 0) {
    return [];
  }
  const repeats = new Map<string, Set<number>>();
  for (const line of lines) {
    const key = line.text.toLowerCase();
    const pages = repeats.get(key) ?? new Set<number>();
    pages.add(line.page);
    repeats.set(key, pages);
  }
  const byPage = new Map<number, PdfTextLine[]>();
  for (const line of lines) {
    const isCandidate =
      line.size >= body * HEADING_SIZE_RATIO &&
      looksLikeHeading(line.text) &&
      (repeats.get(line.text.toLowerCase())?.size ?? 0) <= MAX_REPEATS;
    if (isCandidate) {
      byPage.set(line.page, [...(byPage.get(line.page) ?? []), line]);
    }
  }
  const titles: { title: string; page: number; size: number }[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const candidates = byPage.get(page) ?? [];
    const largest = Math.max(...candidates.map((line) => line.size));
    // The title's lines, top of the page first (pdf.js's `y` counts up from the bottom).
    const titleLines = candidates.filter((line) => largest - line.size < SIZE_TOLERANCE).sort((a, b) => b.y - a.y);
    const [first, ...rest] = titleLines;
    if (!first) {
      continue;
    }
    let title = first.text;
    let previous = first;
    for (const line of rest) {
      const gap = previous.y - line.y;
      if (gap <= 0 || gap > line.size * 2 || title.length + line.text.length >= MAX_HEADING_CHARS) {
        break;
      }
      title = `${title} ${line.text}`;
      previous = line;
    }
    titles.push({ title, page, size: largest });
    if (titles.length >= MAX_SECTIONS) {
      break;
    }
  }
  // The distinct sizes, largest first, become the levels.
  const sizes: number[] = [];
  for (const { size } of [...titles].sort((a, b) => b.size - a.size)) {
    if (!sizes.some((known) => Math.abs(known - size) < SIZE_TOLERANCE)) {
      sizes.push(size);
    }
  }
  const levelOf = (size: number): number => {
    const index = sizes.findIndex((known) => Math.abs(known - size) < SIZE_TOLERANCE);
    return Math.min(Math.max(index, 0), MAX_HEADING_LEVELS - 1);
  };
  return titles.map(({ title, page, size }) => ({ title, page, level: levelOf(size) }));
}

/**
 * Puts sections in page order, keeping the order of those on the same page.
 * @param sections The sections, as edited.
 */
export function sortSections<T extends PdfSection>(sections: readonly T[]): T[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => a.section.page - b.section.page || a.index - b.index)
    .map(({ section }) => section);
}

/** Which sections of an edit can't be kept, by index: an empty or repeated name, or a page that's repeated or not in the document. */
export interface SectionProblems {
  readonly titles: ReadonlySet<number>;
  readonly pages: ReadonlySet<number>;
}

/** The section last edited, and in which box: that box is the one marked when it repeats another's value. */
export interface LastSectionEdit {
  readonly index: number;
  readonly field: 'title' | 'page';
}

/**
 * Checks an edit of the sections: every name must be filled in and differ from
 * the others (ignoring case and surrounding spaces), and every page must be one
 * the document has and no other section's. Of a repeated name or page, one
 * section keeps it and only the others are marked (`findDuplicates`).
 * @param sections The sections, as edited.
 * @param pageCount How many pages the document has.
 * @param lastEdit The box last typed in, which is the duplicate if it matches another; `null` marks the later ones.
 */
export function findSectionProblems(
  sections: readonly PdfSection[],
  pageCount: number,
  lastEdit: LastSectionEdit | null = null,
): SectionProblems {
  const isPage = (page: number): boolean => Number.isInteger(page) && page >= 1 && page <= pageCount;
  const titles = findDuplicates(
    sections,
    (section) => section.title.trim().toLowerCase() || null,
    lastEdit?.field === 'title' ? lastEdit.index : null,
  );
  const pages = findDuplicates(
    sections,
    (section) => (isPage(section.page) ? section.page : null),
    lastEdit?.field === 'page' ? lastEdit.index : null,
  );
  sections.forEach((section, index) => {
    if (section.title.trim() === '') {
      titles.add(index);
    }
    if (!isPage(section.page)) {
      pages.add(index);
    }
  });
  return { titles, pages };
}

/** Whether an edit of the sections can be kept as it is (see `findSectionProblems`). */
export function sectionsAreValid(sections: readonly PdfSection[], pageCount: number): boolean {
  const { titles, pages } = findSectionProblems(sections, pageCount);
  return titles.size === 0 && pages.size === 0;
}
