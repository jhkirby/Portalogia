// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useEffect, useState, type ReactNode } from 'react';
import type { MarkdownBacklink } from '@shared/ipc-contract';
import type { NoteHeading, NoteLink } from '@shared/markdown/structure';

type PanelTab = 'outline' | 'backlinks' | 'outbound';

/** The panel's tabs, in order, with their labels. */
const PANEL_TABS: readonly { tab: PanelTab; label: string }[] = [
  { tab: 'outline', label: 'Outline' },
  { tab: 'backlinks', label: 'Backlinks' },
  { tab: 'outbound', label: 'Outbound' },
];

interface MarkdownSidePanelProps {
  /** Every heading of the note as it is now — recomputed from the text on each edit. */
  readonly headings: readonly NoteHeading[];
  /** Every link going out of the note as it is now. */
  readonly links: readonly NoteLink[];
  /** Changes with each note opened, so the backlinks are asked for again. */
  readonly noteKey: string;
  /** Brings a heading into view (the `index`th of `headings`). */
  readonly onGoToHeading: (heading: NoteHeading, index: number) => void;
  /** Follows an outbound link; `newTab` for Ctrl+click. */
  readonly onOpenLink: (link: NoteLink, newTab: boolean) => void;
}

/**
 * The right-hand panel: the note's outline (every heading, indented by
 * level, kept up to date as the note is edited; click to jump), its
 * backlinks (the notes that link here; click to open) and its outbound links
 * (every link in it; click to follow, Ctrl+click for a new tab). Each list
 * scrolls on its own when it's longer than the panel.
 */
export function MarkdownSidePanel({ headings, links, noteKey, onGoToHeading, onOpenLink }: MarkdownSidePanelProps) {
  const [tab, setTab] = useState<PanelTab>('outline');
  const [backlinks, setBacklinks] = useState<readonly MarkdownBacklink[] | null>(null);

  useEffect(() => {
    if (tab !== 'backlinks') {
      return undefined;
    }
    let current = true;
    setBacklinks(null);
    void window.northstarMarkdown.getBacklinks().then((found) => {
      if (current) {
        setBacklinks(found);
      }
    });
    return () => {
      current = false;
    };
  }, [tab, noteKey]);

  const shallowest = headings.reduce((least, heading) => Math.min(least, heading.level), 6);

  const renderList = (): ReactNode => {
    if (tab === 'outline') {
      return headings.length === 0 ? (
        <p className="md-panel__empty">No headings.</p>
      ) : (
        <ul className="md-panel__list">
          {headings.map((heading, index) => (
            <li key={`${heading.line}-${heading.text}`}>
              <button
                type="button"
                className="md-panel__item"
                style={{ paddingLeft: `${8 + (heading.level - shallowest) * 12}px` }}
                title={`${heading.text} (line ${heading.line})`}
                onClick={() => onGoToHeading(heading, index)}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      );
    }
    if (tab === 'backlinks') {
      if (backlinks === null) {
        return <p className="md-panel__empty">Looking…</p>;
      }
      return backlinks.length === 0 ? (
        <p className="md-panel__empty">No notes link here.</p>
      ) : (
        <ul className="md-panel__list">
          {backlinks.map((link) => (
            <li key={link.target}>
              <button
                type="button"
                className="md-panel__item"
                title={link.target}
                onClick={(event) => void window.northstarMarkdown.openLink('link', link.target, event.ctrlKey || event.metaKey)}
              >
                {link.name}
              </button>
            </li>
          ))}
        </ul>
      );
    }
    return links.length === 0 ? (
      <p className="md-panel__empty">No links in this note.</p>
    ) : (
      <ul className="md-panel__list">
        {links.map((link, index) => (
          <li key={`${index}-${link.target}`}>
            <button
              type="button"
              className="md-panel__item md-panel__item--link"
              title={`${link.target} (line ${link.line})`}
              onClick={(event) => onOpenLink(link, event.ctrlKey || event.metaKey)}
            >
              <span className="md-panel__link-label">{link.label}</span>
              {link.label !== link.target && <span className="md-panel__link-target">{link.target}</span>}
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <aside className="md-panel" aria-label="Outline and links">
      <div className="md-panel__tabs" role="tablist">
        {PANEL_TABS.map(({ tab: name, label }) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`md-panel__tab hover-grow${tab === name ? ' md-panel__tab--active' : ''}`}
            onClick={() => setTab(name)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="md-panel__body">{renderList()}</div>
    </aside>
  );
}
