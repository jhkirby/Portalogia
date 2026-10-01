// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { useEffect, useState } from 'react';

/** The placeholder, once fully typed in. */
const FULL_TEXT = 'Search the internet...';
/** The part that never changes — everything before the trailing dots. */
const STEADY_TEXT = 'Search the internet';

/** Delay between typed characters: quick enough that the whole line lands in about half a second. */
const TYPE_INTERVAL_MS = 25;
/** How long each dots state ("...", "", ".", "..") holds before the next. */
const DOTS_INTERVAL_MS = 500;
/** The trailing dots' loop: `...` → nothing → `.` → `..` → `...` again, forever. */
const DOTS_CYCLE = ['...', '', '.', '..'] as const;

/**
 * An animated placeholder for the address bar's empty field: the text types
 * itself in left to right, one character at a time, once; after that the
 * trailing dots loop forever (`...`, none, `.`, `..`, `...`, ...).
 *
 * The animation belongs to the mounted field — `AddressBar` is remounted for
 * every tab (see its `key` in `App`), so each new tab plays it afresh. It
 * pauses while the field has text (the placeholder isn't visible then) and
 * resumes where it was. With "reduce motion" on, it's just the static text.
 * @param active Whether the placeholder is currently showing (the field is empty).
 * @returns The placeholder text for this moment.
 */
export function useAnimatedPlaceholder(active: boolean): string {
  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // How many characters have been typed so far; once it reaches the full length, `dotsStep` takes over.
  const [typed, setTyped] = useState(prefersReducedMotion ? FULL_TEXT.length : 0);
  const [dotsStep, setDotsStep] = useState(0);
  const isTyping = typed < FULL_TEXT.length;

  useEffect(() => {
    if (!active || prefersReducedMotion) {
      return undefined;
    }
    const timer = window.setInterval(
      () => {
        if (isTyping) {
          setTyped((count) => count + 1);
        } else {
          setDotsStep((step) => (step + 1) % DOTS_CYCLE.length);
        }
      },
      isTyping ? TYPE_INTERVAL_MS : DOTS_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [active, isTyping, prefersReducedMotion]);

  if (prefersReducedMotion) {
    return FULL_TEXT;
  }
  return isTyping ? FULL_TEXT.slice(0, typed) : STEADY_TEXT + DOTS_CYCLE[dotsStep];
}
