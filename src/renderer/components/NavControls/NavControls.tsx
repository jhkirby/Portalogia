// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { formatAltShortcut } from '../../lib/shortcuts';

interface NavControlsProps {
  /** Whether the active tab has back history. */
  readonly canGoBack: boolean;
  /** Whether the active tab has forward history. */
  readonly canGoForward: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
}

/**
 * Back and forward for the active tab. Reload sits at the address bar's own right end (`AddressBar`), and Home in the
 * Tools sidebar.
 */
export function NavControls({ canGoBack, canGoForward, onBack, onForward }: NavControlsProps) {
  return (
    <div className="nav-controls">
      <button
        type="button"
        className="nav-controls__button hover-glow chrome-tooltip"
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Back"
        data-tooltip={`Back (${formatAltShortcut('←')})`}
      >
        ‹
      </button>
      <button
        type="button"
        className="nav-controls__button hover-glow chrome-tooltip"
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Forward"
        data-tooltip={`Forward (${formatAltShortcut('→')})`}
      >
        ›
      </button>
    </div>
  );
}
