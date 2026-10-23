// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ZOOM_PERCENT_DEFAULT } from '@shared/constants';
import type { PdfOpenResult, PdfTool, PdfToolState } from '@shared/ipc-contract';
import type { PointerMode } from '@shared/tab-state';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import { commentCursor, highlighterCursor, penCursor, textCursor } from '../../lib/toolCursors';
import { countCharacters, countSelection, wordStarts } from '@shared/markdown/structure';
import { PdfPage, type PageHighlight, type PageLink, type PageRect } from './PdfPage';
import { PdfStatusBar, type PdfDocumentStats } from './PdfStatusBar';
import { usePdfFind } from './usePdfFind';
import type { PagePoint, PdfComment, PdfStroke, PdfTextBoxModel, PdfTextBoxPatch } from './PdfAnnotationLayer';
import { TEXT_BOX_FONT_SIZE_DEFAULT } from '@shared/constants';
import { PAN_WRAP_TIMEOUT_MS, wrapTargetAt, type PanWrap } from '@shared/panWrap';
import { CONTENT_FADE_MS, useLoadBlur } from '../../hooks/useLoadBlur';
import { FluidBackground } from '../FluidBackground';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** PDF page sizes are in points (1/72 in); CSS pixels are 1/96 in. Scale 1 here means "actual size". */
const CSS_PIXELS_PER_POINT = 96 / 72;

/** How long zoom must sit still before pages re-rasterize at the new scale. */
const RENDER_SCALE_DEBOUNCE_MS = 150;

/** Name registered with `CSS.highlights` for the live drag preview, like the browser highlighter's. */
const PREVIEW_HIGHLIGHT_NAME = 'northstar-pdf-highlighter-preview';

/** A finished highlight's alpha, halved for the drag preview (`tabHighlighter.ts`'s `MARK_ALPHA * HOVER_OPACITY`). */
const PREVIEW_ALPHA = 0.55 * 0.5;

/** Slivers narrower than this many CSS pixels are dropped when carving a new highlight around existing ones. */
const MIN_HIGHLIGHT_WIDTH_PX = 1.5;

/** How far a press can travel (px) and still count as a click on a highlight rather than a drag-select. */
const CLICK_DRAG_THRESHOLD_PX = 4;

/**
 * Cuts the parts of `rect` that lie under any of `blockers` out of it, so a
 * character already highlighted is never highlighted again. Only blockers on
 * the same line (mostly overlapping vertically) cut; what's left is returned
 * as zero or more pieces.
 */
function subtractRects(rect: PageRect, blockers: readonly PageRect[], minWidth: number): PageRect[] {
  let pieces: PageRect[] = [rect];
  for (const blocker of blockers) {
    const overlapY = Math.min(rect.y + rect.h, blocker.y + blocker.h) - Math.max(rect.y, blocker.y);
    if (overlapY < 0.5 * Math.min(rect.h, blocker.h)) {
      continue;
    }
    pieces = pieces.flatMap((piece) => {
      const pieceEnd = piece.x + piece.w;
      const blockerEnd = blocker.x + blocker.w;
      if (blocker.x >= pieceEnd || blockerEnd <= piece.x) {
        return [piece];
      }
      const kept: PageRect[] = [];
      if (blocker.x > piece.x) {
        kept.push({ ...piece, w: blocker.x - piece.x });
      }
      if (blockerEnd < pieceEnd) {
        kept.push({ ...piece, x: blockerEnd, w: pieceEnd - blockerEnd });
      }
      return kept;
    });
  }
  return pieces.filter((piece) => piece.w > minWidth);
}

/** A mark tagged with the 1-based page it belongs to. */
type OnPage<T> = T & { readonly page: number };

/** pdf.js's annotation type for a link (`AnnotationType.LINK`), counted for the stat bar. */
const LINK_ANNOTATION_TYPE = 2;

/** The undoable marks: what Ctrl+Z / Ctrl+Y step through. */
interface MarksSnapshot {
  readonly strokes: readonly OnPage<PdfStroke>[];
  readonly highlights: readonly OnPage<PageHighlight>[];
  readonly crops: readonly OnPage<PageRect>[];
}

/** How many edits Ctrl+Z can step back through. */
const MAX_HISTORY = 200;

// Shared empties, so closing a file resets the history baseline to exactly what the state holds.
const EMPTY_STROKES: readonly OnPage<PdfStroke>[] = [];
const EMPTY_HIGHLIGHTS: readonly OnPage<PageHighlight>[] = [];
const EMPTY_CROPS: readonly OnPage<PageRect>[] = [];

interface PageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Whether a press landed on the scroll area's own scroll bars rather than its
 * content: those keep working as scroll bars in every mode, so a press there
 * is never taken for a pan.
 * @param el The scroll area.
 * @param clientX The press's x, in viewport pixels.
 * @param clientY The press's y, in viewport pixels.
 * @returns `true` if the point is past the content box, over a scroll bar.
 */
