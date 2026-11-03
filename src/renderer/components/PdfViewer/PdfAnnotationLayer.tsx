// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PdfTool } from '@shared/ipc-contract';
import { rgbToHex, type RGB } from '../../lib/color';
import { PdfTextBox, type PdfTextBoxModel, type PdfTextBoxPatch } from './PdfTextBox';

/** A point on a page as a fraction (0–1) of its width/height, so marks stay put at any zoom. */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

export type { PdfTextBoxModel, PdfTextBoxPatch };

export interface PdfStroke {
  readonly id: string;
  readonly points: readonly PagePoint[];
}

export interface PdfComment {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** `false` until its first non-empty Enter (or the tool turning off with text in it); an uncommitted empty comment is discarded. */
  readonly committed: boolean;
}

/** How far the pointer can travel (px) before a press on a stroke stops being a "click to delete" and becomes a new stroke. */
const CLICK_DRAG_THRESHOLD_PX = 4;

/** Past this fraction across the page, a comment box opens to the left of its dot so it isn't pushed off the page. */
const FLIP_BOX_AFTER = 0.65;

export interface PdfAnnotationLayerProps {
  readonly tool: PdfTool;
  /** Strokes, dots and boxes always repaint in the live accent, like the browser tools. */
  readonly color: RGB;
  readonly strokes: readonly PdfStroke[];
  readonly comments: readonly PdfComment[];
  readonly textBoxes: readonly PdfTextBoxModel[];
  /** The page's live zoom (1 = 100%) — text boxes scale their font with it. */
  readonly scale: number;
  /** The one comment whose box is open while the comment tool is off. */
  readonly openCommentId: string | null;
  readonly onAddStroke: (points: readonly PagePoint[]) => void;
  readonly onRemoveStroke: (id: string) => void;
  /** Returns the new comment's id so it can take focus immediately. */
  readonly onAddComment: (point: PagePoint) => string;
  readonly onChangeComment: (id: string, text: string) => void;
  /** Enter in a comment's box: saves it, or discards it if it's empty. */
  readonly onCommitComment: (id: string) => void;
  readonly onRemoveComment: (id: string) => void;
  /** A dot clicked while the comment tool is off: opens or closes its box. */
  readonly onToggleComment: (id: string) => void;
  /** Returns the new text box's id so it can take focus immediately. */
  readonly onAddTextBox: (point: PagePoint) => string;
  readonly onChangeTextBox: (id: string, patch: PdfTextBoxPatch) => void;
  /** Focus left a text box: the viewer drops it if it's empty. */
  readonly onEndTextBox: (id: string) => void;
  readonly onRemoveTextBox: (id: string) => void;
}

const toPolyline = (points: readonly PagePoint[]): string => points.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * Pen strokes, comment pins and text boxes drawn over one PDF page, working like the
 * browser tabs' tools. Marks live in page-relative coordinates, so they
 * scroll and zoom with the page.
 *
 * Pen: drag to draw, click a stroke to delete it. Comments: click the page
 * to drop a dot with a box beside it; Enter saves. While the tool is on
 * every box shows and clicking a dot deletes it; with it off only the dots
 * show, and clicking one opens its box. Text boxes: click the page to drop
 * one and type; they stay on the page with the tool off but can only be
 * edited with it on. With any other tool (or none) the layer lets pointer
 * events through so the page still pans or selects.
 */
