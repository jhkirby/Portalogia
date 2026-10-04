// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

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
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import { commentCursor, highlighterCursor, penCursor } from '../../lib/toolCursors';
import { PdfPage, type PageHighlight, type PageRect } from './PdfPage';
import type { PagePoint, PdfComment, PdfStroke } from './PdfAnnotationLayer';

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
 * The whole of `pdf.html`'s page: just the document in a scroll area. The
 * controls (Open PDF, file name, page counter, Export) live in the chrome's main
 * toolbar (`PdfToolbar`); main pushes opened files here.
 *
 * The pointer works like Okular's Browse tool: press and drag anywhere on
 * the document to pan it (hand cursor), rather than selecting.
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
  const [zoomPercent, setZoomPercent] = useState(ZOOM_PERCENT_DEFAULT);
  const [renderPercent, setRenderPercent] = useState(ZOOM_PERCENT_DEFAULT);
  const [isPanning, setIsPanning] = useState(false);

  const [, setSchemeTick] = useState(0);
  // The tool cursors are drawn in light or dark ink to match the theme.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setSchemeTick((tick) => tick + 1);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** Where the current highlighter press began, to tell a click on a highlight from a drag. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  /** Present while the page is grabbed. `x`/`y` are the stand-in hand's position in the view, which wraps at its edges. */
  const panRef = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  const grabHandRef = useRef<HTMLDivElement>(null);
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
    setError(null);
    try {
      const loaded = await getDocument({ data: file.data }).promise;
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
      setHighlights(file.annotations.highlights);
      setCrops(file.annotations.crops);
      setOpenCommentId(null);
      setDocKey(file.key);
      scrollRef.current?.scrollTo({ left: 0, top: 0 });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open that PDF.');
    }
  }, []);

  /** The page under the middle of the view (the last page if the view is past the end). */
  const reportVisiblePage = useCallback((): void => {
    const el = scrollRef.current;
    if (!el || pageSizes.length === 0) {
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
    window.northstarPdf.reportPage(current, pageSizes.length);
  }, [pageSizes]);

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

  // The toolbar's page box asks for a jump: bring that page's top to the top of the view.
  useEffect(
    () =>
      window.northstarPdf.onScrollToPage((page) => {
        const el = scrollRef.current;
        const target = el?.querySelector<HTMLElement>(`[data-page-number="${Math.min(Math.max(page, 1), pageSizes.length)}"]`);
        if (el && target) {
          el.scrollTo({ top: el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top });
        }
      }),
    [pageSizes],
  );

  useEffect(() => window.northstarPdf.onFile((file) => void loadFile(file)), [loadFile]);

  // The toolbar's Close: back to the empty page, as before a file was opened.
  useEffect(
    () =>
      window.northstarPdf.onClose(() => {
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
        setHighlights(EMPTY_HIGHLIGHTS);
        setCrops(EMPTY_CROPS);
        setOpenCommentId(null);
        setDocKey(null);
        setError(null);
      }),
    [],
  );
  useEffect(() => window.northstarPdf.onTool(setTool), []);

  // Revert Annotations.
  useEffect(
    () =>
      window.northstarPdf.onClear(() => {
        setStrokes([]);
        setComments([]);
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
      crops: crops.map(({ page, x, y, w, h }) => ({ page, x, y, w, h })),
    });
  }, [docKey, strokes, comments, highlights, crops]);

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
    // With a tool on, a press belongs to the tool (draw, select text, drop a comment), not to panning.
    if (event.button !== 0 || !el || !doc || activeTool !== 'none') {
      return;
    }
    const pointerId = event.pointerId;
    panRef.current = { x: event.clientX, y: event.clientY, locked: false };
    setIsPanning(true);
    // Like Okular's grab tool, the drag never runs out of room: with the
    // pointer locked, movement is unbounded, and a stand-in hand wraps from
    // one edge of the view to the opposite one. If the lock is refused, fall
    // back to an ordinary capped drag.
    void el
      .requestPointerLock()
      .then(() => {
        if (panRef.current) {
          panRef.current.locked = true;
          moveGrabHand();
        }
      })
      .catch(() => {
        if (panRef.current) {
          el.setPointerCapture(pointerId);
        }
      });
  };

  /** Puts the stand-in hand where the wrapped pointer is. */
  const moveGrabHand = (): void => {
    const pan = panRef.current;
    const hand = grabHandRef.current;
    if (!hand) {
      return;
    }
    hand.style.display = pan?.locked ? 'block' : 'none';
    if (pan) {
      hand.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    }
  };

  // Esc (or anything else that releases the lock) ends the grab.
  useEffect(() => {
    const onLockChange = (): void => {
      if (!document.pointerLockElement && panRef.current?.locked) {
        panRef.current = null;
        setIsPanning(false);
        moveGrabHand();
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);
    return () => document.removeEventListener('pointerlockchange', onLockChange);
  }, []);

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
    el.scrollLeft -= event.movementX;
    el.scrollTop -= event.movementY;
    if (pan.locked) {
      // The real pointer is pinned in place, so track the stand-in hand by hand and wrap it at the view's edges.
      const rect = el.getBoundingClientRect();
      const wrap = (value: number, start: number, size: number): number => start + ((((value - start) % size) + size) % size);
      pan.x = wrap(pan.x + event.movementX, rect.left, rect.width);
      pan.y = wrap(pan.y + event.movementY, rect.top, rect.height);
      moveGrabHand();
    } else {
      pan.x = event.clientX;
      pan.y = event.clientY;
    }
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
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    moveGrabHand();
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
          : undefined;
  const { r, g, b } = tool.color;

  return (
    <div className="pdf-viewer">
      <style>{`::highlight(${PREVIEW_HIGHLIGHT_NAME}) { background-color: rgba(${r}, ${g}, ${b}, ${PREVIEW_ALPHA}); }`}</style>
      <div
        ref={scrollRef}
        className={`pdf-viewer__scroll${doc ? ' pdf-viewer__scroll--pannable' : ''}${isPanning ? ' pdf-viewer__scroll--panning' : ''}`}
        data-tool={activeTool}
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
                  annotations={{
                    tool: activeTool,
                    color: tool.color,
                    strokes: strokes.filter((stroke) => stroke.page === page),
                    comments: comments.filter((comment) => comment.page === page),
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
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="pdf-viewer__empty">{error && <p className="pdf-viewer__error">{error}</p>}</div>
        )}
      </div>
      <div ref={grabHandRef} className="pdf-viewer__grab-hand" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path
            d="M7 11V8.5a1.5 1.5 0 0 1 3 0V10m0-1.5v-2a1.5 1.5 0 0 1 3 0V10m0-3a1.5 1.5 0 0 1 3 0v3m0-1.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4.5 15.5a1.5 1.5 0 0 1 2.3-1.9L7 14"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {doc && error && <p className="pdf-viewer__error pdf-viewer__error--floating">{error}</p>}
    </div>
  );
}
