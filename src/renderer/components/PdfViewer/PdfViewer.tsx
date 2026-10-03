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
import type { PdfMode } from '@shared/tab-state';
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

interface PageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The whole of `pdf.html`'s page: just the document in a scroll area. The
 * controls (Open PDF, file name, View/Edit) live in the chrome's main
 * toolbar (`PdfToolbar`); main pushes opened files and mode changes here.
 *
 * The pointer works like Okular's Browse tool in both modes: press and drag
 * anywhere on the document to pan it (hand cursor), rather than selecting.
 * Edit mode has no tools behind it yet — those come later and will hang off `mode`.
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
  const [mode, setMode] = useState<PdfMode>('view');
  const [tool, setTool] = useState<PdfToolState>({ tool: 'none', color: { r: 26, g: 115, b: 232 } });
  // Held in memory only: marks aren't written into the PDF, and are dropped when another file is opened.
  const [strokes, setStrokes] = useState<readonly OnPage<PdfStroke>[]>([]);
  const [comments, setComments] = useState<readonly OnPage<PdfComment>[]>([]);
  /** One entry per page a highlight touches; entries of one highlight share an id. */
  const [highlights, setHighlights] = useState<readonly OnPage<PageHighlight>[]>([]);
  const [hoveredHighlightId, setHoveredHighlightId] = useState<string | null>(null);
  /** The comment whose box is open while the comment tool is off. */
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
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
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
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
      setStrokes([]);
      setComments([]);
      setHighlights([]);
      setOpenCommentId(null);
      scrollRef.current?.scrollTo({ left: 0, top: 0 });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open that PDF.');
    }
  }, []);

  useEffect(() => window.northstarPdf.onFile((file) => void loadFile(file)), [loadFile]);
  useEffect(() => window.northstarPdf.onMode(setMode), []);
  useEffect(() => window.northstarPdf.onTool(setTool), []);

  const activeTool: PdfTool = tool.tool;

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
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
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
    if (activeTool === 'highlighter') {
      setHoveredHighlightId(highlightIdAt(event.clientX, event.clientY));
    }
    const pan = panRef.current;
    const el = scrollRef.current;
    if (!pan || !el) {
      return;
    }
    el.scrollLeft = pan.left - (event.clientX - pan.x);
    el.scrollTop = pan.top - (event.clientY - pan.y);
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
    container.querySelectorAll<HTMLElement>('[data-page-number]').forEach((pageEl) => {
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
      const pageNumber = Number(pageEl.dataset['pageNumber']);
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
          : undefined;
  const { r, g, b } = tool.color;

  return (
    <div className="pdf-viewer">
      <style>{`::highlight(${PREVIEW_HIGHLIGHT_NAME}) { background-color: rgba(${r}, ${g}, ${b}, ${PREVIEW_ALPHA}); }`}</style>
      <div
        ref={scrollRef}
        className={`pdf-viewer__scroll${doc ? ' pdf-viewer__scroll--pannable' : ''}${isPanning ? ' pdf-viewer__scroll--panning' : ''}`}
        data-mode={mode}
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
      {doc && error && <p className="pdf-viewer__error pdf-viewer__error--floating">{error}</p>}
    </div>
  );
}
