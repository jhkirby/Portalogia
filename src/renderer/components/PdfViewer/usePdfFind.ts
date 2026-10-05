// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { useEffect, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { FindCommand } from '@shared/ipc-contract';
import { buildFindPattern, clampOccurrence, findMatches, MAX_FIND_MATCHES, stepIndex, type FindOptions } from '@shared/find';

/** Names registered with `CSS.highlights` for the matches, painted by `pdf-viewer.css`. */
const ALL_NAME = 'northstar-pdf-find';
const CURRENT_NAME = 'northstar-pdf-find-current';

/** A page's searchable text, with where each text-layer item's own text sits in it. Only non-empty items count: an empty item has no text node on the page. */
interface PageText {
  readonly text: string;
  readonly itemStarts: readonly number[];
  readonly itemLengths: readonly number[];
}

/** A match: a half-open character range within one page's text. */
interface PageMatch {
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

/** What `getTextContent` gives for one entry of a page's content: a run of text, or a marker with none. */
interface TextItemLike {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

/** Joins a page's text items into one string — a line break after each item that ends a line — and notes where each item starts. */
function buildPageText(items: readonly TextItemLike[]): PageText {
  let text = '';
  const itemStarts: number[] = [];
  const itemLengths: number[] = [];
  for (const item of items) {
    const str = item.str ?? '';
    if (str !== '') {
      itemStarts.push(text.length);
      itemLengths.push(str.length);
      text += str;
    }
    if (item.hasEOL) {
      text += '\n';
    }
  }
  return { text, itemStarts, itemLengths };
}

/** The text nodes of a page's text layer, in order — one per non-empty item, which is how `PageText` indexes them. */
function textNodesOf(layer: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

/** A `Range` over a match in a page's rendered text layer, or `null` if the match falls only on line breaks. */
function rangeFor(nodes: readonly Text[], pageText: PageText, match: PageMatch): Range | null {
  const { itemStarts, itemLengths } = pageText;
  // Items run in order, so the first to end after the match starts and the last to start before it ends are binary searches.
  let low = 0;
  let high = itemStarts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((itemStarts[middle] ?? 0) + (itemLengths[middle] ?? 0) > match.start) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  const first = low < itemStarts.length ? low : -1;
  low = 0;
  high = itemStarts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((itemStarts[middle] ?? 0) < match.end) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const last = low - 1;
  const startNode = nodes[first];
  const endNode = nodes[last];
  if (first === -1 || last === -1 || first > last || !startNode || !endNode) {
    return null;
  }
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.max(0, match.start - (itemStarts[first] ?? 0)));
    range.setEnd(endNode, Math.min(itemLengths[last] ?? 0, match.end - (itemStarts[last] ?? 0)));
    return range;
  } catch {
    return null;
  }
}

/**
 * Find-bar search for the open PDF. The bar lives in its own view; this
 * answers its commands (`window.northstarPdf.onFind`) for this page's document.
 *
 * pdf.js only draws a page's text layer once the page is near the viewport,
 * so the search can't read the DOM for pages not shown yet. It reads each
 * page's text from pdf.js directly (`getTextContent`, cached per document)
 * to find and count every match in the whole file, then paints highlights on
 * whichever pages currently have a text layer — repainting as more are drawn
 * (a `MutationObserver` on the scroll area) — and, to reach a match on a page
 * not drawn yet, scrolls that page into view and finishes the jump once its
 * text appears.
 * @param doc The open document, or `null` before one is.
 * @param scrollRef The scroll area holding the pages.
 */
export function usePdfFind(doc: PDFDocumentProxy | null, scrollRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const pageTexts = new Map<number, PageText>();
    let matches: readonly PageMatch[] = [];
    let current = -1;
    let capped = false;
    let searchId = 0;
    let pendingReveal = false;
    let observer: MutationObserver | null = null;
    let frame = 0;

    const clearHighlights = (): void => {
      CSS.highlights.delete(ALL_NAME);
      CSS.highlights.delete(CURRENT_NAME);
    };

    const report = (invalid: boolean): void => {
      window.northstarPdf.reportFind({
        index: matches.length === 0 ? 0 : current + 1,
        total: matches.length,
        capped,
        invalid,
      });
    };

    const loadAllPageTexts = async (): Promise<void> => {
      if (!doc) {
        return;
      }
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        if (!pageTexts.has(pageNumber)) {
          const page = await doc.getPage(pageNumber);
          const content = await page.getTextContent();
          pageTexts.set(pageNumber, buildPageText(content.items as readonly TextItemLike[]));
        }
      }
    };

