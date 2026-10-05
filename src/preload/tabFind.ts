// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { ipcRenderer } from 'electron';
import { buildFindPattern, clampOccurrence, findMatches, stepIndex, type FindOptions } from '@shared/find';

// Hardcoded rather than imported from `@shared/ipc-contract` — same reason
// `tabComments.ts` hardcodes its own: this module is folded into `tabZoom.ts`'s
// single Rollup preload entry, and a runtime value shared with any other
// entry gets split into a chunk the sandboxed CJS loader can't `require()`.
// (`@shared/find` is imported at runtime here — safe, because no other
// preload entry imports it.) `TabManager` (main) sends and listens on the
// same strings; keep them in sync by hand.
const FindCommand = 'find:command';
const FindResult = 'find:result';

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

type Command =
  | { readonly action: 'search'; readonly query: string; readonly options: FindOptions; readonly color: RgbColor }
  | { readonly action: 'step'; readonly direction: 1 | -1 }
  | { readonly action: 'goto'; readonly index: number }
  | { readonly action: 'clear' };

/** One text node's slice of the searched text. `map` is set when whitespace was collapsed: `map[i]` is the node-data offset of the `i`th searched character. */
interface Segment {
  readonly node: Text;
  readonly start: number;
  readonly length: number;
  readonly map: readonly number[] | null;
}

interface Searched {
  readonly text: string;
  readonly segments: readonly Segment[];
}

const ALL_NAME = 'northstar-find';
const CURRENT_NAME = 'northstar-find-current';
const STYLE_MARK = 'find-highlight';

/** Elements whose text is never visible page content. */
const NON_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA']);

/** The most matches measured when picking where to start: past this, just start at the first. */
const START_SEARCH_LIMIT = 2000;

/** A match closer than this to the edge of the viewport is scrolled to the middle. */
const SCROLL_MARGIN_PX = 80;

let ranges: Range[] = [];
let current = -1;
let capped = false;
let styleEl: HTMLStyleElement | null = null;

function rgb(color: RgbColor, alpha = 1): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** The whole-page highlight and the current match's, painted in the accent. A `::highlight()` rule can't read the page's own variables, so the colors are baked in. */
function paintStyle(color: RgbColor): void {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-northstar', STYLE_MARK);
  }
  styleEl.textContent =
    `::highlight(${ALL_NAME}) { background-color: ${rgb(color, 0.4)}; color: inherit; } ` +
    `::highlight(${CURRENT_NAME}) { background-color: ${rgb(color)}; color: #ffffff; }`;
  if (!styleEl.isConnected) {
    (document.head ?? document.documentElement).appendChild(styleEl);
  }
}

// ── INDEXING THE PAGE'S TEXT ─────────────────────────────────────────

/** Whether text in this element is on screen — `display: none` and `visibility: hidden` content isn't searchable, as in any browser's find. */
function isVisible(element: Element, cache: Map<Element, boolean>): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  const visible = element.checkVisibility ? element.checkVisibility({ checkVisibilityCSS: true }) : true;
  cache.set(element, visible);
  return visible;
}

/** The nearest ancestor that starts a new line of text: an inline element belongs to its container's line, anything else is its own block. */
function blockOf(element: Element, cache: Map<Element, Element>): Element {
  const cached = cache.get(element);
  if (cached) {
    return cached;
  }
  const display = getComputedStyle(element).display;
  const parent = element.parentElement;
  const block = (display === 'inline' || display === 'contents') && parent ? blockOf(parent, cache) : element;
  cache.set(element, block);
  return block;
}

/** Collapses each run of whitespace to one space, as the page renders it, remembering where every kept character came from. */
function collapseWhitespace(data: string): { readonly text: string; readonly map: readonly number[] } {
  let text = '';
  const map: number[] = [];
  let previousWasSpace = false;
  for (let index = 0; index < data.length; index += 1) {
    const char = data.charAt(index);
    const isSpace = char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
    if (isSpace && previousWasSpace) {
      continue;
    }
    text += isSpace ? ' ' : char;
    map.push(index);
    previousWasSpace = isSpace;
  }
  return { text, map };
}

/**
 * Gathers the page's visible text into one string to search, in document
 * order. Whitespace collapses the way the page renders it (so "hello
 * world" matches text the source breaks across lines), and a line break is
 * put between blocks (so a match can't run from one paragraph's end into the
 * next's start). The tool overlays this app adds to pages (`#northstar-…`)
 * are left out.
 */
function indexPage(): Searched {
  const visibility = new Map<Element, boolean>();
  const blocks = new Map<Element, Element>();
  const segments: Segment[] = [];
  let text = '';
  let previousBlock: Element | null = null;

  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || NON_CONTENT_TAGS.has(parent.tagName) || parent.closest('[id^="northstar-"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return isVisible(parent, visibility) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent || textNode.data === '') {
      continue;
    }
    const preformatted = getComputedStyle(parent).whiteSpace.startsWith('pre');
    const piece = preformatted ? { text: textNode.data, map: null } : collapseWhitespace(textNode.data);
    if (piece.text === '') {
      continue;
    }
    const block = blockOf(parent, blocks);
    if (previousBlock !== null && block !== previousBlock) {
      text += '\n';
    }
    previousBlock = block;
    segments.push({ node: textNode, start: text.length, length: piece.text.length, map: piece.map });
    text += piece.text;
  }
  return { text, segments };
}

