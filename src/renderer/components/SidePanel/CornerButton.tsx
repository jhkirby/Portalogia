// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** How long the pointer rests on the button before its tooltip shows, like the chrome's own. */
const TOOLTIP_DELAY_MS = 500;

interface CornerButtonProps {
  /** What the button does: its accessible name, and its tooltip's text. */
  readonly label: string;
  /** The key that does the same, shown after the label in the tooltip. */
  readonly shortcut?: string;
  readonly pressed: boolean;
  /** Extra classes: which corner slot it takes (`side-panel-toggle--edit`). */
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

/**
 * One of the round-cornered buttons in a note's or PDF's top-right corner:
 * the side panel's toggle, and the sections' Edit beside it. Its tooltip is
 * drawn by the page, under the button and held to its right edge, so it
 * opens leftward into the page instead of off the window's edge, where the
 * page's native `title` tooltip ran.
 */
export function CornerButton({ label, shortcut, pressed, className, onClick, children }: CornerButtonProps) {
  const [tipShown, setTipShown] = useState(false);
  const timerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const hideTip = (): void => {
    window.clearTimeout(timerRef.current);
    setTipShown(false);
  };

  return (
    <button
      type="button"
      className={`side-panel-toggle hover-grow${className ? ` ${className}` : ''}`}
      aria-pressed={pressed}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      // Taken by the press, not left with the button: the keyboard stays with the document.
      onMouseDown={(event) => event.preventDefault()}
      onPointerEnter={() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setTipShown(true), TOOLTIP_DELAY_MS);
      }}
      onPointerLeave={hideTip}
      onClick={() => {
        hideTip();
        onClick();
      }}
    >
      {children}
      {tipShown && (
        <span className="side-panel-tip" role="tooltip">
          {label}
          {shortcut && <span className="side-panel-tip__keys">{shortcut}</span>}
        </span>
      )}
    </button>
  );
}
