// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-03

import { useEffect, useState } from 'react';

/** Shift+Escape gives the keyboard back to the chrome from a web page, PDF or note (`TabManager`'s input handling). */
export const PAGE_UNFOCUS_KEYS = 'Shift+Esc';

/** A terminal keeps Shift+Escape for the shell, so Ctrl+` is its way out instead. */
export const TERMINAL_UNFOCUS_KEYS = 'Ctrl+`';

interface FocusHintProps {
  /** Whether the tab's page has the keyboard. */
  readonly focused: boolean;
  /** The keys that give the keyboard back to the chrome while the page has it. */
  readonly unfocusKeys: string;
}

/**
 * The last item in a stat bar, at its far right: how to move the keyboard between the chrome and the page. While
 * the page doesn't have it, Escape in the chrome hands it over; while it does, `unfocusKeys` hand it back. Its
 * class leaves out `status__item`, so the stat items a page reads out for the split-screen bar never include it.
 */
export function FocusHint({ focused, unfocusKeys }: FocusHintProps) {
  return (
    <span className="focus-hint" aria-live="polite">
      {focused ? `Press ${unfocusKeys} to unfocus.` : 'Press ESC to focus.'}
    </span>
  );
}

/**
 * Whether this page's window has the keyboard, kept current: for the note, PDF and terminal pages, which each run
 * in their own view and draw their own stat bar.
 * @returns `true` while the page has the keyboard.
 */
export function usePageHasFocus(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const sync = (): void => setFocused(document.hasFocus());
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    sync();
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
    };
  }, []);
  return focused;
}
