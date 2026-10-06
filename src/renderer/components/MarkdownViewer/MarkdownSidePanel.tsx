// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useState } from 'react';
import type { MarkdownBacklink } from '@shared/ipc-contract';
import type { OutlineEntry } from '../../lib/markdown/enhance';

type PanelTab = 'outline' | 'backlinks';

interface MarkdownSidePanelProps {
  /** The note's headings (empty in the editor, which doesn't draw them). */
  readonly outline: readonly OutlineEntry[];
  /** Changes with each note opened, so the backlinks are asked for again. */
  readonly noteKey: string;
  /** Scrolls the rendered note to a heading. */
  readonly onGoToHeading: (id: string) => void;
}

/**
 * The right-hand panel Obsidian calls the outline and backlinks: the note's
 * headings (click to jump), and the notes that link here (click to open).
 * Backlinks are asked of main when the panel opens and when the note changes.
 */
export function MarkdownSidePanel({ outline, noteKey, onGoToHeading }: MarkdownSidePanelProps) {
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

  const shallowest = outline.reduce((least, entry) => Math.min(least, entry.level), 6);

  return (
    <aside className="md-panel" aria-label="Outline and backlinks">
      <div className="md-panel__tabs" role="tablist">
        {(['outline', 'backlinks'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`md-panel__tab${tab === name ? ' md-panel__tab--active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name === 'outline' ? 'Outline' : 'Backlinks'}
          </button>
        ))}
      </div>
      {tab === 'outline' ? (
        outline.length === 0 ? (
          <p className="md-panel__empty">No headings.</p>
        ) : (
          <ul className="md-panel__list">
            {outline.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="md-panel__item"
                  style={{ paddingLeft: `${8 + (entry.level - shallowest) * 12}px` }}
                  onClick={() => onGoToHeading(entry.id)}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : backlinks === null ? (
        <p className="md-panel__empty">Looking…</p>
      ) : backlinks.length === 0 ? (
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
      )}
    </aside>
  );
}
