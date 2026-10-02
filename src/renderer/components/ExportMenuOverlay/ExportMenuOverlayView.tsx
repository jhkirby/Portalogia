// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { useEffect, useRef, useState } from 'react';
import type { ExportMenuSyncPayload } from '@shared/ipc-contract';

/**
 * The whole of `export-menu.html`'s page — the export dropdown's rows,
 * drawn in their own `WebContentsView` so they sit above the live tab
 * (see `ExportMenuOverlay`). Picking a row reports it to main, which runs it.
 */
export function ExportMenuOverlayView() {
  const [payload, setPayload] = useState<ExportMenuSyncPayload | null>(null);
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

  if (!payload || !payload.open) {
    return null;
  }

  return (
    <div ref={menuRef} className="export-menu" role="menu" aria-label="Export">
      <button
        type="button"
        role="menuitem"
        className="export-menu__item"
        onClick={() => window.northstarExportMenu.select('pdf')}
      >
        PDF
      </button>
      <button
        type="button"
        role="menuitem"
        className="export-menu__item"
        disabled={!payload.canExportDocuments}
        onClick={() => window.northstarExportMenu.select('documents')}
      >
        HTML/CSS/JS
      </button>
    </div>
  );
}
