// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NEW_TAB_MENU_WIDTH_PX } from '@shared/constants';
import { formatShortcut } from '../../lib/shortcuts';

/** Vertical gap, in CSS pixels, between the button's bottom edge and the menu — the export menu's. */
const DROPDOWN_GAP_PX = 6;

/** The least room, in CSS pixels, kept between the menu and the window's right edge. */
const EDGE_MARGIN_PX = 8;

interface NewTabMenuProps {
  /** The button's place among the tabs (it follows the last one). */
  readonly style: CSSProperties;
}

/**
 * The tab row's "+": it opens a menu of what a new tab can be — a new tab, then
 * the PDF viewer, Markdown viewer, terminal, bookmark manager, secret manager
 * and history viewer. Like the export menu (`ExportMenu`), the menu itself is
 * drawn by its own native view above the page (`ExportMenuOverlay`, a second
 * one for this menu), so it can open over a live page; this button owns
 * whether it's open, measures where it goes, and syncs both down. Main opens
 * the tab a row names, and closes the menu.
 */
export function NewTabMenu({ style }: NewTabMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      window.portalogia.syncNewTabMenu({ kind: 'new-tab', open: false, rect: null, canExportDocuments: false, markdown: false });
      return undefined;
    }
    const updateSync = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      // Below the button, its left edge with the button's, moved in from the window's right edge if it would cross it.
      const left = Math.max(EDGE_MARGIN_PX, Math.min(rect.left, window.innerWidth - NEW_TAB_MENU_WIDTH_PX - EDGE_MARGIN_PX));
      window.portalogia.syncNewTabMenu({
        kind: 'new-tab',
        open: true,
        rect: { top: rect.bottom + DROPDOWN_GAP_PX, left },
        canExportDocuments: false,
        markdown: false,
      });
    };
    updateSync();
    window.addEventListener('resize', updateSync);
    return () => window.removeEventListener('resize', updateSync);
  }, [isOpen]);

  // Closed on unmount too (the "+" goes at the tab limit), so the menu isn't left over the page.
  useEffect(
    () => () =>
      window.portalogia.syncNewTabMenu({ kind: 'new-tab', open: false, rect: null, canExportDocuments: false, markdown: false }),
    [],
  );

  // A row picked, Escape in the menu, or a click on the page.
  useEffect(() => window.portalogia.onNewTabMenuCloseRequested(() => setIsOpen(false)), []);

  // Escape and clicks elsewhere while the keyboard is still in the chrome.
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
      className="tab-bar__new hover-glow chrome-tooltip"
      style={style}
      aria-label="New tab"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      onClick={() => setIsOpen((open) => !open)}
      data-tooltip={`New tab, PDF, note, terminal… (a plain new tab: ${formatShortcut('N')})`}
    >
      +
    </button>
  );
}
