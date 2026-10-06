// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MarkdownTool } from '@shared/ipc-contract';
import { rgbToHex, type RGB } from '../../lib/color';

/** A point on the note, in `em`s: `x` from the center of the text column (right is positive), `y` from the top of the note. */
export interface NotePoint {
  readonly x: number;
  readonly y: number;
}

export interface NoteStroke {
  readonly id: string;
  readonly points: readonly NotePoint[];
}

export interface NoteComment {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** `false` until its first non-empty Enter (or the tool turning off with text in it); an uncommitted empty comment is discarded. */
  readonly committed: boolean;
}

/** How far the pointer can travel (px) before a press on a stroke stops being a "click to delete" and becomes a new stroke. */
const CLICK_DRAG_THRESHOLD_PX = 4;

/** Past this many `em`s right of center, a comment box opens to the left of its dot so it isn't pushed off the page. */
const FLIP_BOX_AFTER_EM = 14;

interface MarkdownAnnotationLayerProps {
  readonly tool: MarkdownTool;
  /** Strokes and dots always repaint in the live accent, like the browser tools. */
  readonly color: RGB;
  readonly strokes: readonly NoteStroke[];
  readonly comments: readonly NoteComment[];
  /** The one comment whose box is open while the comment tool is off. */
  readonly openCommentId: string | null;
  /** The note's size and the length of one `em`, in pixels — what the notes' `em` coordinates are drawn against. */
  readonly width: number;
  readonly height: number;
  readonly emPx: number;
  readonly onAddStroke: (points: readonly NotePoint[]) => void;
  readonly onRemoveStroke: (id: string) => void;
  /** Returns the new comment's id so it can take focus immediately. */
  readonly onAddComment: (point: NotePoint) => string;
  readonly onChangeComment: (id: string, text: string) => void;
  /** Enter in a comment's box: saves it, or discards it if it's empty. */
  readonly onCommitComment: (id: string) => void;
  readonly onRemoveComment: (id: string) => void;
  /** A dot clicked while the comment tool is off: opens or closes its box. */
  readonly onToggleComment: (id: string) => void;
}

const toPolyline = (points: readonly NotePoint[]): string => points.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * Pen strokes and comment pins drawn over a rendered note, working like the
 * PDF viewer's and the browser tabs' tools. Marks are in `em`s from the text
 * column's center and the note's top, so they stay with the text through a
 * window resize or a zoom.
 *
 * Pen: drag to draw, click a stroke to delete it. Comments: click the note to
 * drop a dot with a box beside it; Enter saves. While the tool is on every
 * box shows and clicking a dot deletes it; with it off only the dots show,
 * and clicking one opens its box. With any other tool (or none) the layer
 * lets pointer events through so the note still scrolls, selects and links.
 */
export function MarkdownAnnotationLayer({
  tool,
  color,
  strokes,
  comments,
  openCommentId,
  width,
  height,
  emPx,
  onAddStroke,
  onRemoveStroke,
  onAddComment,
  onChangeComment,
  onCommitComment,
  onRemoveComment,
  onToggleComment,
}: MarkdownAnnotationLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ hitId: string | null; startX: number; startY: number } | null>(null);
  const [draft, setDraft] = useState<readonly NotePoint[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const hex = rgbToHex(color);
  const glow = `rgba(${color.r}, ${color.g}, ${color.b}, 0.55)`;
  const widthEm = emPx > 0 ? width / emPx : 1;
  const heightEm = emPx > 0 ? height / emPx : 1;

  // Opening a box with its dot (tool off) puts the caret in it, as in the browser.
  useEffect(() => {
    if (openCommentId && tool !== 'comment') {
      layerRef.current?.querySelector<HTMLTextAreaElement>(`[data-comment-id="${CSS.escape(openCommentId)}"] textarea`)?.focus();
    }
  }, [openCommentId, tool]);

  const pointOf = (event: { clientX: number; clientY: number }): NotePoint => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || emPx <= 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: (event.clientX - rect.left - rect.width / 2) / emPx,
      y: Math.max(0, (event.clientY - rect.top) / emPx),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || tool !== 'pen') {
      return;
    }
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
    const onEmptyNote = event.target === event.currentTarget || (event.target as Element).closest('svg');
    if (tool === 'comment' && onEmptyNote) {
      setFocusId(onAddComment(pointOf(event)));
    }
  };

  return (
    <div
      ref={layerRef}
      className={`md-annot md-annot--${tool}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onPointerCancel={() => {
        gestureRef.current = null;
        setDraft(null);
      }}
    >
      {/* One unit is one `em`, so the strokes stay with the text; `x` runs either side of the column's center. */}
      <svg
        className="md-annot__svg"
        viewBox={`${-widthEm / 2} 0 ${widthEm} ${heightEm}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {strokes.map((stroke) => (
          <g key={stroke.id} className="md-annot__stroke" data-stroke-id={stroke.id}>
            <polyline className="md-annot__line" points={toPolyline(stroke.points)} stroke={hex} />
            <polyline className="md-annot__hit" points={toPolyline(stroke.points)} />
          </g>
        ))}
        {draft && <polyline className="md-annot__line" points={toPolyline(draft)} stroke={hex} />}
      </svg>
      {comments.map((comment) => {
        const showBox = tool === 'comment' || comment.id === openCommentId;
        const flip = comment.x > FLIP_BOX_AFTER_EM;
        return (
          <div key={comment.id} data-comment-id={comment.id}>
            <button
              type="button"
              className="md-annot__dot"
              aria-label="Comment"
              data-comment-dot={comment.id}
              style={
                {
                  left: `calc(50% + ${comment.x}em)`,
                  top: `${comment.y}em`,
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
                className="md-annot__box"
                style={{
                  top: `calc(${comment.y}em + 14px)`,
                  borderLeft: `3px solid ${hex}`,
                  ...(flip ? { right: `calc(50% - ${comment.x}em + 14px)` } : { left: `calc(50% + ${comment.x}em + 14px)` }),
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <textarea
                  className="md-annot__input"
                  value={comment.text}
                  readOnly={tool !== 'comment'}
                  placeholder="Add a comment…"
                  rows={3}
                  autoFocus={comment.id === focusId}
                  onChange={(event) => onChangeComment(comment.id, event.target.value)}
                  onKeyDown={(event) => {
                    // Keeps the viewer's own shortcuts out of typing.
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
    </div>
  );
}
