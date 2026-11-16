// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useRef, useState, type RefObject } from 'react';
import { EXPORT_MENU_HEIGHT_PX, EXPORT_MENU_MARKDOWN_HEIGHT_PX, EXPORT_MENU_WIDTH_PX } from '@shared/constants';

/** Horizontal gap, in CSS pixels, between the menu and the row it opens from. */
const DROPDOWN_GAP_PX = 6;

/** The least room, in CSS pixels, kept between the menu and the window's edges. */
const EDGE_MARGIN_PX = 8;

interface ExportMenuOptions {
  /** Whether there's an active tab to export at all. */
  readonly canExport: boolean;
  /** Whether the active tab has web documents to save — false for a terminal tab. */
  readonly canExportDocuments: boolean;
  /** Whether the active tab is a Markdown note, whose menu lists PDF, `.md` and `.txt`. */
  readonly markdown: boolean;
}

/**
 * The export menu's open state, for the Tools sidebar's Export row. The menu
 * itself lives in its own `WebContentsView` (`export-menu.html`, see
 * `ExportMenuOverlay`) so it can paint over the live page; this hook owns
 * whether it's open, measures where it goes — to the left of the row, beside
 * the sidebar, level with the row and moved up if it would run off the window
 * — and syncs both down.
 * @returns The ref for the row the menu opens from, whether it's open, and the row's click.
 */
export function useExportMenu({ canExport, canExportDocuments, markdown }: ExportMenuOptions): {
  readonly anchorRef: RefObject<HTMLButtonElement | null>;
  readonly isOpen: boolean;
  readonly toggle: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      window.portalogia.syncExportMenu({ kind: 'export', open: false, rect: null, canExportDocuments, markdown });
      return undefined;
    }
    const updateSync = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const height = markdown ? EXPORT_MENU_MARKDOWN_HEIGHT_PX : EXPORT_MENU_HEIGHT_PX;
      window.portalogia.syncExportMenu({
        kind: 'export',
        open: true,
        rect: {
          top: Math.max(EDGE_MARGIN_PX, Math.min(rect.top, window.innerHeight - height - EDGE_MARGIN_PX)),
          left: Math.max(EDGE_MARGIN_PX, rect.left - DROPDOWN_GAP_PX - EXPORT_MENU_WIDTH_PX),
        },
        canExportDocuments,
        markdown,
      });
    };
    updateSync();
    window.addEventListener('resize', updateSync);
    return () => window.removeEventListener('resize', updateSync);
  }, [isOpen, canExportDocuments, markdown]);

  // Closed on unmount too, so the menu isn't left over the page.
  useEffect(
    () => () =>
      window.portalogia.syncExportMenu({ kind: 'export', open: false, rect: null, canExportDocuments: false, markdown: false }),
    [],
  );

  // Escape in the overlay, a click on the live page, or a row being chosen.
  useEffect(() => window.portalogia.onExportMenuCloseRequested(() => setIsOpen(false)), []);

  // Don't leave an open menu acting on nothing when the last tab closes.
  useEffect(() => {
    if (!canExport) {
      setIsOpen(false);
    }
  }, [canExport]);

  // Escape and outside clicks while focus is still in the chrome.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    const handlePointerDown = (event: MouseEvent): void => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen]);

  return { anchorRef, isOpen, toggle: () => setIsOpen((open) => !open) };
}
