// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { TEXT_BOX_FONT_SIZE_MAX, TEXT_BOX_FONT_SIZE_MIN, type TextBoxAlign } from '@shared/constants';

/** One text box on a page: its top-left as fractions of the page, its font size in PDF points, and how its lines align. */
export interface PdfTextBoxModel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly align: TextBoxAlign;
}

/** What `onChange` can change about a box. */
export type PdfTextBoxPatch = Partial<Omit<PdfTextBoxModel, 'id'>>;

/** PDF points are 1/72 in and CSS pixels 1/96 in, so a point-sized font needs this factor at 100% zoom. */
const CSS_PIXELS_PER_POINT = 96 / 72;

/** Past this fraction across the page, the options panel opens to the left of the box so it isn't pushed off the page. */
const FLIP_BAR_AFTER = 0.55;

/** A press that travels less than this many px is a click on the frame, not a drag. */
const DRAG_THRESHOLD_PX = 3;

const ALIGNMENTS: readonly TextBoxAlign[] = ['left', 'center', 'right'];

const clampSize = (size: number): number =>
  Math.min(TEXT_BOX_FONT_SIZE_MAX, Math.max(TEXT_BOX_FONT_SIZE_MIN, Math.round(size)));

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/** Four stacked lines, each starting at the edge or middle `align` implies. */
function AlignIcon({ align }: { readonly align: TextBoxAlign }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {[12, 7, 12, 7].map((width, index) => {
        const x = align === 'left' ? 2 : align === 'center' ? (16 - width) / 2 : 14 - width;
        return (
          <path
            key={index}
            d={`M${x} ${3 + index * 3.4}h${width}`}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

interface SizeFieldProps {
  readonly size: number;
  readonly onChange: (size: number) => void;
  /** Enter in the field hands the caret back to the text. */
  readonly onEnter: () => void;
}

/**
 * The editable font size shown beside a box while it's being edited. A valid
 * in-range number applies as it's typed; anything else (empty, out of range)
 * is only corrected when the field loses focus, so typing "2" on the way to
 * "24" isn't snapped to 8 mid-keystroke.
 */
function SizeField({ size, onChange, onEnter }: SizeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="number"
      className="pdf-tb__size"
      min={TEXT_BOX_FONT_SIZE_MIN}
      max={TEXT_BOX_FONT_SIZE_MAX}
      step={1}
      aria-label="Font size"
      title={`Font size (${TEXT_BOX_FONT_SIZE_MIN}–${TEXT_BOX_FONT_SIZE_MAX}) — Ctrl+. larger, Ctrl+, smaller`}
      value={draft ?? String(size)}
      onChange={(event) => {
        setDraft(event.target.value);
        const typed = event.target.valueAsNumber;
        if (Number.isFinite(typed) && typed >= TEXT_BOX_FONT_SIZE_MIN && typed <= TEXT_BOX_FONT_SIZE_MAX) {
          onChange(Math.round(typed));
        }
      }}
      onBlur={() => {
        if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) {
          onChange(clampSize(Number(draft)));
        }
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

export interface PdfTextBoxProps {
  readonly box: PdfTextBoxModel;
  /** The accent color text is painted in. */
  readonly hex: string;
  /** The page's live zoom (1 = 100%), which scales the text with the page. */
  readonly scale: number;
  /** Whether the text box tool is on — only then can a box be edited, moved or deleted. */
  readonly editing: boolean;
  /** Takes the caret on first render (a box just dropped). */
  readonly autoFocus: boolean;
  readonly onChange: (id: string, patch: PdfTextBoxPatch) => void;
  /** Focus left the box (and its panel): the viewer drops it if it's empty. */
  readonly onEditEnd: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

/**
 * A text box over a PDF page. The text and the options panel (size,
 * alignment, delete) live in one wrapper so focus moving between them
 * doesn't count as leaving the box; the panel is shown by CSS only while the
 * wrapper has focus. Ctrl+. and Ctrl+, step the size by one point. The
 * wrapper's padding is a frame around the text: dragging it moves the box
 * (a press inside it edits).
 */
export function PdfTextBox({ box, hex, scale, editing, autoFocus, onChange, onEditEnd, onRemove }: PdfTextBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    boxX: number;
    boxY: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const flip = box.x > FLIP_BAR_AFTER;

  const stepSize = (delta: number): void => onChange(box.id, { size: clampSize(box.size + delta) });

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    const layer = event.currentTarget.offsetParent;
    if (!editing || event.button !== 0 || event.target !== event.currentTarget || !layer) {
      return;
    }
    // Keeps the caret where it was, so an empty box isn't dropped for losing focus mid-drag.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = layer.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      boxX: box.x,
      boxY: box.y,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.width === 0 || drag.height === 0) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {
      return;
    }
    drag.moved = true;
    onChange(box.id, {
      x: clampUnit(drag.boxX + deltaX / drag.width),
      y: clampUnit(drag.boxY + deltaY / drag.height),
    });
  };

  return (
    <div
      className={`pdf-tb${flip ? ' pdf-tb--flip' : ''}`}
      data-text-box-id={box.id}
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, color: hex, '--pdf-tb-color': hex } as CSSProperties}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onEditEnd(box.id);
        }
      }}
      onKeyDown={(event) => {
        // Keeps the viewer's own shortcuts out of typing.
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          if (event.code === 'Period') {
            event.preventDefault();
            stepSize(1);
          } else if (event.code === 'Comma') {
            event.preventDefault();
            stepSize(-1);
          }
        }
      }}
    >
      <textarea
        ref={textareaRef}
        className="pdf-tb__input"
        value={box.text}
        rows={1}
        wrap="off"
        spellCheck={false}
        maxLength={10000}
        readOnly={!editing}
        tabIndex={editing ? 0 : -1}
        autoFocus={autoFocus}
        style={{ fontSize: `${box.size * CSS_PIXELS_PER_POINT * scale}px`, textAlign: box.align }}
        onChange={(event) => onChange(box.id, { text: event.target.value })}
      />
      {editing && (
        <div className="pdf-tb__bar">
          <SizeField
            size={box.size}
            onChange={(size) => onChange(box.id, { size })}
            onEnter={() => textareaRef.current?.focus()}
          />
          {ALIGNMENTS.map((align) => (
            <button
              key={align}
              type="button"
              className="pdf-tb__button"
              aria-label={`Align ${align}`}
              title={`Align ${align}`}
              aria-pressed={box.align === align}
              // The press's default would move focus off the box before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(box.id, { align })}
            >
              <AlignIcon align={align} />
            </button>
          ))}
          <button
            type="button"
            className="pdf-tb__button pdf-tb__button--delete"
            aria-label="Delete text box"
            title="Delete text box"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRemove(box.id)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
