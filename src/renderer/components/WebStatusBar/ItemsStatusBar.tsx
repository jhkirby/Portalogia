// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { FocusHint } from '../FocusHint';

interface ItemsStatusBarProps {
  /** What the page's own stat bar shows, item by item, or `null` before its page has said. */
  readonly items: readonly string[] | null;
  /** What the bar describes, for assistive technology: "Note statistics". */
  readonly label: string;
  /** Whether the tab's page has the keyboard (`BrowserState.contentFocused`), for the focus hint at the far right. */
  readonly contentFocused: boolean;
  /** The keys that give the keyboard back to the chrome from this kind of page. */
  readonly unfocusKeys: string;
}

/**
 * The bar along the window's bottom in split screen when the side used last is a note, PDF or terminal: that page's
 * own stat bar is hidden, and its items (`TabStatItems`) are shown here instead, the whole width across, in the web
 * page's bar's look (`WebStatusBar`).
 */
export function ItemsStatusBar({ items, label, contentFocused, unfocusKeys }: ItemsStatusBarProps) {
  return (
    <footer className="web-status" aria-label={label}>
      {(items ?? ['…']).map((item, index) => (
        // The bar's items keep their places as their numbers change: by position.
        <span key={index} className={`web-status__item${index === 0 ? ' web-status__pointer' : ''}`}>
          {item}
        </span>
      ))}
      <FocusHint focused={contentFocused} unfocusKeys={unfocusKeys} />
    </footer>
  );
}
