// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import type { TabState } from '@shared/tab-state';

interface SplitIndicatorProps {
  readonly secondaryTab: TabState;
  readonly onExit: () => void;
}

/**
 * A compact chip in the toolbar showing which tab is sharing the screen in
 * split view, with a button to exit back to a single full-width tab. The
 * split panes themselves are native `WebContentsView`s the main process
 * draws directly — this chip is the only DOM-side trace of split view.
 */
export function SplitIndicator({ secondaryTab, onExit }: SplitIndicatorProps) {
  return (
    <div className="split-indicator">
      {secondaryTab.kind === 'browser' && secondaryTab.favicon ? (
        <img className="split-indicator__favicon" src={secondaryTab.favicon} alt="" />
      ) : (
        <span className="split-indicator__favicon-placeholder" aria-hidden="true" />
      )}
      <span className="split-indicator__title">{secondaryTab.title || 'New Tab'}</span>
      <button
        type="button"
        className="split-indicator__exit"
        onClick={onExit}
        aria-label="Exit split view"
      >
        ×
      </button>
    </div>
  );
}