/**
 * The index of the segment holding a character offset, by binary search; for
 * an offset on a line break between blocks (which no segment holds), the
 * index of the segment that follows it.
 */
function segmentIndexAt(segments: readonly Segment[], offset: number): number {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (!segment) {
      return -1;
    }
    if (offset < segment.start) {
      high = middle - 1;
    } else if (offset >= segment.start + segment.length) {
      low = middle + 1;
    } else {
      return middle;
    }
  }
  return low < segments.length ? low : -1;
}

/** Where, in a text node's own data, a searched character offset falls. */
function dataOffset(segment: Segment, offset: number): number {
  const local = Math.min(Math.max(offset - segment.start, 0), segment.length - 1);
  return segment.map ? (segment.map[local] ?? 0) : local;
}

/** A `Range` over a match, in the page's real text nodes — or `null` if the page changed under the search. */
function rangeFor(searched: Searched, start: number, end: number): Range | null {
  const { segments } = searched;
  const firstIndex = segmentIndexAt(segments, start);
  let lastIndex = segmentIndexAt(segments, end - 1);
  const first = segments[firstIndex];
  let last = segments[lastIndex];
  if (!first || !last) {
    return null;
  }
  // The match's last character is a line break between blocks: it really ends where the block before it does.
  let endInLast: number;
  if (end - 1 < last.start && lastIndex > 0) {
    lastIndex -= 1;
    last = segments[lastIndex] ?? last;
    endInLast = last.node.data.length;
  } else {
    endInLast = dataOffset(last, end - 1) + 1;
  }
  try {
    const range = document.createRange();
    range.setStart(first.node, start < first.start ? 0 : dataOffset(first, start));
    range.setEnd(last.node, endInLast);
    return range;
  } catch {
    return null;
  }
}

// ── HIGHLIGHTING AND NAVIGATION ──────────────────────────────────────

function clearHighlights(): void {
  CSS.highlights.delete(ALL_NAME);
  CSS.highlights.delete(CURRENT_NAME);
  ranges = [];
  current = -1;
  styleEl?.remove();
}

function paintRanges(): void {
  const all = new Highlight(...ranges);
  CSS.highlights.set(ALL_NAME, all);
  const currentRange = ranges[current];
  if (currentRange) {
    const emphasized = new Highlight(currentRange);
    // Above the whole-page highlight where the two overlap, so the current match stands out.
    emphasized.priority = 1;
    CSS.highlights.set(CURRENT_NAME, emphasized);
  } else {
    CSS.highlights.delete(CURRENT_NAME);
  }
}

/** Brings the current match into view, unless it's already comfortably on screen. */
function scrollToCurrent(): void {
  const range = ranges[current];
  if (!range) {
    return;
  }
  const rect = range.getBoundingClientRect();
  const comfortable = rect.top >= SCROLL_MARGIN_PX && rect.bottom <= window.innerHeight - SCROLL_MARGIN_PX;
  if (!comfortable) {
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}

/** The first match at or below the top of the viewport — where a search starts, as in an editor, rather than always at the top of the page. */
function firstMatchInView(): number {
  const limit = Math.min(ranges.length, START_SEARCH_LIMIT);
  for (let index = 0; index < limit; index += 1) {
    const range = ranges[index];
    if (range && range.getBoundingClientRect().bottom > 0) {
      return index;
    }
  }
  return 0;
}

function report(invalid: boolean): void {
  ipcRenderer.send(FindResult, {
    index: ranges.length === 0 ? 0 : current + 1,
    total: ranges.length,
    capped,
    invalid,
  });
}

function search(query: string, options: FindOptions, color: RgbColor): void {
  clearHighlights();
  capped = false;
  const pattern = buildFindPattern(query, options);
  if (pattern.kind !== 'ok') {
    report(pattern.kind === 'invalid');
    return;
  }
  paintStyle(color);
  const searched = indexPage();
  const found = findMatches(searched.text, pattern.regExp);
  capped = found.capped;
  ranges = found.matches.flatMap((match) => rangeFor(searched, match.start, match.end) ?? []);
  current = ranges.length === 0 ? -1 : firstMatchInView();
  paintRanges();
  scrollToCurrent();
  report(false);
}

function moveTo(index: number): void {
  if (index < 0 || ranges.length === 0) {
    report(false);
    return;
  }
  current = index;
  paintRanges();
  scrollToCurrent();
  report(false);
}

ipcRenderer.on(FindCommand, (_event, command: Command) => {
  switch (command.action) {
    case 'search':
      search(command.query, command.options, command.color);
      break;
    case 'step':
      moveTo(stepIndex(current, command.direction, ranges.length));
      break;
    case 'goto':
      moveTo(clampOccurrence(command.index, ranges.length));
      break;
    case 'clear':
      clearHighlights();
      break;
  }
});
