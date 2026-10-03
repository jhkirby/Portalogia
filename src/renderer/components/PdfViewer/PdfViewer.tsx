// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ZOOM_PERCENT_DEFAULT } from '@shared/constants';
import { PdfPage } from './PdfPage';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** PDF page sizes are in points (1/72 in); CSS pixels are 1/96 in. Scale 1 here means "actual size". */
const CSS_PIXELS_PER_POINT = 96 / 72;

/** How long zoom must sit still before pages re-rasterize at the new scale. */
const RENDER_SCALE_DEBOUNCE_MS = 150;

type ViewerMode = 'view' | 'edit';

interface PageSize {
  readonly width: number;
  readonly height: number;
}

interface PdfViewerProps {
  /** This tab's id (from the page URL), needed to ask main to open a file. */
  readonly tabId: string;
}

/**
 * The whole of `pdf.html`'s page: a small toolbar (open file, View/Edit
 * toggle), and the document itself in a scroll area.
 *
 * The pointer works like Okular's Browse tool in both modes: press and drag
 * anywhere on the document to pan it (hand cursor), rather than selecting.
 * Edit mode is a separate mode flag for now, with no tools behind it yet —
 * those come later and will hang off `mode`.
 *
 * Zoom is owned by main (the app toolbar, menu shortcuts and Ctrl+wheel all
 * go through `TabManager`) and arrives via `onZoom`; this page only applies
 * it. While zoom changes the view stays centered on the same point of the
 * document.
 */
export function PdfViewer({ tabId }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<readonly PageSize[]>([]);
  const [mode, setMode] = useState<ViewerMode>('view');
  const [error, setError] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(ZOOM_PERCENT_DEFAULT);
  const [renderPercent, setRenderPercent] = useState(ZOOM_PERCENT_DEFAULT);
  const [isPanning, setIsPanning] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
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

  const handleOpen = useCallback(async () => {
    setError(null);
    try {
      const file = await window.northstarPdf.openFile(tabId);
      if (!file) {
        return;
      }
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
      setFileName(file.name);
      scrollRef.current?.scrollTo({ left: 0, top: 0 });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open that PDF.');
    }
  }, [tabId]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const el = scrollRef.current;
    if (event.button !== 0 || !el || !doc) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    setIsPanning(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    const el = scrollRef.current;
    if (!pan || !el) {
      return;
    }
    el.scrollLeft = pan.left - (event.clientX - pan.x);
    el.scrollTop = pan.top - (event.clientY - pan.y);
  };

  const endPan = (): void => {
    panRef.current = null;
    setIsPanning(false);
  };

  const scale = zoomPercent / 100;
  const renderScale = renderPercent / 100;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__toolbar">
        <button type="button" className="pdf-viewer__button" onClick={() => void handleOpen()}>
          Open PDF…
        </button>
        <span className="pdf-viewer__file-name">{fileName ?? 'No file open'}</span>
        <div className="pdf-viewer__modes" role="group" aria-label="Mode">
          {(['view', 'edit'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="pdf-viewer__mode"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === 'view' ? 'View' : 'Edit'}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`pdf-viewer__scroll${doc ? ' pdf-viewer__scroll--pannable' : ''}${isPanning ? ' pdf-viewer__scroll--panning' : ''}`}
        data-mode={mode}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {doc ? (
          <div className="pdf-viewer__pages">
            {pageSizes.map((size, index) => (
              <PdfPage
                key={`${fileName}-${index}`}
                doc={doc}
                pageNumber={index + 1}
                width={size.width}
                height={size.height}
                scale={scale}
                renderScale={renderScale}
                rootRef={scrollRef}
              />
            ))}
          </div>
        ) : (
          <div className="pdf-viewer__empty">
            <button type="button" className="pdf-viewer__button pdf-viewer__button--large" onClick={() => void handleOpen()}>
              Open a PDF
            </button>
            {error && <p className="pdf-viewer__error">{error}</p>}
          </div>
        )}
      </div>
      {doc && error && <p className="pdf-viewer__error pdf-viewer__error--floating">{error}</p>}
    </div>
  );
}