function isOnScrollbar(el: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = el.getBoundingClientRect();
  return clientX >= rect.left + el.clientLeft + el.clientWidth || clientY >= rect.top + el.clientTop + el.clientHeight;
}

/**
 * The whole of `pdf.html`'s page: just the document in a scroll area. The
 * controls (Open PDF, file name, the Pan/Select modes, page counter, Export)
 * live in the chrome's main toolbar (`PdfToolbar`); main pushes opened files
 * and the pointer mode here.
 *
 * In Pan mode (the default) the pointer works like Okular's Browse tool:
 * press and drag anywhere on the document to move it (hand cursor); text
 * can't be selected and links don't take clicks. In Select mode a drag
 * selects text and links can be followed. The scroll bars work as scroll
 * bars in both.
 *
 * Zoom is owned by main (the app toolbar, menu shortcuts and Ctrl+wheel all
 * go through `TabManager`) and arrives via `onZoom`; this page only applies
 * it. While zoom changes the view stays centered on the same point of the
 * document.
 */
export function PdfViewer() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  /** Bumped per opened document so renaming the file doesn't remount the pages. */
  const [docVersion, setDocVersion] = useState(0);
  const [pageSizes, setPageSizes] = useState<readonly PageSize[]>([]);
  const [tool, setTool] = useState<PdfToolState>({ tool: 'none', color: { r: 26, g: 115, b: 232 } });
  // Held in memory only: marks aren't written into the PDF, and are dropped when another file is opened.
  const [strokes, setStrokes] = useState<readonly OnPage<PdfStroke>[]>([]);
  const [comments, setComments] = useState<readonly OnPage<PdfComment>[]>([]);
  const [textBoxes, setTextBoxes] = useState<readonly OnPage<PdfTextBoxModel>[]>([]);
  /** One entry per page a highlight touches; entries of one highlight share an id. */
  const [highlights, setHighlights] = useState<readonly OnPage<PageHighlight>[]>([]);
  /** At most one crop box per page; applied only to exports (see `PdfCropExporter`). */
  const [crops, setCrops] = useState<readonly OnPage<PageRect>[]>([]);
  /** The crop drag in progress: its box, and every page it applies to (more than one with Shift held at the start). */
  const [cropDrag, setCropDrag] = useState<{ pages: readonly number[]; rect: PageRect | null } | null>(null);
  /** Shift is down while the crop tool is on — shown on every page's corners as multi-crop mode. */
  const [shiftHeld, setShiftHeld] = useState(false);
  const [hoveredHighlightId, setHoveredHighlightId] = useState<string | null>(null);
  /** The comment whose box is open while the comment tool is off. */
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  /** Hash of the open document, the key its marks are saved under (see `PdfAnnotationStore`); `null` before one is open. */
  const [docKey, setDocKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Blurs the document while a file loads into it. */
  const loadBlur = useLoadBlur();
  const { start: startLoadBlur, finish: finishLoadBlur } = loadBlur;
  /** Whether the document is fading away, having been closed; the timer that then clears it. */
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef(0);
  const [zoomPercent, setZoomPercent] = useState(ZOOM_PERCENT_DEFAULT);
  const [renderPercent, setRenderPercent] = useState(ZOOM_PERCENT_DEFAULT);
  const [isPanning, setIsPanning] = useState(false);
  const [pointerMode, setPointerMode] = useState<PointerMode>('pan');
  useEffect(() => window.northstarPdf.onPointerMode(setPointerMode), []);
  /** The window's Focus Mode: the stat bar hides with the chrome. */
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => window.northstarPdf.onFocusMode(setFocusMode), []);
  /** The page in view, for the stat bar (main hears it too, through `reportPage`). */
  const [visiblePage, setVisiblePage] = useState(1);
  /** The open file's size in bytes, for the stat bar. */
  const [fileBytes, setFileBytes] = useState(0);
  /** The document's words, characters and links, counted after it opens; `null` while counting. */
  const [docStats, setDocStats] = useState<PdfDocumentStats | null>(null);
  /** The selected text's words and characters; `null` while nothing in the document is selected. */
  const [selectionStats, setSelectionStats] = useState<{ words: number; characters: number } | null>(null);
  // Back in Pan mode, a selection made in Select mode would be left stranded where nothing can change it.
  useEffect(() => {
    if (pointerMode === 'pan') {
      window.getSelection()?.removeAllRanges();
    }
  }, [pointerMode]);

  const [, setSchemeTick] = useState(0);
  // The tool cursors are drawn in light or dark ink to match the theme.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setSchemeTick((tick) => tick + 1);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  // The find bar's search of this document (see `usePdfFind`).
  usePdfFind(doc, scrollRef);
  /** Where the current highlighter press began, to tell a click on a highlight from a drag. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * Present while the page is grabbed. `x`/`y` are the pointer's last position (to scroll by how far it has gone
   * since). `wrap` is set while the pointer is on its way to the opposite edge (see `wrapTargetAt`).
   */
  const panRef = useRef<{ x: number; y: number; wrap: PanWrap | null } | null>(null);
  /** The document point at the center of the view just before a zoom change, as fractions of the scrollable size. */
  const anchorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(
    () =>
      window.northstarPdf.onZoom((percent) => {
        const el = scrollRef.current;
        if (el && el.scrollWidth > 0 && el.scrollHeight > 0) {
          anchorRef.current = {
            x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
            y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
          };
        }
        setZoomPercent(percent);
      }),
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setRenderPercent(zoomPercent), RENDER_SCALE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [zoomPercent]);

  // Re-centers on the anchor once the pages have resized for the new zoom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) {
      return;
    }
    el.scrollLeft = anchor.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = anchor.y * el.scrollHeight - el.clientHeight / 2;
    anchorRef.current = null;
  }, [zoomPercent]);

  const loadFile = useCallback(async (file: PdfOpenResult) => {
    // A file opened while the last one fades away replaces it at once.
    window.clearTimeout(closeTimerRef.current);
    setClosing(false);
    setError(null);
    startLoadBlur();
    try {
      // Read before pdf.js takes the bytes: it hands the buffer to its worker, which empties it here.
      const bytes = file.data.byteLength;
      const loaded = await getDocument({ data: file.data }).promise;
      setFileBytes(bytes);
      const sizes: PageSize[] = [];
      for (let n = 1; n <= loaded.numPages; n += 1) {
        const viewport = (await loaded.getPage(n)).getViewport({ scale: CSS_PIXELS_PER_POINT });
        sizes.push({ width: viewport.width, height: viewport.height });
      }
      setDoc((previous) => {
        void previous?.loadingTask.destroy();
        return loaded;
      });
      setPageSizes(sizes);
      setDocVersion((version) => version + 1);
      // Marks saved for this exact document come back; they're kept by the app, never written into the PDF.
      // A new document starts with no history, and what was just loaded isn't an edit.
      undoRef.current = [];
      redoRef.current = [];
      baselineRef.current = {
        strokes: file.annotations.strokes,
        highlights: file.annotations.highlights,
        crops: file.annotations.crops,
      };
      setStrokes(file.annotations.strokes);
      setComments(file.annotations.comments.map((comment) => ({ ...comment, committed: true })));
      setTextBoxes(file.annotations.textBoxes);
      setHighlights(file.annotations.highlights);
      setCrops(file.annotations.crops);
      setOpenCommentId(null);
      setDocKey(file.key);
      scrollRef.current?.scrollTo({ left: 0, top: 0 });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open that PDF.');
    } finally {
      finishLoadBlur();
    }
  }, [startLoadBlur, finishLoadBlur]);

  /** The page under the middle of the view (the last page if the view is past the end). */
  const reportVisiblePage = useCallback((): void => {
    const el = scrollRef.current;
    if (!el || pageSizes.length === 0) {
      setVisiblePage(1);
      window.northstarPdf.reportPage(1, pageSizes.length);
      return;
    }
    const middle = el.getBoundingClientRect().top + el.clientHeight / 2;
    let current = 1;
    el.querySelectorAll<HTMLElement>('[data-page-number]').forEach((pageEl) => {
      if (pageEl.getBoundingClientRect().top <= middle) {
        current = Number(pageEl.dataset['pageNumber']);
      }
    });
    setVisiblePage(current);
    window.northstarPdf.reportPage(current, pageSizes.length);
  }, [pageSizes]);

  // The document's words, characters and links, for the stat bar: read page by page in the background once it opens
  // (a long document takes a moment), then shown all at once.
  useEffect(() => {
    setDocStats(null);
    if (!doc) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let words = 0;
      let characters = 0;
      let links = 0;
      for (let n = 1; n <= doc.numPages && !cancelled; n += 1) {
        try {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          // pdf.js's runs carry their own spaces and mark where a line ends; a line end counts as a space, as it reads.
          const text = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? ' ' : '') : '')).join('');
          words += wordStarts(text).length;
          characters += countCharacters(text.trimEnd());
          const annotations: unknown[] = await page.getAnnotations({ intent: 'display' });
          links += annotations.filter((raw) => (raw as { annotationType?: number }).annotationType === LINK_ANNOTATION_TYPE).length;
        } catch {
          // A page pdf.js can't read adds nothing to the counts.
        }
      }
      if (!cancelled) {
        setDocStats({ words, characters, links });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // The selection's words and characters, for the stat bar: whatever is selected inside the document.
  useEffect(() => {
    const onSelectionChange = (): void => {
      const selection = window.getSelection();
      const scroller = scrollRef.current;
      const inDocument =
        selection !== null && !selection.isCollapsed && scroller !== null && scroller.contains(selection.anchorNode) && scroller.contains(selection.focusNode);
      const counts = inDocument ? countSelection(selection.toString()) : null;
      setSelectionStats(counts && counts.characters > 0 ? { words: counts.words, characters: counts.characters } : null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // Report on load, and whenever zoom reflows the pages or the user scrolls.
  useLayoutEffect(() => {
    reportVisiblePage();
  }, [reportVisiblePage, zoomPercent]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    let frame = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reportVisiblePage);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [reportVisiblePage]);

  // ── Jump history (Back/Forward) ──
  // Where the view was before each jump (a followed link, the page box), as a fraction of the document's height so a
  // zoom in between still lands on the same spot. Scrolling by hand isn't a jump and leaves no entry, as in a browser.
  const historyRef = useRef<{ back: number[]; forward: number[] }>({ back: [], forward: [] });

  const reportHistory = useCallback((): void => {
    window.northstarPdf.reportHistory(historyRef.current.back.length > 0, historyRef.current.forward.length > 0);
  }, []);

  /** The view's place as a fraction of the document's height. */
  const currentPlace = (): number => {
    const el = scrollRef.current;
    return el && el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0;
  };

  /** Scrolls the view for a jump, remembering where it was so Back can return there. */
  const jumpTo = useCallback(
    (top: number): void => {
      const el = scrollRef.current;
      if (!el || Math.abs(top - el.scrollTop) < 1) {
        return;
      }
      historyRef.current = { back: [...historyRef.current.back, currentPlace()], forward: [] };
      el.scrollTo({ top });
      reportHistory();
    },
    [reportHistory],
  );

  // Back or Forward: the place left is kept on the other side, so the step can be undone.
  useEffect(
    () =>
      window.northstarPdf.onHistoryGo((direction) => {
        const el = scrollRef.current;
        const { back, forward } = historyRef.current;
        const from = direction === -1 ? back : forward;
        const place = from[from.length - 1];
        if (!el || place === undefined) {
          return;
        }
        const here = currentPlace();
        historyRef.current =
          direction === -1
            ? { back: back.slice(0, -1), forward: [...forward, here] }
            : { back: [...back, here], forward: forward.slice(0, -1) };
        el.scrollTo({ top: place * el.scrollHeight });
        reportHistory();
      }),
    [reportHistory],
  );

  // A new document, or none, starts with no history.
  useEffect(() => {
    historyRef.current = { back: [], forward: [] };
    reportHistory();
  }, [doc, reportHistory]);

  /** Brings a page's top to the top of the view, as a jump Back can return from (the stat bar's page box). */
  const goToPage = useCallback(
    (page: number): void => {
      const el = scrollRef.current;
      const target = el?.querySelector<HTMLElement>(`[data-page-number="${Math.min(Math.max(page, 1), pageSizes.length)}"]`);
      if (el && target) {
        jumpTo(el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top);
      }
    },
    [pageSizes, jumpTo],
  );

  // Main asks for a page too (`goToPdfPage`).
  useEffect(() => window.northstarPdf.onScrollToPage(goToPage), [goToPage]);

  useEffect(() => window.northstarPdf.onFile((file) => void loadFile(file)), [loadFile]);

  // The toolbar's Close: back to the empty page, as before a file was opened.
  useEffect(
    () =>
      window.northstarPdf.onClose(() => {
        // The document fades away first, then the empty page takes its place.
        window.clearTimeout(closeTimerRef.current);
        setClosing(true);
        closeTimerRef.current = window.setTimeout(() => {
          setClosing(false);
          setDoc((previous) => {
            void previous?.loadingTask.destroy();
            return null;
          });
          setPageSizes([]);
          undoRef.current = [];
          redoRef.current = [];
          baselineRef.current = { strokes: EMPTY_STROKES, highlights: EMPTY_HIGHLIGHTS, crops: EMPTY_CROPS };
          setStrokes(EMPTY_STROKES);
          setComments([]);
          setTextBoxes([]);
          setHighlights(EMPTY_HIGHLIGHTS);
          setCrops(EMPTY_CROPS);
          setOpenCommentId(null);
          setDocKey(null);
          setError(null);
        }, CONTENT_FADE_MS);
      }),
    [],
  );
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);
  useEffect(() => window.northstarPdf.onTool(setTool), []);

  // Revert Annotations.
  useEffect(
    () =>
      window.northstarPdf.onClear(() => {
        setStrokes([]);
        setComments([]);
        setTextBoxes([]);
        setHighlights([]);
        setCrops([]);
        setOpenCommentId(null);
      }),
    [],
  );

  // Every edit is reported so main can persist it; an unsaved (uncommitted) comment isn't.
  useEffect(() => {
    if (docKey === null) {
      return;
    }
    window.northstarPdf.saveAnnotations(docKey, {
      strokes: strokes.map(({ id, page, points }) => ({ id, page, points: [...points] })),
      comments: comments.filter((c) => c.committed).map(({ id, page, x, y, text }) => ({ id, page, x, y, text })),
      highlights: highlights.map(({ id, page, rects }) => ({ id, page, rects: [...rects] })),
      textBoxes: textBoxes
        .filter((box) => box.text.trim() !== '')
        .map(({ id, page, x, y, text, size, align }) => ({ id, page, x, y, text, size, align })),
      crops: crops.map(({ page, x, y, w, h }) => ({ page, x, y, w, h })),
    });
  }, [docKey, strokes, comments, textBoxes, highlights, crops]);

  const activeTool: PdfTool = tool.tool;

  // Undo/redo of pen strokes, highlights and crops, as snapshots of just those marks (comments edit
  // per keystroke, so they're left out). Any change to them that didn't come from undo/redo or from
  // loading a file is a user edit and pushes the previous state onto the undo stack.
  const undoRef = useRef<MarksSnapshot[]>([]);
  const redoRef = useRef<MarksSnapshot[]>([]);
  const baselineRef = useRef<MarksSnapshot>({ strokes: [], highlights: [], crops: [] });
  const historyStartedRef = useRef(false);
  useEffect(() => {
    // The first run is just the initial empty state, not an edit.
    if (!historyStartedRef.current) {
      historyStartedRef.current = true;
      baselineRef.current = { strokes, highlights, crops };
      return;
    }
    const baseline = baselineRef.current;
    if (strokes === baseline.strokes && highlights === baseline.highlights && crops === baseline.crops) {
      return;
    }
    undoRef.current.push(baseline);
    if (undoRef.current.length > MAX_HISTORY) {
      undoRef.current.shift();
    }
    redoRef.current = [];
    baselineRef.current = { strokes, highlights, crops };
  }, [strokes, highlights, crops]);

  /** Makes `snapshot` the current marks without recording an edit. */
  const applySnapshot = useCallback((snapshot: MarksSnapshot): void => {
    baselineRef.current = snapshot;
    setStrokes(snapshot.strokes);
    setHighlights(snapshot.highlights);
    setCrops(snapshot.crops);
  }, []);

  useEffect(
    () =>
      window.northstarPdf.onUndo(() => {
        const previous = undoRef.current.pop();
        if (previous) {
          redoRef.current.push(baselineRef.current);
          applySnapshot(previous);
        }
      }),
    [applySnapshot],
  );
  useEffect(
    () =>
      window.northstarPdf.onRedo(() => {
        const next = redoRef.current.pop();
        if (next) {
          undoRef.current.push(baselineRef.current);
          applySnapshot(next);
        }
      }),
    [applySnapshot],
  );

  // Tracks Shift only while cropping; it's cleared on blur so a key released elsewhere can't stick.
  useEffect(() => {
    if (activeTool !== 'crop') {
      setShiftHeld(false);
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') {
        setShiftHeld(event.type === 'keydown');
      }
    };
    const onBlur = (): void => setShiftHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [activeTool]);

  /** Starts a crop drag on `page`; with Shift, it takes along every page whose crop matches this one's (uncropped pages match each other). */
  const startCropDrag = (page: number, shift: boolean): void => {
    const cropOf = (n: number): PageRect => crops.find((c) => c.page === n) ?? { x: 0, y: 0, w: 1, h: 1 };
    const mine = cropOf(page);
    const same = (a: PageRect): boolean =>
      Math.abs(a.x - mine.x) < 0.002 && Math.abs(a.y - mine.y) < 0.002 && Math.abs(a.w - mine.w) < 0.002 && Math.abs(a.h - mine.h) < 0.002;
    const pages = shift ? pageSizes.map((_, index) => index + 1).filter((n) => n === page || same(cropOf(n))) : [page];
    setCropDrag({ pages, rect: null });
  };

  /** Applies a finished crop to the drag's pages (or just `page` for a reset); `null` clears them. */
  const commitCrop = (page: number, next: PageRect | null): void => {
    const pages = cropDrag?.pages ?? [page];
    setCropDrag(null);
    setCrops((previous) => [
      ...previous.filter((c) => !pages.includes(c.page)),
      ...(next ? pages.map((n) => ({ ...next, page: n })) : []),
    ]);
  };

  // A comment left unsaved when the tool turns off is kept if it has text and
  // dropped if empty, as in the browser.
  const previousToolRef = useRef<PdfTool>('none');
  useEffect(() => {
    if (previousToolRef.current === 'comment' && activeTool !== 'comment') {
      setComments((previous) =>
        previous.filter((comment) => comment.committed || comment.text.trim() !== '').map((c) => ({ ...c, committed: true })),
      );
      setOpenCommentId(null);
    }
    if (previousToolRef.current === 'text' && activeTool !== 'text') {
      // Boxes read-only from here on: release the caret (which ends the edit) and drop any left empty.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('.pdf-tb')) {
        focused.blur();
      }
      setTextBoxes((previous) => previous.filter((box) => box.text.trim() !== ''));
    }
    if (activeTool !== 'highlighter') {
      setHoveredHighlightId(null);
      CSS.highlights.delete(PREVIEW_HIGHLIGHT_NAME);
    }
    previousToolRef.current = activeTool;
  }, [activeTool]);

  // Live drag preview for the highlighter: the native selection is hidden
  // (see the stylesheet) and painted through `::highlight()` instead.
  useEffect(() => {
    if (activeTool !== 'highlighter') {
      return;
    }
    const onSelectionChange = (): void => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      if (range && scrollRef.current?.contains(range.commonAncestorContainer)) {
        CSS.highlights.set(PREVIEW_HIGHLIGHT_NAME, new Highlight(range));
      } else {
        CSS.highlights.delete(PREVIEW_HIGHLIGHT_NAME);
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [activeTool]);

  // Hover + keyboard shortcuts that act on whatever is under the pointer.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const isTyping = (): boolean => {
      const el = document.activeElement;
      return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      const isDelete = event.key === 'd' || event.key === 'D' || event.key === 'Delete' || event.key === 'Backspace';
      if (activeTool === 'highlighter' && isDelete && hoveredHighlightId && !isTyping()) {
        event.preventDefault();
        setHighlights((previous) => previous.filter((h) => h.id !== hoveredHighlightId));
        setHoveredHighlightId(null);
        return;
      }
      if (activeTool !== 'comment' || isTyping()) {
        return;
      }
      const pointer = lastPointerRef.current;
      if (isDelete && pointer) {
        const dot = document.elementFromPoint(pointer.x, pointer.y)?.closest('[data-comment-dot]');
        const id = dot?.getAttribute('data-comment-dot');
        if (id) {
          event.preventDefault();
          setComments((previous) => previous.filter((c) => c.id !== id));
        }
        return;
      }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && comments.length > 0) {
        event.preventDefault();
        const focused = document.activeElement?.closest('[data-comment-id]')?.getAttribute('data-comment-id');
        const index = comments.findIndex((c) => c.id === focused);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = index === -1 ? (delta === 1 ? 0 : comments.length - 1) : (index + delta + comments.length) % comments.length;
        const target = comments[next];
        const box = target && document.querySelector<HTMLTextAreaElement>(`[data-comment-id="${CSS.escape(target.id)}"] textarea`);
        box?.focus();
        box?.scrollIntoView({ block: 'nearest' });
      }
    };
    // Clicking away from an open comment (tool off) closes its box.
    const onPointerDown = (event: PointerEvent): void => {
      if (activeTool === 'comment' || !openCommentId) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`[data-comment-id="${CSS.escape(openCommentId)}"]`)) {
        setOpenCommentId(null);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [activeTool, comments, hoveredHighlightId, openCommentId]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const el = scrollRef.current;
    if (event.button === 0 && activeTool === 'highlighter') {
      pressRef.current = { x: event.clientX, y: event.clientY };
    }
    // With a tool on, a press belongs to the tool (draw, select text, drop a comment); in Select mode it selects;
    // on a scroll bar it's the scroll bar's. Only otherwise does it pan.
    if (
      event.button !== 0 ||
      !el ||
      !doc ||
      activeTool !== 'none' ||
      pointerMode !== 'pan' ||
      isOnScrollbar(el, event.clientX, event.clientY)
    ) {
      return;
    }
    panRef.current = { x: event.clientX, y: event.clientY, wrap: null };
    // Captured, so the drag keeps going once the pointer leaves the view.
    el.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  /** The highlight under a viewport point, if any — a plain bounds check, since highlight layers don't take pointer events. */
  const highlightIdAt = (x: number, y: number): string | null => {
    const hit = Array.from(document.querySelectorAll<HTMLElement>('.pdf-hl-rect')).find((rect) => {
      const box = rect.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    });
    return hit?.getAttribute('data-highlight-id') ?? null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    if (activeTool === 'crop') {
      // Also read here: the page may not have keyboard focus, so Shift can go unseen as a key event.
      setShiftHeld(event.shiftKey);
    }
    if (activeTool === 'highlighter') {
      setHoveredHighlightId(highlightIdAt(event.clientX, event.clientY));
    }
    const pan = panRef.current;
    const el = scrollRef.current;
    if (!pan || !el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (pan.wrap) {
      // The move that lands the pointer on the opposite edge is the wrap itself, not the hand moving the page.
      const landedX = pan.wrap.x === null || Math.abs(event.clientX - pan.x) > rect.width / 2;
      const landedY = pan.wrap.y === null || Math.abs(event.clientY - pan.y) > rect.height / 2;
      if (landedX && landedY) {
        pan.x = event.clientX;
        pan.y = event.clientY;
        pan.wrap = null;
        return;
      }
      // Never arrived (the OS pointer can't be moved here): an ordinary drag, which may ask again.
      if (performance.now() - pan.wrap.requestedAt > PAN_WRAP_TIMEOUT_MS) {
        pan.wrap = null;
      }
    }
    el.scrollLeft -= event.clientX - pan.x;
    el.scrollTop -= event.clientY - pan.y;
    pan.x = event.clientX;
    pan.y = event.clientY;
    if (!pan.wrap) {
      const target = wrapTargetAt(rect, pan.x, pan.y);
      if (target) {
        pan.wrap = { ...target, requestedAt: performance.now() };
        window.northstarPdf.warpPointer(target.x ?? pan.x, target.y ?? pan.y);
      }
    }
  };

  /** Follows a link clicked in the document: a web link opens in a new tab, an internal one scrolls to its page. */
  const followLink = (link: PageLink): void => {
    if (link.url !== null) {
      window.northstarPdf.openLink(link.url);
      return;
    }
    if (!doc) {
      return;
    }
    void (async () => {
      try {
        const dest: unknown = typeof link.dest === 'string' ? await doc.getDestination(link.dest) : link.dest;
        const target: unknown = Array.isArray(dest) ? dest[0] : null;
        // A destination names its page by reference, or (in some files) by a 0-based index.
        const pageIndex =
          typeof target === 'number'
            ? target
            : target !== null && typeof target === 'object'
              ? await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])
              : null;
        const el = scrollRef.current;
        const pageEl = pageIndex === null ? null : el?.querySelector<HTMLElement>(`[data-page-number="${pageIndex + 1}"]`);
        if (el && pageEl) {
          jumpTo(el.scrollTop + pageEl.getBoundingClientRect().top - el.getBoundingClientRect().top);
        }
      } catch {
        // A destination the document doesn't actually contain: the click does nothing.
      }
    })();
  };

  /** Turns the finished text selection into highlights, split per page the rectangles fall on. */
  const commitSelectionAsHighlight = (): void => {
    const selection = window.getSelection();
    const container = scrollRef.current;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !container) {
      return;
    }
    const range = selection.getRangeAt(0);
    const raw = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    // A fully selected span reports its own box and its text's box; keep only the outer ones.
    const rects = raw.filter(
      (r, i) =>
        !raw.some(
          (other, j) =>
            j !== i &&
            other.left <= r.left + 0.5 &&
            other.right >= r.right - 0.5 &&
            other.top <= r.top + 0.5 &&
            other.bottom >= r.bottom - 0.5 &&
            (other.width > r.width + 0.5 || other.height > r.height + 0.5 || j < i),
        ),
    );
    const id = crypto.randomUUID();
    const pieces: OnPage<PageHighlight>[] = [];
    // The full-page content box, not the (possibly cropped) frame around it, since the fractions are of the whole page.
    container.querySelectorAll<HTMLElement>('[data-page-content]').forEach((pageEl) => {
      const box = pageEl.getBoundingClientRect();
      const mine: PageRect[] = rects
        .filter((r) => {
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
        })
        .map((r) => ({
          x: (r.left - box.left) / box.width,
          y: (r.top - box.top) / box.height,
          w: r.width / box.width,
          h: r.height / box.height,
        }));
      // A character can only be highlighted once: carve out whatever is
      // already covered, by earlier highlights or earlier rects of this one.
      const pageNumber = Number(pageEl.dataset['pageContent']);
      const minWidth = MIN_HIGHLIGHT_WIDTH_PX / box.width;
      const blockers: PageRect[] = highlights.filter((h) => h.page === pageNumber).flatMap((h) => h.rects);
      const accepted: PageRect[] = [];
      for (const rect of mine) {
        accepted.push(...subtractRects(rect, [...blockers, ...accepted], minWidth));
      }
      if (accepted.length > 0) {
        pieces.push({ id, page: pageNumber, rects: accepted });
      }
    });
    if (pieces.length > 0) {
      setHighlights((previous) => [...previous, ...pieces]);
    }
    // Cleared unconditionally so a stale selection can't be dragged or misread later.
    selection.removeAllRanges();
    CSS.highlights.delete(PREVIEW_HIGHLIGHT_NAME);
  };

  const endPan = (event?: ReactPointerEvent<HTMLDivElement>): void => {
    if (activeTool === 'highlighter') {
      const press = pressRef.current;
      pressRef.current = null;
      const isClick =
        !!event && !!press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < CLICK_DRAG_THRESHOLD_PX;
      const clicked = isClick ? highlightIdAt(event.clientX, event.clientY) : null;
      if (clicked) {
        // A click on an existing highlight removes it (no new selection to turn into one).
        setHighlights((previous) => previous.filter((h) => h.id !== clicked));
        setHoveredHighlightId(null);
        window.getSelection()?.removeAllRanges();
      } else {
        commitSelectionAsHighlight();
      }
    }
    panRef.current = null;
    setIsPanning(false);
  };

  const scale = zoomPercent / 100;
  const renderScale = renderPercent / 100;

  const toolCursor =
    activeTool === 'pen'
      ? penCursor()
      : activeTool === 'highlighter'
        ? highlighterCursor()
        : activeTool === 'comment'
          ? commentCursor(tool.color)
          : activeTool === 'text'
            ? textCursor(tool.color)
            : undefined;
  const { r, g, b } = tool.color;

  return (
    <div className="pdf-viewer">
      <style>{`::highlight(${PREVIEW_HIGHLIGHT_NAME}) { background-color: rgba(${r}, ${g}, ${b}, ${PREVIEW_ALPHA}); }`}</style>
      <div
        ref={scrollRef}
        className={`pdf-viewer__scroll load-blur${loadBlur.blurred ? ' load-blur--on' : ''}${closing ? ' content-fading' : ''}${doc && pointerMode === 'pan' ? ' pdf-viewer__scroll--pannable' : ''}${isPanning ? ' pdf-viewer__scroll--panning' : ''}`}
        data-tool={activeTool}
        data-pointer-mode={pointerMode}
        style={toolCursor ? ({ '--pdf-tool-cursor': toolCursor } as CSSProperties) : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={() => endPan()}
      >
        {doc ? (
          <div className="pdf-viewer__pages">
            {pageSizes.map((size, index) => {
              const page = index + 1;
              return (
                <PdfPage
                  key={`${docVersion}-${index}`}
                  doc={doc}
                  pageNumber={page}
                  width={size.width}
                  height={size.height}
                  scale={scale}
                  renderScale={renderScale}
                  rootRef={scrollRef}
                  highlights={highlights.filter((h) => h.page === page)}
                  hoveredHighlightId={hoveredHighlightId}
                  highlightColor={tool.color}
                  cropEditing={activeTool === 'crop'}
                  crop={crops.find((c) => c.page === page) ?? null}
                  cropDraft={cropDrag?.pages.includes(page) ? cropDrag.rect : null}
                  cropMulti={shiftHeld}
                  onCropDragStart={(shift) => startCropDrag(page, shift)}
                  onCropDrag={(rect) => setCropDrag((previous) => (previous ? { ...previous, rect } : previous))}
                  onCropCommit={(next) => commitCrop(page, next)}
                  onFollowLink={followLink}
                  annotations={{
                    tool: activeTool,
                    color: tool.color,
                    strokes: strokes.filter((stroke) => stroke.page === page),
                    comments: comments.filter((comment) => comment.page === page),
                    textBoxes: textBoxes.filter((box) => box.page === page),
                    scale,
                    openCommentId,
                    onAddStroke: (points: readonly PagePoint[]) =>
                      setStrokes((previous) => [...previous, { id: crypto.randomUUID(), page, points }]),
                    onRemoveStroke: (id: string) => setStrokes((previous) => previous.filter((s) => s.id !== id)),
                    onAddComment: (point: PagePoint) => {
                      const id = crypto.randomUUID();
                      setComments((previous) => [
                        ...previous,
                        { id, page, x: point.x, y: point.y, text: '', committed: false },
                      ]);
                      return id;
                    },
                    onChangeComment: (id: string, text: string) =>
                      setComments((previous) => previous.map((c) => (c.id === id ? { ...c, text } : c))),
                    onCommitComment: (id: string) =>
                      setComments((previous) =>
                        previous.flatMap((c) =>
                          c.id !== id ? [c] : c.text.trim() === '' ? [] : [{ ...c, committed: true }],
                        ),
                      ),
                    onRemoveComment: (id: string) => {
                      setComments((previous) => previous.filter((c) => c.id !== id));
                      setOpenCommentId((current) => (current === id ? null : current));
                    },
                    onToggleComment: (id: string) => setOpenCommentId((current) => (current === id ? null : id)),
                    onAddTextBox: (point: PagePoint) => {
                      const id = crypto.randomUUID();
                      setTextBoxes((previous) => [
                        ...previous,
                        { id, page, x: point.x, y: point.y, text: '', size: TEXT_BOX_FONT_SIZE_DEFAULT, align: 'left' },
                      ]);
                      return id;
                    },
                    onChangeTextBox: (id: string, patch: PdfTextBoxPatch) =>
                      setTextBoxes((previous) => previous.map((b) => (b.id === id ? { ...b, ...patch } : b))),
                    onEndTextBox: (id: string) =>
                      setTextBoxes((previous) => previous.filter((b) => b.id !== id || b.text.trim() !== '')),
                    onRemoveTextBox: (id: string) => setTextBoxes((previous) => previous.filter((b) => b.id !== id)),
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="pdf-viewer__empty">
            <FluidBackground />
            {error && <p className="pdf-viewer__error">{error}</p>}
          </div>
        )}
      </div>
      {doc && error && <p className="pdf-viewer__error pdf-viewer__error--floating">{error}</p>}
      {doc && !focusMode && (
        <PdfStatusBar
          page={visiblePage}
          pageCount={pageSizes.length}
          stats={docStats}
          bytes={fileBytes}
          selection={selectionStats}
          onGoToPage={goToPage}
        />
      )}
    </div>
  );
}
