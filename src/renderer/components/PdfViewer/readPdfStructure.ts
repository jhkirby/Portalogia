// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { countCharacters, wordStarts } from '@shared/markdown/structure';
import {
  MAX_SECTIONS,
  MAX_SECTION_LEVEL,
  detectHeadings,
  linesOfPage,
  type PdfSection,
  type PdfTextLine,
  type PdfTextRun,
} from '@shared/pdf/sections';
import type { PdfDocumentStats } from './PdfStatusBar';

/** pdf.js's annotation type for a link (`AnnotationType.LINK`). */
const LINK_ANNOTATION_TYPE = 2;

/** The most outbound links listed, so a document of thousands of cross-references doesn't flood the panel. */
const MAX_OUTBOUND_LINKS = 1000;

/** The most characters of a link's words used for its label. */
const MAX_LINK_LABEL_CHARS = 120;

/** A link in the document, as the side panel lists it. */
export interface PdfOutboundLink {
  /** The words the link sits on, or failing those its address. */
  readonly label: string;
  /** A web address, or `null` for a link to a page of this document. */
  readonly url: string | null;
  /** The page a link inside the document goes to (1-based), or `null` for a web link or one that can't be resolved. */
  readonly targetPage: number | null;
  /** The page the link is on. */
  readonly page: number;
}

/** What's read from a document once it opens, for the stat bar and the side panel. */
export interface PdfStructure {
  readonly stats: PdfDocumentStats;
  /** The file's own outline (bookmarks), flattened; else its headings read from the text (`detectHeadings`). */
  readonly sections: readonly PdfSection[];
  /** Whether `sections` came from the file's own outline rather than its text. */
  readonly fromOutline: boolean;
  readonly links: readonly PdfOutboundLink[];
}

/** An entry of pdf.js's `getOutline`, the fields read here. */
interface OutlineNode {
  readonly title: string;
  readonly dest: unknown;
  readonly items: readonly OutlineNode[];
}

/**
 * The 1-based page a destination names: by a named destination, an explicit
 * one (`[pageRef, …]`), or (in some files) a 0-based index.
 * @param doc The document.
 * @param dest pdf.js's `dest`, as given on a link or an outline entry.
 * @returns The page, or `null` if the document doesn't contain it.
 */
export async function pageOfDestination(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const target: unknown = Array.isArray(explicit) ? explicit[0] : null;
    const index =
      typeof target === 'number'
        ? target
        : target !== null && typeof target === 'object'
          ? await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])
          : null;
    return index === null || index < 0 || index >= doc.numPages ? null : index + 1;
  } catch {
    return null;
  }
}

/**
 * The file's outline as sections, depth first, each at the page its entry
 * goes to. Entries that go nowhere in the document take the page of the one
 * before them.
 * @param doc The document.
 * @param isCancelled Stops the walk once the document has been replaced.
 */
async function readOutline(doc: PDFDocumentProxy, isCancelled: () => boolean): Promise<PdfSection[]> {
  let outline: readonly OutlineNode[] | null;
  try {
    outline = (await doc.getOutline()) as readonly OutlineNode[] | null;
  } catch {
    return [];
  }
  const sections: PdfSection[] = [];
  const walk = async (nodes: readonly OutlineNode[], level: number): Promise<void> => {
    for (const node of nodes) {
      if (sections.length >= MAX_SECTIONS || isCancelled()) {
        return;
      }
      const page = (await pageOfDestination(doc, node.dest)) ?? sections[sections.length - 1]?.page ?? 1;
      sections.push({ title: node.title.replace(/\s+/g, ' ').trim(), page, level: Math.min(level, MAX_SECTION_LEVEL) });
      await walk(node.items, level + 1);
    }
  };
  await walk(outline ?? [], 0);
  return sections;
}

/** A run of text with where it starts on the page, for finding the words a link covers. */
interface PlacedRun {
  readonly str: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The words lying in a link's box: the runs whose starting point is inside it.
 * @param runs The page's runs.
 * @param rect The link's `[left, bottom, right, top]` in PDF points.
 */
function wordsIn(runs: readonly PlacedRun[], rect: readonly number[]): string {
  const [left = 0, bottom = 0, right = 0, top = 0] = rect;
  const words = runs
    .filter((run) => run.x >= Math.min(left, right) - 1 && run.x <= Math.max(left, right) && run.y >= Math.min(bottom, top) - 2 && run.y <= Math.max(bottom, top) + 2)
    .map((run) => run.str)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return words.length > MAX_LINK_LABEL_CHARS ? `${words.slice(0, MAX_LINK_LABEL_CHARS - 1)}…` : words;
}

/**
 * Reads a document once it opens, page by page: its words, characters and
 * links for the stat bar, its sections and its links for the side panel. A
 * long document takes a moment, so this runs in the background.
 * @param doc The document.
 * @param isCancelled Stops the read once the document has been replaced.
 * @returns What was read, or `null` if cancelled.
 */
export async function readPdfStructure(doc: PDFDocumentProxy, isCancelled: () => boolean): Promise<PdfStructure | null> {
  let words = 0;
  let characters = 0;
  let linkCount = 0;
  const lines: PdfTextLine[] = [];
  const links: PdfOutboundLink[] = [];
  const seen = new Set<string>();
  for (let n = 1; n <= doc.numPages; n += 1) {
    if (isCancelled()) {
      return null;
    }
    try {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const runs = content.items.filter((item): item is typeof item & PdfTextRun => 'str' in item);
      // pdf.js's runs carry their own spaces and mark where a line ends; a line end counts as a space, as it reads.
      const text = runs.map((run) => run.str + (run.hasEOL ? ' ' : '')).join('');
      words += wordStarts(text).length;
      characters += countCharacters(text.trimEnd());
      lines.push(...linesOfPage(n, runs));
      const placed: PlacedRun[] = runs.map((run) => ({ str: run.str, x: run.transform[4] ?? 0, y: run.transform[5] ?? 0 }));
      const annotations: unknown[] = await page.getAnnotations({ intent: 'display' });
      for (const raw of annotations) {
        const annotation = raw as { annotationType?: number; rect?: number[]; url?: unknown; dest?: unknown };
        if (annotation.annotationType !== LINK_ANNOTATION_TYPE) {
          continue;
        }
        linkCount += 1;
        const url = typeof annotation.url === 'string' ? annotation.url : null;
        if ((url === null && annotation.dest == null) || links.length >= MAX_OUTBOUND_LINKS) {
          continue;
        }
        const targetPage = url === null ? await pageOfDestination(doc, annotation.dest) : null;
        const label = wordsIn(placed, annotation.rect ?? []) || url || (targetPage !== null ? `Page ${targetPage}` : '');
        // The same address linked twice (a URL set on every page) is listed once.
        const key = url !== null ? `url:${url}` : `page:${targetPage}:${label}`;
        if (label !== '' && !seen.has(key)) {
          seen.add(key);
          links.push({ label, url, targetPage, page: n });
        }
      }
    } catch {
      // A page pdf.js can't read adds nothing.
    }
  }
  const outline = await readOutline(doc, isCancelled);
  if (isCancelled()) {
    return null;
  }
  const fromOutline = outline.length > 0;
  return {
    stats: { words, characters, links: linkCount },
    sections: fromOutline ? outline : detectHeadings(lines),
    fromOutline,
    links,
  };
}
