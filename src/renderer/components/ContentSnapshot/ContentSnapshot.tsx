// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { useEffect, useRef } from 'react';
import type { ContentSnapshotPiece } from '@shared/ipc-contract';
import '../../styles/components/content-snapshot.css';

/** The width, in CSS pixels, of a pane's right edge kept whole as it widens or narrows: its border and scrollbar. */
const EDGE_WIDTH_PX = 24;

/**
 * A canvas holding a strip of a pane's picture, cut from its pixels.
 * @param image The whole picture.
 * @param fromX The strip's first column, in the picture's pixels.
 * @param columns How many columns it takes.
 * @param className What lays it out (content-snapshot.css).
 */
function strip(image: ImageData, fromX: number, columns: number, className: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.width = columns;
  canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image, -fromX, 0, fromX, 0, columns, image.height);
  return canvas;
}

/**
 * One pane's picture, cut into a body, a seam and an edge (see
 * content-snapshot.css) so that it follows its pane's width without
 * stretching what's on it.
 * @param piece The pane's picture, from main.
 * @param radius Its corner radius, in CSS pixels.
 */
function buildPiece(piece: ContentSnapshotPiece, radius: number): HTMLElement {
  // Main's bitmap is BGRA; ImageData wants RGBA. A pixel at a time (red and blue swapped), on a copy that's sure to be
  // aligned for it: the slide waits on this.
  const pixels = new Uint32Array(piece.bitmap.slice().buffer, 0, piece.pixelWidth * piece.pixelHeight);
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i] ?? 0;
    pixels[i] = (pixel & 0xff00ff00) | ((pixel >>> 16) & 0xff) | ((pixel & 0xff) << 16);
  }
  const rgba = new Uint8ClampedArray(pixels.buffer, 0, pixels.length * 4);
  const image = new ImageData(rgba, piece.pixelWidth, piece.pixelHeight);
  const scale = piece.pixelWidth / piece.width;
  const edgeCss = Math.min(EDGE_WIDTH_PX, Math.floor(piece.width / 4));
  const edgePx = Math.min(piece.pixelWidth - 1, Math.round(edgeCss * scale));
  const bodyPx = piece.pixelWidth - edgePx;
  const bodyCss = bodyPx / scale;

  const edgeWidthCss = edgePx / scale;
  const body = strip(image, 0, bodyPx, 'content-snapshot__body');
  body.style.width = `${bodyCss}px`;
  // The body ends where the edge begins. As the pane narrows, the body (which keeps its width) would otherwise run on
  // under the edge, and show through the edge's see-through margin as a dark strip past the frame's border.
  const bodyClip = document.createElement('div');
  bodyClip.className = 'content-snapshot__body-clip';
  bodyClip.style.right = `${edgeWidthCss}px`;
  bodyClip.append(body);
  const seam = strip(image, bodyPx - 1, 1, 'content-snapshot__seam');
  seam.style.left = `${bodyCss}px`;
  seam.style.width = `max(0px, calc(100% - ${piece.width}px))`;
  const edge = strip(image, bodyPx, edgePx, 'content-snapshot__edge');
  edge.style.width = `${edgeWidthCss}px`;

  const box = document.createElement('div');
  box.className = 'content-snapshot__piece';
  box.style.left = `${piece.x * 100}%`;
  box.style.top = `${piece.y * 100}%`;
  box.style.width = `${piece.fractionWidth * 100}%`;
  box.style.height = `${piece.fractionHeight * 100}%`;
  box.style.borderRadius = `${radius}px`;
  box.append(bodyClip, seam, edge);
  return box;
}

/**
 * The picture of the tab's pages that stands in for them while the sidebar
 * slides (main's `ContentSnapshot`, `TabManager.slideSidebar`). Pinned by
 * insets to the tab area, so it moves and resizes with it in the same
 * frames as the sidebar's own transition. Built straight into the DOM, not
 * through React state: it has to be up as fast as possible, and nothing
 * about it ever re-renders.
 */
export function ContentSnapshot() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let currentId = 0;
    return window.portalogia.onContentSnapshot((message) => {
      if (message.kind === 'clear') {
        // Only the one it names: a newer snapshot may already be up.
        if (message.id === currentId) {
          container.hidden = true;
          container.replaceChildren();
        }
        return;
      }
      currentId = message.id;
      const { insets } = message;
      container.style.left = `${insets.left}px`;
      container.style.top = `${insets.top}px`;
      container.style.right = `${insets.right}px`;
      container.style.bottom = `${insets.bottom}px`;
      container.replaceChildren(...message.pieces.map((piece) => buildPiece(piece, message.radius)));
      container.hidden = false;
      // Just after the frame that paints it (a task queued from its animation frame runs once it's drawn).
      requestAnimationFrame(() =>
        setTimeout(() => {
          if (currentId === message.id) {
            window.portalogia.reportContentSnapshotShown(message.id);
          }
        }, 0),
      );
    });
  }, []);
  return <div ref={containerRef} className="content-snapshot" aria-hidden="true" hidden />;
}
