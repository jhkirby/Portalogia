// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { PageRect } from './PdfPage';

/** The smallest a crop box may get, as a fraction of the page, so it can't be dragged to nothing. */
const MIN_FRACTION = 0.05;

/** A crop within this of the whole page counts as "no crop" and is dropped. */
const FULL_PAGE_EPSILON = 0.002;

const FULL_PAGE: PageRect = { x: 0, y: 0, w: 1, h: 1 };

/** The eight grab points: which of the box's edges each one moves. */
const HANDLES = [
  { id: 'nw', left: true, top: true },
  { id: 'n', top: true },
  { id: 'ne', right: true, top: true },
  { id: 'e', right: true },
  { id: 'se', right: true, bottom: true },
  { id: 's', bottom: true },
  { id: 'sw', left: true, bottom: true },
  { id: 'w', left: true },
] as const;

type Handle = (typeof HANDLES)[number];

interface DragState {
  readonly handle: Handle;
  readonly startX: number;
  readonly startY: number;
  readonly origin: PageRect;
}

export interface PdfCropLayerProps {
  /** Whether the crop tool is on: shows the dotted box and handles and takes pointer events. */
  readonly editing: boolean;
  /** This page's saved crop, or `null` for the whole page. */
  readonly crop: PageRect | null;
  /** The in-progress drag's box, shown instead of `crop` (the viewer shares one across every page being cropped together). */
  readonly draft: PageRect | null;
  /** Shift is held: the corners change shape to show that a drag will crop every page in the same state. */
  readonly multi: boolean;
  /** A handle was pressed; `shift` is whether Shift was down, which decides whether the drag spreads to matching pages. */
  readonly onDragStart: (shift: boolean) => void;
  /** The drag's current box. */
  readonly onDrag: (rect: PageRect) => void;
  /** Commits a finished drag (or a reset); `null` clears the crop. */
  readonly onCommit: (crop: PageRect | null) => void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Moves the dragged edges of `origin` by (dx, dy) page fractions, keeping the box on the page and at least `MIN_FRACTION` in each direction. */
function resize(origin: PageRect, handle: Handle, dx: number, dy: number): PageRect {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.w;
  let bottom = origin.y + origin.h;
  if ('left' in handle) {
    left = clamp(left + dx, 0, right - MIN_FRACTION);
  }
  if ('right' in handle) {
    right = clamp(right + dx, left + MIN_FRACTION, 1);
  }
  if ('top' in handle) {
    top = clamp(top + dy, 0, bottom - MIN_FRACTION);
  }
  if ('bottom' in handle) {
    bottom = clamp(bottom + dy, top + MIN_FRACTION, 1);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * One page's crop box, drawn only while the crop tool is on: the part outside
 * the crop is dimmed, and the box gets a dotted outline and eight handles
 * (four corners, four sides) to drag. With the tool off, `PdfPage` shows the
 * page cropped instead. Either way the PDF file itself is never changed.
 *
 * The drag is reported up as it moves (so pages cropped together can preview
 * it) and committed on release, so the saved marks (and the IPC that persists
 * them) update once per edit rather than per pixel.
 */
export function PdfCropLayer({ editing, crop, draft, multi, onDragStart, onDrag, onCommit }: PdfCropLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const box = draft ?? crop ?? FULL_PAGE;
  const isCropped = draft !== null || crop !== null;

  // Off the tool the page is simply shown cropped (see `PdfPage`); nothing to draw here.
  if (!editing) {
    return null;
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, handle: Handle): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { handle, startX: event.clientX, startY: event.clientY, origin: box };
    onDragStart(event.shiftKey);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const size = layerRef.current?.getBoundingClientRect();
    if (!drag || !size || size.width === 0 || size.height === 0) {
      return;
    }
    onDrag(
      resize(drag.origin, drag.handle, (event.clientX - drag.startX) / size.width, (event.clientY - drag.startY) / size.height),
    );
  };

  const finishDrag = (): void => {
    const finished = draft;
    dragRef.current = null;
    if (!finished) {
      // Pressed and released without moving: end the drag without changing anything.
      onCommit(crop);
      return;
    }
    const isWholePage =
      finished.x < FULL_PAGE_EPSILON &&
      finished.y < FULL_PAGE_EPSILON &&
      finished.w > 1 - FULL_PAGE_EPSILON * 2 &&
      finished.h > 1 - FULL_PAGE_EPSILON * 2;
    onCommit(isWholePage ? null : finished);
  };

  return (
    <div ref={layerRef} className={`pdf-crop${editing ? ' pdf-crop--editing' : ''}${multi ? ' pdf-crop--multi' : ''}`}>
      <div
        className={`pdf-crop__box${isCropped ? ' pdf-crop__box--cropped' : ''}`}
        style={{
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.w * 100}%`,
          height: `${box.h * 100}%`,
        }}
      >
        {HANDLES.map((handle) => (
          <div
            key={handle.id}
            className={`pdf-crop__handle pdf-crop__handle--${handle.id}`}
            onPointerDown={(event) => handlePointerDown(event, handle)}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          />
        ))}
      </div>
      {crop !== null && draft === null && (
        <button type="button" className="pdf-crop__reset" onClick={() => onCommit(null)}>
          Reset crop
        </button>
      )}
    </div>
  );
}