    /** Paints the matches on every page that has a text layer right now, and finishes a pending jump to the current match. */
    const applyHighlights = (): void => {
      const root = scrollRef.current;
      if (!root || matches.length === 0) {
        clearHighlights();
        return;
      }
      const all: Range[] = [];
      let currentRange: Range | null = null;
      const pageElements = root.querySelectorAll<HTMLElement>('[data-page-number]');
      for (const pageElement of pageElements) {
        const pageNumber = Number(pageElement.dataset['pageNumber']);
        const pageText = pageTexts.get(pageNumber);
        const layer = pageElement.querySelector('.textLayer');
        if (!pageText || !layer) {
          continue;
        }
        const nodes = textNodesOf(layer);
        // The layer is drawn a piece at a time; wait until every item has its node.
        if (nodes.length !== pageText.itemStarts.length) {
          continue;
        }
        matches.forEach((match, index) => {
          if (match.page !== pageNumber) {
            return;
          }
          const range = rangeFor(nodes, pageText, match);
          if (range) {
            all.push(range);
            if (index === current) {
              currentRange = range;
            }
          }
        });
      }
      CSS.highlights.set(ALL_NAME, new Highlight(...all));
      if (currentRange) {
        const emphasized = new Highlight(currentRange);
        emphasized.priority = 1;
        CSS.highlights.set(CURRENT_NAME, emphasized);
        if (pendingReveal) {
          pendingReveal = false;
          (currentRange as Range).startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      } else {
        CSS.highlights.delete(CURRENT_NAME);
      }
    };

    const scheduleApply = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(applyHighlights);
    };

    /** Brings the current match into view: the page first (so its text layer is drawn), then the match itself once it is. */
    const reveal = (): void => {
      const match = matches[current];
      if (!match) {
        return;
      }
      pendingReveal = true;
      applyHighlights();
      if (pendingReveal) {
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-page-number="${match.page}"]`)
          ?.scrollIntoView({ block: 'start' });
      }
    };

    /** The first page whose bottom is below the top of the scroll area: where a search starts. */
    const firstVisiblePage = (): number => {
      const root = scrollRef.current;
      if (!root) {
        return 1;
      }
      const top = root.getBoundingClientRect().top;
      for (const element of root.querySelectorAll<HTMLElement>('[data-page-number]')) {
        if (element.getBoundingClientRect().bottom > top) {
          return Number(element.dataset['pageNumber']);
        }
      }
      return 1;
    };

    const search = async (query: string, options: FindOptions): Promise<void> => {
      searchId += 1;
      const thisSearch = searchId;
      clearHighlights();
      matches = [];
      current = -1;
      capped = false;
      const pattern = buildFindPattern(query, options);
      if (pattern.kind !== 'ok' || !doc) {
        report(pattern.kind === 'invalid');
        return;
      }
      await loadAllPageTexts();
      if (thisSearch !== searchId) {
        return;
      }
      const found: PageMatch[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages && found.length < MAX_FIND_MATCHES; pageNumber += 1) {
        const pageText = pageTexts.get(pageNumber);
        if (!pageText) {
          continue;
        }
        const result = findMatches(pageText.text, pattern.regExp, MAX_FIND_MATCHES - found.length);
        capped = capped || result.capped;
        result.matches.forEach((match) => found.push({ page: pageNumber, start: match.start, end: match.end }));
      }
      matches = found;
      const startPage = firstVisiblePage();
      const firstFromHere = matches.findIndex((match) => match.page >= startPage);
      current = matches.length === 0 ? -1 : Math.max(firstFromHere, 0);
      observer ??= new MutationObserver(scheduleApply);
      if (scrollRef.current) {
        observer.observe(scrollRef.current, { childList: true, subtree: true });
      }
      reveal();
      report(false);
    };

    const moveTo = (index: number): void => {
      if (index < 0 || matches.length === 0) {
        report(false);
        return;
      }
      current = index;
      reveal();
      report(false);
    };

    const stop = window.northstarPdf.onFind((command: FindCommand) => {
      switch (command.action) {
        case 'search':
          void search(command.query, command.options);
          break;
        case 'step':
          moveTo(stepIndex(current, command.direction, matches.length));
          break;
        case 'goto':
          moveTo(clampOccurrence(command.index, matches.length));
          break;
        case 'clear':
          searchId += 1;
          matches = [];
          current = -1;
          observer?.disconnect();
          clearHighlights();
          break;
      }
    });

    return () => {
      stop();
      searchId += 1;
      observer?.disconnect();
      cancelAnimationFrame(frame);
      clearHighlights();
    };
  }, [doc, scrollRef]);
}
