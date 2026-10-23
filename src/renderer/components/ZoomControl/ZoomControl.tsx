// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ZOOM_PERCENT_MAX, ZOOM_PERCENT_MIN } from '@shared/constants';
import { formatShortcut } from '../../lib/shortcuts';

interface ZoomControlProps {
  /** The active tab's current zoom, already clamped by main to `ZOOM_PERCENT_MIN`–`ZOOM_PERCENT_MAX`. */
  readonly percent: number;
  /** Whether there's an active tab to zoom at all. */
  readonly canZoom: boolean;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  /** Commits an exact typed percent — main clamps it again regardless (see `TabManager.setZoom`), this is just what the field itself already restricted. */
  readonly onSetZoom: (percent: number) => void;
}

/**
 * Zoom out / zoom in / current percent, as one grouped control — the
 * percent field sits to the right of the "+" button, showing (and letting
 * you type) an exact value instead of only stepping through it. It's
 * local, editable "draft" text — same pattern as `AddressBar`'s
 * `draft` — kept separate from the `percent` prop so a keystroke never
 * fights a state push from main; it only resyncs from `percent` while not
 * focused (after a button press, a keyboard shortcut, or switching tabs).
 *
 * Restricted to digits as the person types, and a digit that would push
 * the value past `ZOOM_PERCENT_MAX` is dropped rather than accepted and
 * clamped after the fact — typing "300" never shows "300" even
 * momentarily, since `onChange` simply refuses that keystroke. The floor
 * isn't enforced the same way (an in-progress "2" on its way to "25" is
 * legitimately below it) — that's clamped once on commit (blur or Enter)
 * instead, same as whatever the field is left showing if it's cleared
 * entirely or left non-numeric.
 *
 * Ctrl+Shift+0 (menu accelerator, see buildMenu.ts and
 * `TabManager.requestFocusZoom`) jumps the cursor here regardless of which
 * tab's `WebContentsView` currently has focus, the same way Ctrl+/ does
 * for `AddressBar`; Escape hands focus back out again, reverting any
 * in-progress, uncommitted edit first (see `handleKeyDown`).
 */
export function ZoomControl({ percent, canZoom, onZoomOut, onZoomIn, onSetZoom }: ZoomControlProps) {
  const [draft, setDraft] = useState(String(percent));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(String(percent));
    }
  }, [percent]);

  useEffect(() => window.northstar.onFocusZoom(() => inputRef.current?.focus()), []);

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    // Digits only, and capped at 3 of them — `ZOOM_PERCENT_MAX` (200) is
    // the longest valid value, so a 4th digit could never be part of one.
    const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 3);
    if (digitsOnly !== '' && Number(digitsOnly) > ZOOM_PERCENT_MAX) {
      // Rejected outright rather than clamped — leaving `draft` unchanged
      // means this controlled input's value snaps back to what it was,
      // i.e. the keystroke that would have exceeded the max simply never
      // appears to have been typed at all.
      return;
    }
    setDraft(digitsOnly);
  };

  const commit = (): void => {
    const typed = Number(draft);
    if (draft === '' || !Number.isFinite(typed)) {
      setDraft(String(percent));
      return;
    }
    const clamped = Math.min(ZOOM_PERCENT_MAX, Math.max(ZOOM_PERCENT_MIN, Math.round(typed)));
    onSetZoom(clamped);
    setDraft(String(clamped));
  };

  // `select()` (on focus, below) leaves the typed digits highlighted —
  // Chromium keeps rendering that highlight even once the field is no
  // longer focused, unless something explicitly collapses it back to a
  // plain caret position first. `commit` alone doesn't do that (setting
  // `draft` only changes what text is *shown*, not the input's own
  // selection range), so every path out of the field goes through this
  // instead of calling `commit` directly.
  const handleBlur = (): void => {
    commit();
    inputRef.current?.setSelectionRange(0, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // `blur()` fires `handleBlur`, which commits — not called directly
      // here too, which would just mean doing it twice.
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      setDraft(String(percent));
      inputRef.current?.blur();
    }
  };

  return (
    <div className="zoom-control">
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onZoomOut}
        disabled={!canZoom}
        aria-label="Zoom out"
        data-tooltip={`Zoom out (${formatShortcut('-')})`}
      >
        −
      </button>
      <div
        className="zoom-control__bubble chrome-tooltip"
        data-tooltip={`Zoom percent (${formatShortcut('Shift+0')}) — ${ZOOM_PERCENT_MIN}–${ZOOM_PERCENT_MAX}%`}
      >
        <input
          ref={inputRef}
          className="zoom-control__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          disabled={!canZoom}
          onChange={handleChange}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          aria-label="Zoom percent"
        />
        <span className="zoom-control__suffix" aria-hidden="true">
          %
        </span>
      </div>
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onZoomIn}
        disabled={!canZoom}
        aria-label="Zoom in"
        data-tooltip={`Zoom in (${formatShortcut('=')})`}
      >
        +
      </button>
    </div>
  );
}
