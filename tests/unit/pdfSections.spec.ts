// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { test, expect } from '@playwright/test';
import {
  detectHeadings,
  findSectionProblems,
  linesOfPage,
  sectionsAreValid,
  sortSections,
  type PdfTextLine,
  type PdfTextRun,
} from '../../src/shared/pdf/sections';

/** A run of text at a baseline height, as pdf.js gives it. */
function run(str: string, size: number, y: number, hasEOL = true): PdfTextRun {
  return { str, height: size, transform: [size, 0, 0, size, 72, y], hasEOL };
}

/** A line of body text, long enough to set the body size. */
function body(page: number, y: number): PdfTextLine {
  return { page, text: 'Body text that runs on for a while, as a paragraph does.', size: 10, y };
}

test.describe('linesOfPage', () => {
  test('joins runs on one baseline, breaks at end-of-line marks and baseline changes, and drops blank lines', () => {
    const lines = linesOfPage(2, [
      run('Intro', 18, 700, false),
      run('duction', 18, 700),
      run('   ', 10, 680),
      run('first ', 10, 660, false),
      run('second', 10, 640, false),
    ]);
    expect(lines).toEqual([
      { page: 2, text: 'Introduction', size: 18, y: 700 },
      { page: 2, text: 'first', size: 10, y: 660 },
      { page: 2, text: 'second', size: 10, y: 640 },
    ]);
  });
});

test.describe('detectHeadings', () => {
  test('lines set larger than the body are sections, levelled by size', () => {
    const lines: PdfTextLine[] = [
      { page: 1, text: 'Chapter One', size: 20, y: 700 },
      body(1, 680),
      { page: 2, text: 'A Smaller Part', size: 14, y: 700 },
      body(2, 680),
      body(2, 660),
      { page: 3, text: 'Chapter Two', size: 20, y: 700 },
      body(3, 680),
    ];
    expect(detectHeadings(lines)).toEqual([
      { title: 'Chapter One', page: 1, level: 0 },
      { title: 'A Smaller Part', page: 2, level: 1 },
      { title: 'Chapter Two', page: 3, level: 0 },
    ]);
  });

  test('a page gives one section, its largest line, however many lines are set large on it', () => {
    const lines: PdfTextLine[] = [
      { page: 1, text: 'Course Title', size: 24, y: 700 },
      { page: 1, text: 'Chapter 6 (multicores)', size: 16, y: 600 },
      { page: 1, text: 'Fall 2026', size: 16, y: 500 },
      body(1, 400),
      { page: 2, text: 'Quiz', size: 20, y: 700 },
      { page: 2, text: 'Answer', size: 14, y: 650 },
      body(2, 600),
      body(3, 600),
    ];
    expect(detectHeadings(lines)).toEqual([
      { title: 'Course Title', page: 1, level: 0 },
      { title: 'Quiz', page: 2, level: 1 },
    ]);
  });

  test('a heading run onto a second line is one section', () => {
    const lines: PdfTextLine[] = [
      { page: 1, text: 'A Long Title That', size: 18, y: 700 },
      { page: 1, text: 'Wraps Around', size: 18, y: 680 },
      body(1, 650),
    ];
    expect(detectHeadings(lines)).toEqual([{ title: 'A Long Title That Wraps Around', page: 1, level: 0 }]);
  });

  test('running headers, page numbers, long lines and one-size text are not sections', () => {
    const header = (page: number): PdfTextLine => ({ page, text: 'Journal of Things', size: 14, y: 780 });
    const lines: PdfTextLine[] = [
      header(1),
      header(2),
      header(3),
      { page: 1, text: '12', size: 16, y: 40 },
      { page: 2, text: 'x'.repeat(200), size: 16, y: 500 },
      body(1, 700),
      body(2, 700),
      body(3, 700),
    ];
    expect(detectHeadings(lines)).toEqual([]);
    expect(detectHeadings([body(1, 700), body(2, 700)])).toEqual([]);
    expect(detectHeadings([])).toEqual([]);
  });

  test('more heading sizes than levels share the deepest level', () => {
    const sizes = [30, 26, 22, 18, 14];
    const lines: PdfTextLine[] = [
      ...sizes.map((size, index) => ({ page: index + 1, text: `Size ${size}`, size, y: 700 })),
      ...sizes.map((_, index) => body(index + 1, 600)),
    ];
    expect(detectHeadings(lines).map((section) => section.level)).toEqual([0, 1, 2, 2, 2]);
  });
});

test.describe('sortSections', () => {
  test('puts sections in page order, keeping the order of those on one page', () => {
    const sections = [
      { title: 'c', page: 5, level: 0 },
      { title: 'a', page: 1, level: 0 },
      { title: 'b2', page: 3, level: 1 },
      { title: 'b1', page: 3, level: 0 },
    ];
    expect(sortSections(sections).map((section) => section.title)).toEqual(['a', 'b2', 'b1', 'c']);
  });
});

test.describe('findSectionProblems', () => {
  test('flags empty and repeated names (ignoring case and spaces), and repeated or out-of-range pages', () => {
    const sections = [
      { title: 'Intro', page: 1, level: 0 },
      { title: ' intro ', page: 2, level: 0 },
      { title: '   ', page: 3, level: 0 },
      { title: 'Methods', page: 3, level: 0 },
      { title: 'Results', page: 9, level: 0 },
      { title: 'Ends', page: 0, level: 0 },
    ];
    const problems = findSectionProblems(sections, 5);
    // Of a repeat, only the later one is marked: the first keeps the name (or page).
    expect([...problems.titles].sort()).toEqual([1, 2]);
    expect([...problems.pages].sort()).toEqual([3, 4, 5]);
    expect(sectionsAreValid(sections, 5)).toBe(false);
  });

  test('the box last typed in is the duplicate, not the one it now matches', () => {
    const sections = [
      { title: 'Intro', page: 1, level: 0 },
      { title: 'intro', page: 1, level: 0 },
    ];
    const typedFirst = findSectionProblems(sections, 5, { index: 0, field: 'title' });
    expect([...typedFirst.titles]).toEqual([0]);
    // The page wasn't the box typed in, so of the two pages the later is marked.
    expect([...typedFirst.pages]).toEqual([1]);
    const typedPage = findSectionProblems(sections, 5, { index: 0, field: 'page' });
    expect([...typedPage.pages]).toEqual([0]);
    expect([...typedPage.titles]).toEqual([1]);
  });

  test('distinct names on distinct pages in the document are valid', () => {
    expect(sectionsAreValid([{ title: 'A', page: 1, level: 0 }, { title: 'B', page: 5, level: 0 }], 5)).toBe(true);
    expect(sectionsAreValid([], 5)).toBe(true);
  });
});
