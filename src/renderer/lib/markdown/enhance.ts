// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import katex from 'katex';
import { CALLOUT_PATTERN, calloutKind } from '@shared/markdown/callouts';
import { slugifyHeading } from '@shared/markdown/parser';
import { REMOTE_SRC_ATTRIBUTE } from './renderNote';
import { UI_ATTRIBUTE } from './textOffsets';

/** One heading of a rendered note: what the outline panel lists and a `[[Note#Heading]]` link scrolls to. */
export interface OutlineEntry {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

/** Typesets every math placeholder (`$…$`, `$$…$$`) in a rendered note with KaTeX. The TeX stays in `data-tex`, for copying and export. */
export function typesetMath(root: Element): void {
  root.querySelectorAll<HTMLElement>('.md-math').forEach((element) => {
    const tex = element.dataset['tex'] ?? element.textContent ?? '';
    try {
      katex.render(tex, element, {
        displayMode: element.classList.contains('md-math--display'),
        // A formula with an error shows the TeX in red instead of throwing away the paragraph around it.
        throwOnError: false,
        // `html` only: the MathML copy would double the text a find or a highlight sees.
        output: 'html',
        trust: false,
        strict: 'ignore',
      });
    } catch {
      element.textContent = tex;
    }
  });
}

/**
 * Gives every heading a unique `id` (its slug; repeats get `-1`, `-2`, …) —
 * how `[[Note#Heading]]`, `[text](#heading)` and the outline find them.
 * @returns The note's headings, in order.
 */
export function numberHeadings(root: Element): OutlineEntry[] {
  const used = new Map<string, number>();
  const outline: OutlineEntry[] = [];
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    const text = (heading.textContent ?? '').trim();
    const base = slugifyHeading(text) || 'section';
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    // Prefixed so a heading called "location" or "body" can't shadow a document property (DOM clobbering).
    const id = `md-${seen === 0 ? base : `${base}-${seen}`}`;
    heading.id = id;
    outline.push({ id, text, level: Number(heading.tagName.slice(1)) });
  });
  return outline;
}

/** Finds the heading a link names (`Heading Text` as written after a `#`), by slug. */
export function findHeading(root: Element, heading: string): HTMLElement | null {
  const slug = slugifyHeading(heading);
  if (slug === '') {
    return null;
  }
  const matches = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter(
    (candidate) => slugifyHeading(candidate.textContent ?? '') === slug,
  );
  return matches[0] ?? null;
}

/** Makes the note's task-list checkboxes clickable, and numbers them in reading order — the number `toggleTask` counts by. */
export function enableTasks(root: Element): void {
  root.querySelectorAll<HTMLInputElement>('input.md-task').forEach((box, index) => {
    box.disabled = false;
    box.dataset['taskIndex'] = String(index);
  });
}

/**
 * Turns Obsidian callouts (`> [!note] Title`) into styled boxes. A quote
 * whose first line isn't `[!type]` is left as an ordinary quote.
 */
export function convertCallouts(root: Element): void {
  root.querySelectorAll('blockquote').forEach((quote) => {
    const firstParagraph = Array.from(quote.children).find((child) => child.tagName === 'P');
    const firstText = firstParagraph?.firstChild;
    if (!firstParagraph || !firstText || firstText.nodeType !== Node.TEXT_NODE) {
      return;
    }
    const match = CALLOUT_PATTERN.exec(firstText.nodeValue ?? '');
    if (!match) {
      return;
    }
    const type = (match[1] ?? '').toLowerCase();
    const kind = calloutKind(type);
    const customTitle = (match[3] ?? '').trim();
    firstText.nodeValue = (firstText.nodeValue ?? '').slice(match[0].length);
    if ((firstText.nodeValue ?? '') === '') {
      firstText.remove();
    }

    // A `+` or `-` makes it foldable: a <details>, open for `+` and closed for `-`.
    const callout = document.createElement(match[2] ? 'details' : 'div');
    callout.className = `md-callout md-callout--${kind.family}`;
    callout.dataset['callout'] = type;
    if (match[2] === '+') {
      callout.setAttribute('open', '');
    }
    const title = document.createElement(match[2] ? 'summary' : 'div');
    title.className = 'md-callout__title';
    title.textContent = customTitle === '' ? kind.title : customTitle;
    const body = document.createElement('div');
    body.className = 'md-callout__body';
    // The title line is the whole of the first paragraph when nothing else followed it.
    if (firstParagraph.childNodes.length === 0) {
      firstParagraph.remove();
    }
    while (quote.firstChild) {
      body.appendChild(quote.firstChild);
    }
    callout.append(title, body);
    quote.replaceWith(callout);
  });
}

