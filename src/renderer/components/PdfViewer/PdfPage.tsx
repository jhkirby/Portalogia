// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-02

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RGB } from "../../lib/color";
import {
  PdfAnnotationLayer,
  type PdfAnnotationLayerProps,
} from "./PdfAnnotationLayer";
import { PdfCropLayer } from "./PdfCropLayer";

/** PDF pages are sized in points (1/72 in); the layout `width`/`height` props are already in CSS pixels, so the rasterization scale needs this factor too. */
const CSS_PIXELS_PER_POINT = 96 / 72;

/** A finished highlight's background alpha — the same as the browser tabs' `<mark>`. */
const HIGHLIGHT_ALPHA = 0.55;

/** A rectangle on a page as fractions (0–1) of its width/height. */
export interface PageRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One highlight's rectangles on this page (a selection spanning pages is one highlight, id shared, with a piece per page). */
export interface PageHighlight {
  readonly id: string;
  readonly rects: readonly PageRect[];
}

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
  readonly highlights: readonly PageHighlight[];
  /** The highlight under the pointer while the highlighter is on, drawn lighter as a cue that D/Delete removes it. */
  readonly hoveredHighlightId: string | null;
  readonly highlightColor: RGB;
  /** Props for this page's pen/comment overlay. */
  readonly annotations: PdfAnnotationLayerProps;
  /** Whether the crop tool is on, so this page's crop box can be edited. */
  readonly cropEditing: boolean;
  /** This page's crop, or `null` for the whole page. */
  readonly crop: PageRect | null;
  /** The in-progress crop drag's box for this page, when it's being cropped (alone or along with others). */
  readonly cropDraft: PageRect | null;
  /** Shift is held in crop mode (multi-crop). */
  readonly cropMulti: boolean;
  readonly onCropDragStart: (shift: boolean) => void;
  readonly onCropDrag: (rect: PageRect) => void;
  readonly onCropCommit: (crop: PageRect | null) => void;
}

/**
 * One page of the document. Reserves its final size up front (so the
 * scrollbar and scroll position are right before anything is drawn) and
 * rasterizes its canvas only while within about a screen of the viewport.
 * The canvas is CSS-stretched to the live scale in the meantime, so zooming
 * feels immediate and sharpens once `renderScale` catches up.
 *
 * Layers, bottom to top: the canvas; highlights; pdf.js's invisible text
 * layer (what makes text selectable); pen/comment marks; the crop box.
 */
export function PdfPage({
  doc,
  pageNumber,
  width,
  height,
  scale,
  renderScale,
  rootRef,
  highlights,
  hoveredHighlightId,
  highlightColor,
  annotations,
  cropEditing,
  crop,
  cropDraft,
  cropMulti,
  onCropDragStart,
  onCropDrag,
  onCropCommit,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    const root = rootRef.current;
    if (!element || !root) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsNear(entry?.isIntersecting ?? false),
      {
        root,
        rootMargin: "100% 0px",
      },
    );
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
      const viewport = page.getViewport({
        scale:
          renderScale * CSS_PIXELS_PER_POINT * (window.devicePixelRatio || 1),
      });
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

  // The text layer is laid out once per page, not per zoom: pdf.js positions
  // spans in percentages and sizes them from `--total-scale-factor`, which
  // the container sets from the live scale below.
  useEffect(() => {
    const container = textLayerRef.current;
    if (!isNear || !container) {
      return;
    }
    let cancelled = false;
    let layer: TextLayer | null = null;

    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) {
        return;
      }
      layer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport: page.getViewport({ scale: CSS_PIXELS_PER_POINT }),
      });
      try {
        await layer.render();
      } catch {
        // Cancelled by scrolling away; nothing to do.
      }
    })();

    return () => {
      cancelled = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [doc, pageNumber, isNear]);

  // Pages scrolled far away free their bitmap, so a long document doesn't
  // hold every page's pixels at once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isNear && canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [isNear]);

  const scaleFactor = scale * CSS_PIXELS_PER_POINT;
  const textLayerStyle = {
    "--scale-factor": scaleFactor,
    "--user-unit": 1,
    "--total-scale-factor": scaleFactor,
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  } as CSSProperties;
  const fill = `rgba(${highlightColor.r}, ${highlightColor.g}, ${highlightColor.b}, ${HIGHLIGHT_ALPHA})`;

  // Off the crop tool, a cropped page shows only its crop — as the export will. The
  // full page is still laid out (so every layer keeps its page-relative coordinates)
  // and is just shifted behind the clipping frame.
  const shown = !cropEditing && crop ? crop : { x: 0, y: 0, w: 1, h: 1 };
  const fullWidth = width * scale;
  const fullHeight = height * scale;

  return (
    <div
      ref={containerRef}
      className="pdf-viewer__page"
      style={{ width: fullWidth * shown.w, height: fullHeight * shown.h }}
      data-page-number={pageNumber}
    >
      <div
        className="pdf-viewer__page-content"
        style={{
          width: fullWidth,
          height: fullHeight,
          left: -shown.x * fullWidth,
          top: -shown.y * fullHeight,
        }}
        data-page-content={pageNumber}
      >
        <canvas
          ref={canvasRef}
          className="pdf-viewer__canvas"
          style={{ width: "100%", height: "100%" }}
        />
        <div className="pdf-hl-layer">
          {highlights.flatMap((highlight) =>
            highlight.rects.map((rect, index) => (
              <div
                key={`${highlight.id}-${index}`}
                className={`pdf-hl-rect${highlight.id === hoveredHighlightId ? " pdf-hl-rect--hovered" : ""}`}
                data-highlight-id={highlight.id}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  backgroundColor: fill,
                }}
              />
            )),
          )}
        </div>
        <div ref={textLayerRef} className="textLayer" style={textLayerStyle} />
        <PdfAnnotationLayer {...annotations} />
        <PdfCropLayer
          editing={cropEditing}
          crop={crop}
          draft={cropDraft}
          multi={cropMulti}
          onDragStart={onCropDragStart}
          onDrag={onCropDrag}
          onCommit={onCropCommit}
        />
      </div>
    </div>
  );
}
