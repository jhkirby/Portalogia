// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import type { AnimationEvent, ReactNode } from 'react';

interface PopupTransitionProps {
  /** Whether the popup is on its way out: it plays its closing motion, then `onExited` runs. */
  readonly closing: boolean;
  /** The closing motion finished: now the popup can really go (and the tab's own view come back). */
  readonly onExited: () => void;
  readonly children: ReactNode;
}

/** The animation whose end means the popup has finished leaving (see popup-transition.css). */
const EXIT_ANIMATION = 'popup-panel-out';

/**
 * The motion of a popup over the page (the bookmark popup, tab search, the
 * workspace editor and images): the blurred still of the page behind it
 * fades in as it blurs, and the panel grows in; closing, the still sharpens
 * back into the page as the scrim fades, and the panel shrinks away. Ending
 * sharp is what lets the tab's live view come back with no visible jump.
 *
 * Adds no box of its own (`display: contents`), so the popup inside still lays
 * out against `.tab-content` as before; the motion itself is all in
 * popup-transition.css, keyed on the shared preview, scrim and dialog.
 */
export function PopupTransition({ closing, onExited, children }: PopupTransitionProps) {
  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>): void => {
    if (closing && event.animationName === EXIT_ANIMATION) {
      onExited();
    }
  };
  return (
    <div className="popup-transition" data-closing={closing ? 'true' : undefined} onAnimationEnd={handleAnimationEnd}>
      {children}
    </div>
  );
}
