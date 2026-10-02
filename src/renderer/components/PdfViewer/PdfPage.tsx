// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/** PDF pages are sized in points (1/72 in); the layout `width`/`height` props are already in CSS pixels, so the rasterization scale needs this factor too. */
const CSS_PIXELS_PER_POINT = 96 / 72;

interface PdfPageProps {
  readonly doc: PDFDocumentProxy;
  readonly pageNumber: number;
  /** The page's size in CSS pixels at scale 1. */
  readonly width: number;
  readonly height: number;
  /** Live scale: drives the box size, so zooming resizes instantly. */
  readonly scale: number;
  /** Debounced scale: what the canvas is actually rasterized at, so a burst of zoom ticks renders once. */
  readonly renderScale: number;
  /** The scroll container, used as the visibility root so pages render only when near the viewport. */
  readonly rootRef: RefObject<HTMLDivElement | null>;
}

/**
 * One page of the document. Reserves its final size up front (so the
 * scrollbar and scroll position are right before anything is drawn) and
 * rasterizes its canvas only while within about a screen of the viewport.
 * The canvas is CSS-stretched to the live scale in the meantime, so zooming
 * feels immediate and sharpens once `renderScale` catches up.
 */
export function PdfPage({ doc, pageNumber, width, height, scale, renderScale, rootRef }: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    const root = rootRef.current;
    if (!element || !root) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setIsNear(entry?.isIntersecting ?? false), {
      root,
      rootMargin: '100% 0px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isNear || !canvas) {
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;

    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) {
        return;
      }
      const viewport = page.getViewport({ scale: renderScale * CSS_PIXELS_PER_POINT * (window.devicePixelRatio || 1) });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      try {
        await task.promise;
      } catch {
        // A cancelled render (scrolled away or re-zoomed) rejects; nothing to do.
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, renderScale, isNear]);

  // Pages scrolled far away free their bitmap, so a long document doesn't
  // hold every page's pixels at once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isNear && canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [isNear]);

  return (
    <div
      ref={containerRef}
      className="pdf-viewer__page"
      style={{ width: width * scale, height: height * scale }}
      data-page-number={pageNumber}
    >
      <canvas ref={canvasRef} className="pdf-viewer__canvas" style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