/** Where `#tag`s are not tags: code, links, formulas and the page's own controls. */
const TAG_SKIP_SELECTOR = `a, code, pre, .md-math, [${UI_ATTRIBUTE}], mark`;

/** A `#tag`: a hash after whitespace (or the start), then a letter and word characters, `/` and `-`. */
const TAG_PATTERN = /(^|\s)(#[A-Za-z][\w/-]*)/g;

/** Wraps every `#tag` in the note's text in a styled span. */
export function decorateTags(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(TAG_SKIP_SELECTOR) && /(^|\s)#[A-Za-z]/.test(node.nodeValue ?? '')) {
      targets.push(node as Text);
    }
  }
  for (const node of targets) {
    const text = node.nodeValue ?? '';
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(TAG_PATTERN)) {
      const start = (match.index ?? 0) + (match[1] ?? '').length;
      fragment.append(text.slice(last, start));
      const tag = document.createElement('span');
      tag.className = 'md-tag';
      tag.textContent = match[2] ?? '';
      fragment.append(tag);
      last = start + (match[2] ?? '').length;
    }
    fragment.append(text.slice(last));
    node.replaceWith(fragment);
  }
}

/** Whether an image's `src` is one the page can load itself (inline data), not a path main has to read. */
function isLoadableSource(src: string): boolean {
  return /^data:image\//i.test(src);
}

/**
 * Marks the note's web pictures (set aside by `renderNote`) as waiting for a
 * click to load — shown as their alt text until then.
 * @returns Each picture with its address.
 */
export function collectRemoteImages(root: Element): { readonly image: HTMLImageElement; readonly url: string }[] {
  const found: { image: HTMLImageElement; url: string }[] = [];
  root.querySelectorAll<HTMLImageElement>(`img[${REMOTE_SRC_ATTRIBUTE}]`).forEach((image) => {
    const url = image.getAttribute(REMOTE_SRC_ATTRIBUTE) ?? '';
    image.classList.add('md-image--remote');
    image.title = `Web picture, not loaded: ${url}\nClick to load it.`;
    if (!image.alt) {
      image.alt = 'Web picture';
    }
    found.push({ image, url });
  });
  return found;
}

/**
 * Finds the pictures of a note that sit on disk (`![[name.png]]` embeds and
 * `![](relative/path.png)`), takes their `src` off so nothing tries to load
 * a local path, and returns them with what to ask main for.
 */
export function collectLocalImages(root: Element): { readonly image: HTMLImageElement; readonly src: string }[] {
  const found: { image: HTMLImageElement; src: string }[] = [];
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const embedded = image.dataset['mdSrc'];
    const src = embedded ?? image.getAttribute('src') ?? '';
    if (embedded === undefined && (src === '' || isLoadableSource(src))) {
      return;
    }
    image.removeAttribute('src');
    image.classList.add('md-image--loading');
    found.push({ image, src });
  });
  return found;
}

/** Every distinct `[[wikilink]]` in the note, as the text inside its brackets. */
export function collectWikiLinks(root: Element): string[] {
  const names = new Set<string>();
  root.querySelectorAll<HTMLElement>('a.md-wikilink').forEach((link) => {
    const name = link.dataset['wikilink'];
    if (name) {
      names.add(name);
    }
  });
  return [...names];
}

/** Dims the `[[wikilinks]]` that name no note — the ones a click would create. */
export function markMissingWikiLinks(root: Element, resolved: Readonly<Record<string, boolean>>): void {
  root.querySelectorAll<HTMLElement>('a.md-wikilink').forEach((link) => {
    const name = link.dataset['wikilink'] ?? '';
    link.classList.toggle('md-wikilink--missing', resolved[name] === false);
  });
}

/** Marks links that leave the note, so they read as links to the web. */
export function markExternalLinks(root: Element): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    if (/^https?:\/\//i.test(link.getAttribute('href') ?? '')) {
      link.classList.add('md-link-external');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });
}