export function PdfAnnotationLayer({
  tool,
  color,
  strokes,
  comments,
  textBoxes,
  scale,
  openCommentId,
  onAddStroke,
  onRemoveStroke,
  onAddComment,
  onChangeComment,
  onCommitComment,
  onRemoveComment,
  onToggleComment,
  onAddTextBox,
  onChangeTextBox,
  onEndTextBox,
  onRemoveTextBox,
}: PdfAnnotationLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ hitId: string | null; startX: number; startY: number } | null>(null);
  const [draft, setDraft] = useState<readonly PagePoint[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const hex = rgbToHex(color);
  const glow = `rgba(${color.r}, ${color.g}, ${color.b}, 0.55)`;

  // Opening a box with its dot (tool off) puts the caret in it, as in the browser.
  useEffect(() => {
    if (openCommentId && tool !== 'comment') {
      layerRef.current?.querySelector<HTMLTextAreaElement>(`[data-comment-id="${CSS.escape(openCommentId)}"] textarea`)?.focus();
    }
  }, [openCommentId, tool]);

  const pointOf = (event: { clientX: number; clientY: number }): PagePoint => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || tool !== 'pen') {
      return;
    }
    // Keeps the viewer's own press-and-drag panning out of a stroke.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const hit = (event.target as Element).closest('[data-stroke-id]');
    gestureRef.current = {
      hitId: hit?.getAttribute('data-stroke-id') ?? null,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDraft([pointOf(event)]);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (gestureRef.current) {
      const point = pointOf(event);
      setDraft((previous) => (previous ? [...previous, point] : previous));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) {
      return;
    }
    const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (gesture.hitId && moved < CLICK_DRAG_THRESHOLD_PX) {
      onRemoveStroke(gesture.hitId);
    } else if (draft && draft.length >= 2) {
      onAddStroke(draft);
    }
    setDraft(null);
  };

  // A click, not a press: the new box's textarea takes focus on render, and a
  // press's own default focus handling would immediately take it back.
  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const onEmptyPage = event.target === event.currentTarget || (event.target as Element).closest('svg');
    if (tool === 'comment' && onEmptyPage) {
      setFocusId(onAddComment(pointOf(event)));
    } else if (tool === 'text' && onEmptyPage) {
      setFocusId(onAddTextBox(pointOf(event)));
    }
  };

  return (
    <div
      ref={layerRef}
      className={`pdf-annot pdf-annot--${tool}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onPointerCancel={() => {
        gestureRef.current = null;
        setDraft(null);
      }}
    >
      <svg className="pdf-annot__svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {strokes.map((stroke) => (
          <g key={stroke.id} className="pdf-annot__stroke" data-stroke-id={stroke.id}>
            <polyline className="pdf-annot__line" points={toPolyline(stroke.points)} stroke={hex} />
            <polyline className="pdf-annot__hit" points={toPolyline(stroke.points)} />
          </g>
        ))}
        {draft && <polyline className="pdf-annot__line" points={toPolyline(draft)} stroke={hex} />}
      </svg>
      {comments.map((comment) => {
        const showBox = tool === 'comment' || comment.id === openCommentId;
        const flip = comment.x > FLIP_BOX_AFTER;
        return (
          <div key={comment.id} data-comment-id={comment.id}>
            <button
              type="button"
              className="pdf-annot__dot"
              aria-label="Comment"
              data-comment-dot={comment.id}
              style={
                {
                  left: `${comment.x * 100}%`,
                  top: `${comment.y * 100}%`,
                  backgroundColor: hex,
                  '--ns-comment-glow': glow,
                } as React.CSSProperties
              }
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                if (tool === 'comment') {
                  onRemoveComment(comment.id);
                } else {
                  onToggleComment(comment.id);
                }
              }}
            />
            {showBox && (
              <div
                className="pdf-annot__box"
                style={{
                  top: `calc(${comment.y * 100}% + 14px)`,
                  borderLeft: `3px solid ${hex}`,
                  ...(flip
                    ? { right: `calc(${(1 - comment.x) * 100}% + 14px)` }
                    : { left: `calc(${comment.x * 100}% + 14px)` }),
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <textarea
                  className="pdf-annot__input"
                  value={comment.text}
                  readOnly={tool !== 'comment'}
                  placeholder="Add a comment…"
                  rows={3}
                  autoFocus={comment.id === focusId}
                  onChange={(event) => onChangeComment(comment.id, event.target.value)}
                  onKeyDown={(event) => {
                    // Keeps the viewer's own D/Delete/arrow shortcuts out of typing.
                    event.stopPropagation();
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      onCommitComment(comment.id);
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      {textBoxes.map((box) => (
        <PdfTextBox
          key={box.id}
          box={box}
          hex={hex}
          scale={scale}
          editing={tool === 'text'}
          autoFocus={box.id === focusId}
          onChange={onChangeTextBox}
          onEditEnd={onEndTextBox}
          onRemove={onRemoveTextBox}
        />
      ))}
    </div>
  );
}
