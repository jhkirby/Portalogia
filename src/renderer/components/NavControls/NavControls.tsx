// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { formatAltShortcut, formatShortcut } from '../../lib/shortcuts';
import { ReloadIcon, StopIcon } from '../icons';

interface NavControlsProps {
  /** Whether the active tab has back history. */
  readonly canGoBack: boolean;
  /** Whether the active tab has forward history. */
  readonly canGoForward: boolean;
  /** Whether the active tab is mid-navigation (swaps reload for stop). */
  readonly isLoading: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onReloadOrStop: () => void;
  readonly onHome: () => void;
}

/** Back / forward / reload-or-stop / home buttons for the active tab. */
export function NavControls({
  canGoBack,
  canGoForward,
  isLoading,
  onBack,
  onForward,
  onReloadOrStop,
  onHome,
}: NavControlsProps) {
  return (
    <div className="nav-controls">
      <button
        type="button"
        className="nav-controls__button hover-grow chrome-tooltip"
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Back"
        data-tooltip={`Back (${formatAltShortcut('←')})`}
      >
        ‹
      </button>
      <button
        type="button"
        className="nav-controls__button hover-grow chrome-tooltip"
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Forward"
        data-tooltip={`Forward (${formatAltShortcut('→')})`}
      >
        ›
      </button>
      <button
        type="button"
        className="nav-controls__button hover-grow chrome-tooltip"
        onClick={onReloadOrStop}
        aria-label={isLoading ? 'Stop' : 'Reload'}
        data-tooltip={isLoading ? 'Stop' : `Reload (${formatShortcut('R')})`}
      >
        {isLoading ? <StopIcon size={15} /> : <ReloadIcon size={15} />}
      </button>
      <button
        type="button"
        className="nav-controls__button hover-grow chrome-tooltip"
        onClick={onHome}
        aria-label="Home"
        data-tooltip={`Home (${formatShortcut('H')})`}
      >
        ⌂
      </button>
    </div>
  );
}
