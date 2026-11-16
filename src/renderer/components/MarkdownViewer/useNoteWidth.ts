// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * The elements a formatted note's column is a percent of: the reader's content (for View) or the editor's scroller
 * (for Edit) — the boxes `--md-formatted-width`'s percent resolves against.
 */
const WIDTH_BASE_SELECTOR = '.md-viewer__content, .md-viewer__editor .cm-scroller';

/** @returns The note's usual column (`--md-column-width`) in CSS pixels. */
function columnWidthPx(): number {
  const root = getComputedStyle(document.documentElement);
  const width = root.getPropertyValue('--md-column-width').trim();
  const value = parseFloat(width);
  // The token is set in rem; a px value would be taken as it is.
  return width.endsWith('rem') ? value * parseFloat(root.fontSize) : value;
}

/**
 * The toolbar's width slider for a note, on the page's side: how wide main
 * says to draw the formatted note (`MarkdownTabState.contentWidth`), as the
 * style that sets it, and the percent of the page the usual column takes, told
 * to main as the page resizes so the slider starts there. The raw text keeps a
 * text file's width: only the reader and the formatted editor read the style.
 * @param bodyRef The note's body, watched for resizes.
 * @param active Whether a note is shown (the empty page has nothing to size).
 * @returns The style to put on the viewer's root.
 */
export function useNoteWidth(bodyRef: RefObject<HTMLElement | null>, active: boolean): CSSProperties {
  const [percent, setPercent] = useState(0);
  useEffect(() => window.portalogiaMarkdown.onContentWidth(setPercent), []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!active || !body) {
      return undefined;
    }
    let reported = -1;
    const report = (): void => {
      const base = body.querySelector<HTMLElement>(WIDTH_BASE_SELECTOR);
      if (!base || base.clientWidth <= 0) {
        return;
      }
      const least = Math.min(100, Math.ceil((columnWidthPx() / base.clientWidth) * 100));
      if (least !== reported) {
        reported = least;
        window.portalogiaMarkdown.reportContentWidthMin(least);
      }
    };
    const observer = new ResizeObserver(report);
    observer.observe(body);
    // The reader and the editor swap inside the body without resizing it; each brings its own base.
    const swaps = new MutationObserver(report);
    swaps.observe(body, { childList: true });
    report();
    return () => {
      observer.disconnect();
      swaps.disconnect();
    };
  }, [bodyRef, active]);

  return percent > 0 ? ({ '--md-formatted-width': `max(var(--md-column-width), ${percent}%)` } as CSSProperties) : {};
}
