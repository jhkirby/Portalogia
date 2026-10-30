// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useState } from 'react';
import { MENU_FADE_MS } from '@shared/constants';

/** What a fading dropdown draws: the payload it was last open with, and whether it's on its way out. */
export interface FadingMenu<T> {
  readonly shown: T | null;
  readonly closing: boolean;
}

/**
 * A dropdown drawn in a view of its own fades out rather than vanishing when it closes: the last open payload stays
 * drawn, marked as closing, for `MENU_FADE_MS` (main keeps the view on the window that long), then nothing is.
 * @param payload The latest sync from main, or `null` before the first.
 * @param isOpen Whether a payload means open.
 * @returns What to draw.
 */
export function useMenuFade<T>(payload: T | null, isOpen: (payload: T) => boolean): FadingMenu<T> {
  const open = payload !== null && isOpen(payload);
  const [lastOpen, setLastOpen] = useState<T | null>(null);
  // Kept during render (not in an effect), so the frame that closes it already draws it closing, never blank.
  if (open && lastOpen !== payload) {
    setLastOpen(payload);
  }
  useEffect(() => {
    if (open) {
      return undefined;
    }
    const timer = window.setTimeout(() => setLastOpen(null), MENU_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return { shown: open ? payload : lastOpen, closing: !open };
}
