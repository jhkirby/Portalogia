// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useRef, useState } from 'react';
import { ExportIcon } from '../icons';

/** Vertical gap, in CSS pixels, between the button's bottom edge and the menu — same as `ColorPicker`'s. */
const DROPDOWN_GAP_PX = 6;

interface ExportMenuProps {
  /** Whether there's an active tab to export at all. */
  readonly canExport: boolean;
  /** Whether the active tab has web documents to save — false for a terminal tab. */
  readonly canExportDocuments: boolean;
  /** Whether the active tab is a Markdown note, whose menu lists PDF, `.md` and `.txt`. */
  readonly markdown: boolean;
}

/**
 * The toolbar's export button. The dropdown itself lives in its own
 * `WebContentsView` (`export-menu.html`, see `ExportMenuOverlay`) so it can
 * paint over the live page; this component owns the open state, measures
 * where the menu goes, and syncs both down — same split as `ColorPicker`.
 */
export function ExportMenu({ canExport, canExportDocuments, markdown }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      window.northstar.syncExportMenu({ kind: 'export', open: false, rect: null, canExportDocuments, markdown });
      return;
    }
    const updateSync = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      window.northstar.syncExportMenu({
        kind: 'export',
        open: true,
        rect: { top: rect.bottom + DROPDOWN_GAP_PX, left: Math.max(8, rect.left) },
        canExportDocuments,
        markdown,
      });
    };
    updateSync();
    window.addEventListener('resize', updateSync);
    return () => window.removeEventListener('resize', updateSync);
  }, [isOpen, canExportDocuments, markdown]);

  // Belt-and-suspenders close on unmount, same as `ColorPicker`.
  useEffect(
    () => () =>
      window.northstar.syncExportMenu({ kind: 'export', open: false, rect: null, canExportDocuments: false, markdown: false }),
    [],
  );

  // Escape in the overlay, a click on the live page, or a row being chosen.
  useEffect(() => window.northstar.onExportMenuCloseRequested(() => setIsOpen(false)), []);

  // Don't leave an open menu acting on nothing when the last tab closes.
  useEffect(() => {
    if (!canExport) {
      setIsOpen(false);
    }
  }, [canExport]);

  // Escape and outside clicks while focus is still in the chrome.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    const handlePointerDown = (event: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
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

  return (
    <button
      ref={buttonRef}
      type="button"
      className="page-actions__button hover-grow chrome-tooltip"
      onClick={() => setIsOpen((open) => !open)}
      disabled={!canExport}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-pressed={isOpen}
      aria-label="Export"
      data-tooltip="Export"
    >
      <ExportIcon />
    </button>
  );
}
