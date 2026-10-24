// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import type { ReactNode } from 'react';

/** One of the panel's tabs: what it's called, and the label it shows. */
export interface SidePanelTab<T extends string> {
  readonly tab: T;
  readonly label: string;
}

interface SidePanelProps<T extends string> {
  /** The panel's name, for screen readers. */
  readonly label: string;
  /** The tabs across the top, in order. */
  readonly tabs: readonly SidePanelTab<T>[];
  /** The tab showing. */
  readonly active: T;
  readonly onTab: (tab: T) => void;
  /** The tab's list. */
  readonly children: ReactNode;
}

/**
 * The right-hand panel a note and a PDF share (`side-panel.css`): a row of
 * tabs, and the tab's list beneath, which scrolls on its own when it's longer
 * than the panel. What each tab lists is up to the viewer.
 */
export function SidePanel<T extends string>({ label, tabs, active, onTab, children }: SidePanelProps<T>) {
  return (
    <aside className="side-panel" aria-label={label}>
      <div className="side-panel__tabs" role="tablist">
        {tabs.map(({ tab, label: tabLabel }) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active === tab}
            className={`side-panel__tab hover-grow${active === tab ? ' side-panel__tab--active' : ''}`}
            onClick={() => onTab(tab)}
          >
            {tabLabel}
          </button>
        ))}
      </div>
      <div className="side-panel__body">{children}</div>
    </aside>
  );
}
