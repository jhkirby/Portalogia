// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import type { PageStats } from '@shared/ipc-contract';
import { formatPointerPosition } from '../../hooks/usePointerPosition';
import { FocusHint, PAGE_UNFOCUS_KEYS } from '../FocusHint';

interface WebStatusBarProps {
  /** The page's stats, or `null` before it has counted (a page still loading). */
  readonly stats: PageStats | null;
  /** Whether the page has the keyboard (`BrowserState.contentFocused`), for the focus hint at the bar's far right. */
  readonly contentFocused: boolean;
}

/**
 * The bar along the bottom of a web page's tab, like a note's or a PDF's: where
 * the pointer is over the page, the page's words, characters, images, links, bytes and elements, the element with
 * the keyboard and the one under the pointer, and while text is selected, its words and characters. Drawn by the
 * chrome in the strip main keeps free below the page (`STATUS_BAR_HEIGHT_PX`),
 * from what the page itself counted (`tabStats.ts`).
 */
export function WebStatusBar({ stats, contentFocused }: WebStatusBarProps) {
  const count = (value: number | undefined, one: string, many: string): string =>
    value === undefined ? `… ${many}` : `${value.toLocaleString()} ${value === 1 ? one : many}`;

  return (
    <footer className="web-status" aria-label="Page statistics">
      <span className="web-status__item web-status__pointer" title="Pointer position in the page (x×y, in CSS pixels from its top-left)">
        {formatPointerPosition(stats?.pointer ?? null)}
      </span>
      <span className="web-status__item">{count(stats?.words, 'word', 'words')}</span>
      <span className="web-status__item">{count(stats?.characters, 'character', 'characters')}</span>
      <span className="web-status__item">{count(stats?.images, 'image', 'images')}</span>
      <span className="web-status__item">{count(stats?.links, 'link', 'links')}</span>
      <span className="web-status__item">{count(stats?.bytes, 'byte', 'bytes')}</span>
      <span className="web-status__item">{count(stats?.elements, 'element', 'elements')}</span>
      {stats?.selection && (
        <span className="web-status__selection" aria-label="Selection">
          <span className="web-status__item">Selected:</span>
          <span className="web-status__item">{count(stats.selection.words, 'word', 'words')}</span>
          <span className="web-status__item">{count(stats.selection.characters, 'character', 'characters')}</span>
        </span>
      )}
      {/* What has the keyboard, then what's under the pointer: last, and allowed to shrink, since a long description is
          what gives way in a narrow window. */}
      {(stats?.focused || stats?.hovered) && (
        <span className="web-status__elements">
          {stats.focused && (
            <span className="web-status__element" title={stats.focused}>
              Focus: {stats.focused}
            </span>
          )}
          {stats.hovered && (
            <span className="web-status__element web-status__element--hovered" title={stats.hovered}>
              Hovering: {stats.hovered}
            </span>
          )}
        </span>
      )}
      <FocusHint focused={contentFocused} unfocusKeys={PAGE_UNFOCUS_KEYS} />
    </footer>
  );
}
