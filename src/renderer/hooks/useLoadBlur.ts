// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/components/load-blur.css';

/** How long, in ms, content stays blurred at least, so content that's ready at once still shows the blur. */
const MIN_BLUR_MS = 450;
/** How long, in ms, content stays blurred at most, should its "ready" never come. */
const MAX_BLUR_MS = 8000;

/** How long, in ms, a closed note's or PDF's content takes to fade away (`.content-fading` in load-blur.css). */
export const CONTENT_FADE_MS = 250;

/** What `useLoadBlur` hands back. */
export interface LoadBlur {
  /** Whether the content is blurred now: put `load-blur--on` on the element (beside `load-blur`) while it is. */
  readonly blurred: boolean;
  /** Blurs the content: something has begun loading into it. */
  readonly start: () => void;
  /** Clears the blur (after the shortest blur, and once it has been painted): what was loading is in. */
  readonly finish: () => void;
}

/**
 * The blur a note, PDF or terminal shows while its content loads, as a web page does on going to a new site
 * (`tabLoadBlur.ts`): blurred from `start` until `finish`, then fading back to sharp.
 * @param initially Whether the content starts out blurred (loading from the start, as a terminal's shell does).
 * @returns The blur's state and its controls.
 */
export function useLoadBlur(initially = false): LoadBlur {
  const [blurred, setBlurred] = useState(initially);
  const startedAt = useRef(initially ? performance.now() : 0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback((): void => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const finish = useCallback((): void => {
    clearTimers();
    const wait = Math.max(0, MIN_BLUR_MS - (performance.now() - startedAt.current));
    // A painted frame after the wait, so the content has been shown blurred before it fades back.
    timers.current.push(
      window.setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => setBlurred(false))), wait),
    );
  }, [clearTimers]);

  const start = useCallback((): void => {
    clearTimers();
    startedAt.current = performance.now();
    setBlurred(true);
    timers.current.push(window.setTimeout(() => setBlurred(false), MAX_BLUR_MS));
  }, [clearTimers]);

  useEffect(() => {
    if (initially) {
      timers.current.push(window.setTimeout(() => setBlurred(false), MAX_BLUR_MS));
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the first render's value means anything.
  }, []);

  return { blurred, start, finish };
}
