// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useEffect, useState } from 'react';
import { formatShortcut } from '../../lib/shortcuts';

/**
 * The three window-control buttons (minimize, maximize/restore, close)
 * that live at the right edge of `.titlebar`, standing in for the OS
 * titlebar's own now that the window runs frameless (see MainWindow.ts).
 * No app icon or title text sits alongside them — by design, not omission.
 */
export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(
    () => window.northstar.onWindowStateChanged((state) => setIsMaximized(state.isMaximized)),
    [],
  );

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-controls__button hover-grow chrome-tooltip"
        onClick={() => window.northstar.minimizeWindow()}
        aria-label="Minimize"
        data-tooltip={`Minimize (${formatShortcut('Alt+M')})`}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0 5H10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        className="window-controls__button hover-grow chrome-tooltip"
        onClick={() => window.northstar.toggleMaximizeWindow()}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        data-tooltip={`${isMaximized ? 'Restore' : 'Maximize'} (${formatShortcut('Alt+Enter')})`}
      >
        {isMaximized ? (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path d="M2.5 0.5H9.5V7.5" stroke="currentColor" strokeWidth="1" fill="none" />
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-controls__button hover-grow window-controls__button--close chrome-tooltip"
        onClick={() => window.northstar.closeWindow()}
        aria-label="Close"
        // Alt+F4 is the OS's own, on every platform this runs on the same way, so it is not `formatShortcut`'d.
        data-tooltip="Close (Alt+F4)"
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M0 0L10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
