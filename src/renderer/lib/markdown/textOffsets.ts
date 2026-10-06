// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/** Marks a piece of the page's own interface (a code block's Run button, its output) inside the rendered note — its text is not the note's text. */
export const UI_ATTRIBUTE = 'data-md-ui';

/** A text node of the rendered note and where its text sits in the note's whole text. */
export interface TextSpan {
  readonly node: Text;
  /** Offset of the node's first character in `RenderedText.text`. */
  readonly start: number;
  readonly length: number;
}

/** The text of a rendered note as the reader sees it, with where each text node's piece of it is. */
export interface RenderedText {
  readonly text: string;
  readonly spans: readonly TextSpan[];
}

/** Elements that start a new line of text: a match for the find bar mustn't run across them. */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, div, tr, hr, br';

/** The nearest block-level element around a node, for telling when the text moves on to the next one. */
function blockOf(node: Node, root: Element): Element {
  return (node.parentElement?.closest(BLOCK_SELECTOR) as Element | null) ?? root;
}

/**
 * The text of a rendered note and where each text node's piece of it is. The
 * page's own controls inside it (`data-md-ui`) are skipped, so a highlight or
 * find match is always about the note's words. A line break is put between
 * text in different blocks, so a search can't match across two paragraphs
 * but `^`/`$` still work per line.
 *
 * Offsets in the returned text are stable for a given rendering of a given
 * note — which is what a stored highlight relies on.
 * @param root The element holding the rendered note.
 */
export function collectRenderedText(root: Element): RenderedText {
  const spans: TextSpan[] = [];
  let text = '';
  let previousBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`[${UI_ATTRIBUTE}]`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const content = node.nodeValue ?? '';
    if (content === '') {
      continue;
    }
    const block = blockOf(node, root);
    if (previousBlock !== null && block !== previousBlock) {
      text += '\n';
    }
    previousBlock = block;
    spans.push({ node: node as Text, start: text.length, length: content.length });
    text += content;
  }
  return { text, spans };
}

/** The index of the span holding character `offset`, or the last span if it is at the very end — by binary search. */
function spanIndexAt(spans: readonly TextSpan[], offset: number): number {
  let low = 0;
  let high = spans.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((spans[middle]?.start ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * A `Range` over the characters `[start, end)` of the rendered text, or `null` if they fall outside it.
 * @param rendered What `collectRenderedText` returned.
 */
export function rangeForOffsets(rendered: RenderedText, start: number, end: number): Range | null {
  const { spans } = rendered;
  if (spans.length === 0 || start >= end) {
    return null;
  }
  const first = spans[spanIndexAt(spans, start)];
  // The last character included is `end - 1`; ending at a span's start would put the range's end in the span after.
  const last = spans[spanIndexAt(spans, Math.max(start, end - 1))];
  if (!first || !last) {
    return null;
  }
  try {
    const range = document.createRange();
    range.setStart(first.node, Math.min(Math.max(0, start - first.start), first.length));
    range.setEnd(last.node, Math.min(Math.max(0, end - last.start), last.length));
    return range;
  } catch {
    return null;
  }
}

/**
 * Where a point in the DOM sits in the rendered text.
 * @param rendered What `collectRenderedText` returned.
 * @param container The node the point is in — a text node, or an element (then `offset` counts its children).
 * @param offset The offset within `container`.
 * @returns The offset into `rendered.text`, or `null` if the point isn't in the note's own text.
 */
export function offsetOfPoint(rendered: RenderedText, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const span = rendered.spans.find((candidate) => candidate.node === container);
    return span ? span.start + Math.min(offset, span.length) : null;
  }
  // A point between elements: the start of the first text after it (or the end of the text before it).
  const probe = document.createRange();
  probe.setStart(container, Math.min(offset, container.childNodes.length));
  probe.collapse(true);
  for (const span of rendered.spans) {
    const position = probe.comparePoint(span.node, 0);
    if (position >= 0) {
      return span.start;
    }
  }
  const lastSpan = rendered.spans[rendered.spans.length - 1];
  return lastSpan ? lastSpan.start + lastSpan.length : null;
}

/**
 * Finds a highlight's words again after the note changed around them: where
 * they were if they're still there, else the nearest other place the same
 * words occur.
 * @param text The rendered text now.
 * @param start Where the highlight began when it was made.
 * @param end Where it ended.
 * @param quote The words it covered.
 * @returns Its new `[start, end)`, or `null` if those words are gone.
 */
export function reanchorHighlight(
  text: string,
  start: number,
  end: number,
  quote: string,
): { readonly start: number; readonly end: number } | null {
  if (quote === '') {
    return null;
  }
  if (text.slice(start, end) === quote) {
    return { start, end };
  }
  let best = -1;
  let from = text.indexOf(quote);
  while (from !== -1) {
    if (best === -1 || Math.abs(from - start) < Math.abs(best - start)) {
      best = from;
    }
    from = text.indexOf(quote, from + 1);
  }
  return best === -1 ? null : { start: best, end: best + quote.length };
}
