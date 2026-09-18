// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-11

import type { KeyboardEvent, MouseEvent } from 'react';
import type { TabState } from '@shared/tab-state';

interface TabBarProps {
  /** Tabs to render, left to right, in the order they were opened. */
  readonly tabs: readonly TabState[];
  /** Id of the tab drawn as selected; `null` while no window has one yet. */
  readonly activeTabId: string | null;
  /** Called when the user picks a different tab. */
  readonly onActivate: (id: string) => void;
  /** Called when the user closes a tab. */
  readonly onClose: (id: string) => void;
  /** Called when the user clicks the "new tab" button. */
  readonly onNewTab: () => void;
}

/** The row of open tabs at the top of the window, plus a "new tab" button. */
export function TabBar({ tabs, activeTabId, onActivate, onClose, onNewTab }: TabBarProps) {
  return (
    <div className="tab-bar" role="tablist" aria-label="Open tabs">
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onActivate={onActivate}
          onClose={onClose}
        />
      ))}
      <button type="button" className="tab-bar__new" aria-label="New tab" onClick={onNewTab}>
        +
      </button>
    </div>
  );
}

interface TabProps {
  readonly tab: TabState;
  readonly isActive: boolean;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
}

/** One tab. A `div[role=tab]` rather than a `<button>` because it hosts its own close `<button>`. */
function Tab({ tab, isActive, onActivate, onClose }: TabProps) {
  const activate = (): void => onActivate(tab.id);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  const handleClose = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onClose(tab.id);
  };

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      className={`tab-bar__tab${isActive ? ' tab-bar__tab--active' : ''}`}
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      {tab.kind === 'terminal' ? (
        <span className="tab-bar__terminal-icon" aria-hidden="true">
          {'>_'}
        </span>
      ) : tab.isLoading ? (
        <span className="tab-bar__spinner" aria-hidden="true" />
      ) : tab.favicon ? (
        <img className="tab-bar__favicon" src={tab.favicon} alt="" />
      ) : (
        <span className="tab-bar__favicon-placeholder" aria-hidden="true" />
      )}
      <span className="tab-bar__title">{tab.title || 'New Tab'}</span>
      <button
        type="button"
        className="tab-bar__close"
        aria-label={`Close ${tab.title || 'tab'}`}
        onClick={handleClose}
      >
        ×
      </button>
    </div>
  );
}
