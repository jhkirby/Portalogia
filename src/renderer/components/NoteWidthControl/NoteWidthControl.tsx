// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

import type { ChangeEvent, CSSProperties } from 'react';

interface NoteWidthControlProps {
  /** The width chosen, as a percent of the note's page (`MarkdownTabState.contentWidth`); 0 is the usual column. */
  readonly percent: number;
  /** The percent the usual column takes (`MarkdownTabState.contentWidthMin`): the slider's left end. */
  readonly minPercent: number;
  /** Whether the note is shown formatted: the raw text keeps a text file's width, so the slider rests meanwhile. */
  readonly enabled: boolean;
  /** Draws the note this wide; 0 for the usual column. */
  readonly onChange: (percent: number) => void;
}

/**
 * A note's width, beside the zoom: a bar dragged left and right, and the
 * width it gives, as a percent of the page, to its right. The left end is the
 * note's usual column and the right end the page's full width (100%).
 */
export function NoteWidthControl({ percent, minPercent, enabled, onChange }: NoteWidthControlProps) {
  // Before the page has measured its column, the bar starts at the left with nothing known to show.
  const least = Math.min(100, Math.max(1, minPercent));
  const shown = Math.max(least, Math.min(100, percent));
  // How far along the bar the thumb sits, for the filled part of its track (see `.note-width__slider`).
  const fill = least >= 100 ? 0 : ((shown - least) / (100 - least)) * 100;
  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = Number(event.currentTarget.value);
    // Back at the left end is the usual column again, which then follows the window as it resizes.
    onChange(next <= least ? 0 : next);
  };

  return (
    <div
      className={`note-width chrome-tooltip${enabled ? '' : ' note-width--disabled'}`}
      data-tooltip={enabled ? 'Note width: the formatted note, as a percent of the page' : 'Note width (formatted view only)'}
    >
      <input
        className="note-width__slider"
        type="range"
        min={least}
        max={100}
        step={1}
        value={shown}
        style={{ '--note-width-fill': `${fill}%` } as CSSProperties}
        disabled={!enabled || least >= 100}
        onChange={handleChange}
        aria-label="Note width"
        aria-valuetext={`${shown}%`}
      />
      <span className="note-width__value" aria-hidden="true">
        {minPercent > 0 ? `${shown}%` : '–%'}
      </span>
    </div>
  );
}
