// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExportMenuSyncPayload, NewTabMenuAction } from '@shared/ipc-contract';
import { useMenuFade } from '../../hooks/useMenuFade';
import { BookmarksIcon, GlobeIcon, HistoryIcon, LockIcon } from '../icons';

/** The "+" menu's rows, in order: what each opens, its icon (the toolbar buttons' old faces), and its text. */
const NEW_TAB_ROWS: readonly { readonly action: NewTabMenuAction; readonly icon: ReactNode; readonly text: string }[] = [
  { action: 'new-tab', icon: <GlobeIcon size={14} />, text: 'Open New Tab' },
  { action: 'new-pdf', icon: <span className="new-tab-menu__badge">PDF</span>, text: 'Open PDF Viewer' },
  { action: 'new-markdown', icon: <span className="new-tab-menu__badge">MD</span>, text: 'Open Markdown Viewer' },
  { action: 'new-terminal', icon: <span className="new-tab-menu__badge">{'>_'}</span>, text: 'Open Terminal Emulator' },
  { action: 'new-bookmarks', icon: <BookmarksIcon size={14} />, text: 'Open Bookmark Manager' },
  { action: 'new-secrets', icon: <LockIcon size={14} />, text: 'Open Secret Manager' },
  { action: 'new-history', icon: <HistoryIcon size={14} />, text: 'Open History Viewer' },
];

/**
 * The whole of `export-menu.html`'s page — the export dropdown's rows,
 * drawn in their own `WebContentsView` so they sit above the live tab
 * (see `ExportMenuOverlay`). Picking a row reports it to main, which runs it.
 */
export function ExportMenuOverlayView() {
  const [synced, setPayload] = useState<ExportMenuSyncPayload | null>(null);
  // Fades in as it opens, and out as it closes (main keeps the view up meanwhile).
  const { shown: payload, closing } = useMenuFade(synced, (sync) => sync.open);
  const fade = closing ? ' menu-fade menu-fade--out' : ' menu-fade';
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.northstarExportMenu.onSync(setPayload), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.northstarExportMenu.requestClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }
      // Roving focus over the enabled rows, wrapping at both ends. Enter
      // and Space then activate the focused row natively (it's a button).
      event.preventDefault();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (items.length === 0) {
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = current === -1 ? (step === 1 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!payload) {
    return null;
  }

  // The tab row's "+" menu, drawn by its own copy of this overlay: what a new tab can be, each with its icon.
  if (payload.kind === 'new-tab') {
    return (
      <div ref={menuRef} className={`export-menu new-tab-menu${fade}`} role="menu" aria-label="New tab">
        {NEW_TAB_ROWS.map((row) => (
          <button
            key={row.action}
            type="button"
            role="menuitem"
            className="export-menu__item new-tab-menu__item"
            onClick={() => window.northstarExportMenu.select(row.action)}
          >
            <span className="new-tab-menu__icon" aria-hidden="true">
              {row.icon}
            </span>
            {row.text}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={menuRef} className={`export-menu${fade}`} role="menu" aria-label="Export">
      <button
        type="button"
        role="menuitem"
        className="export-menu__item"
        onClick={() => window.northstarExportMenu.select('pdf')}
      >
        PDF
      </button>
      {payload.markdown ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="export-menu__item"
            onClick={() => window.northstarExportMenu.select('markdown')}
          >
            Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            className="export-menu__item"
            onClick={() => window.northstarExportMenu.select('text')}
          >
            Text
          </button>
        </>
      ) : (
        <button
          type="button"
          role="menuitem"
          className="export-menu__item"
          disabled={!payload.canExportDocuments}
          onClick={() => window.northstarExportMenu.select('documents')}
        >
          HTML/CSS/JS
        </button>
      )}
    </div>
  );
}
