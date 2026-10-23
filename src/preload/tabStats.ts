// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { ipcRenderer } from 'electron';

// What the chrome's stat bar shows for a web page: its words, characters, images, links and elements, the element
// under the pointer, and the selection's words and characters. Counted here, in the page, and sent to main, which
// hands the active tab's to the chrome. Hardcoded rather than imported from `@shared` — see `tabZoom.ts`'s imports.
const TabPageStats = 'tab:page-stats';

/** How long the page must settle after a change before it is counted again: counting reads all its text. */
const RECOUNT_DELAY_MS = 1000;
/** The least time between two hover or selection reports, so moving the pointer doesn't flood main. */
const LIVE_REPORT_MS = 80;
/** The longest description of the hovered element sent. */
const MAX_HOVER_LENGTH = 80;

/** A word: a run of letters or digits, with inner apostrophes and hyphens. The same as the notes' word count. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu;

/** How many loaded files the browser keeps a record of (its default, 250, is soon passed by a busy page). */
const RESOURCE_RECORD_LIMIT = 5000;

interface PageCounts {
  words: number;
  characters: number;
  images: number;
  links: number;
  bytes: number;
  elements: number;
}

let counts: PageCounts = { words: 0, characters: 0, images: 0, links: 0, bytes: 0, elements: 0 };
let hovered: string | null = null;
let focused: string | null = null;
let pointer: { x: number; y: number } | null = null;
let selection: { words: number; characters: number } | null = null;
let recountTimer = 0;
let reportTimer = 0;
let lastReport = 0;

/**
 * Words and characters in a piece of text, characters counted as a person
 * would (an emoji is one, not its two UTF-16 units).
 * @param text The text.
 */
function measureText(text: string): { words: number; characters: number } {
  // A surrogate pair's second half isn't a character of its own. Counted in place, not by splitting the text: a page's
  // whole text can be megabytes, and this runs as the page changes.
  let lowSurrogates = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) {
      lowSurrogates += 1;
    }
  }
  return { words: text.match(WORD)?.length ?? 0, characters: text.length - lowSurrogates };
}

/** Sends everything, now. */
function report(): void {
  window.clearTimeout(reportTimer);
  reportTimer = 0;
  lastReport = performance.now();
  ipcRenderer.send(TabPageStats, { ...counts, hovered, focused, pointer, selection });
}

/** Sends everything soon: at once if it hasn't been sent lately, else once the pause is up. */
function reportSoon(): void {
  if (reportTimer) {
    return;
  }
  const wait = Math.max(0, LIVE_REPORT_MS - (performance.now() - lastReport));
  reportTimer = window.setTimeout(report, wait);
}

/**
 * The page's size in bytes: its document and every file it has loaded, as the browser recorded them (the
 * compressed bodies, as sent, whether or not they came from the cache). A file from another site that doesn't
 * send `Timing-Allow-Origin` records 0, so the total can fall short of the real one.
 */
function pageBytes(): number {
  const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')];
  return entries.reduce((total, entry) => total + ((entry as PerformanceResourceTiming).encodedBodySize || 0), 0);
}

/**
 * Whether this is a website (http or https). Anything else in a browser tab is the app's own page (the home page a
 * new tab opens on), which has nothing of a site to count: the bar shows zeros and no hovered element for it.
 */
const IS_WEBSITE = location.protocol === 'http:' || location.protocol === 'https:';

/** Counts the whole page: its visible text, images, links, bytes and elements. */
function recount(): void {
  recountTimer = 0;
  if (!IS_WEBSITE) {
    report();
    return;
  }
  const body = document.body;
  // The text a reader sees (`innerText` skips scripts, styles and hidden parts), whitespace runs as one space.
  const text = body ? body.innerText.replace(/\s+/g, ' ').trim() : '';
  counts = {
    ...measureText(text),
    images: document.images.length,
    links: document.links.length,
    bytes: pageBytes(),
    elements: document.getElementsByTagName('*').length,
  };
  report();
}

/** Counts again once the page has settled, unless it's hidden (a background tab), when it waits to be shown. */
function recountSoon(): void {
  if (recountTimer || document.hidden) {
    return;
  }
  recountTimer = window.setTimeout(recount, RECOUNT_DELAY_MS);
}

/**
 * A short description of an element, as a developer reads it: its tag, id and
 * first classes (`a#home.nav-link.active`).
 * @param element The element.
 */
function describe(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join('');
  const text = `${element.tagName.toLowerCase()}${id}${classes}`;
  return text.length > MAX_HOVER_LENGTH ? `${text.slice(0, MAX_HOVER_LENGTH - 1)}…` : text;
}

window.addEventListener(
  'mouseover',
  (event) => {
    const next = IS_WEBSITE && event.target instanceof Element ? describe(event.target) : null;
    if (next !== hovered) {
      hovered = next;
      reportSoon();
    }
  },
  true,
);

document.addEventListener('mouseleave', () => {
  if (hovered !== null || pointer !== null) {
    hovered = null;
    pointer = null;
    reportSoon();
  }
});

// Where the pointer is, for the stat bar's x×y; sent no more often than the hover (`LIVE_REPORT_MS`). Any page, the
// app's own included: it's a position on the screen, not something of the site's.
window.addEventListener(
  'pointermove',
  (event) => {
    const x = Math.round(event.clientX);
    const y = Math.round(event.clientY);
    if (pointer?.x !== x || pointer?.y !== y) {
      pointer = { x, y };
      reportSoon();
    }
  },
  { capture: true, passive: true },
);

/**
 * The element with the keyboard, described like the hovered one; `null` when focus is on the page itself (its body,
 * or nothing), which says nothing worth showing. Not on the app's own pages.
 */
function describeFocus(): string | null {
  const element = document.activeElement;
  if (!IS_WEBSITE || !element || element === document.body || element === document.documentElement) {
    return null;
  }
  return describe(element);
}

// Focus moving anywhere in the page (a click into a text box, Tab to a button), or leaving it.
for (const type of ['focusin', 'focusout']) {
  window.addEventListener(
    type,
    () => {
      // On `focusout` the next element isn't focused yet: look once focus has settled.
      window.setTimeout(() => {
        const next = describeFocus();
        if (next !== focused) {
          focused = next;
          reportSoon();
        }
      }, 0);
    },
    true,
  );
}

document.addEventListener('selectionchange', () => {
  const selected = IS_WEBSITE ? (window.getSelection()?.toString() ?? '') : '';
  const next = selected.trim() === '' ? null : measureText(selected);
  if (next?.words !== selection?.words || next?.characters !== selection?.characters) {
    selection = next;
    reportSoon();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    recountSoon();
  }
});

// Keep a record of every file, not the first 250, so the byte count covers the whole page; and count again as more
// arrive (a page keeps loading images and data after its own load).
performance.setResourceTimingBufferSize(RESOURCE_RECORD_LIMIT);
new PerformanceObserver(recountSoon).observe({ type: 'resource' });

// The first count once the page has loaded, then again whenever its content changes.
window.addEventListener('DOMContentLoaded', () => {
  recount();
  new MutationObserver(recountSoon).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
});
window.addEventListener('load', recountSoon);
