// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useState } from 'react';

/** How often the sidebar's and the tab strip's shimmer each come round. */
export const SHIMMER_PERIOD_MS = 20_000;

/**
 * How long a shimmer is left switched on: long enough for the wave to reach the last workspace or tab (each starts
 * a little after the one before) and finish. Then it's switched off, so nothing can set it going again before the
 * next turn: a running animation restarts whenever its element is hidden and shown again, as a workspace's icon is
 * when hovering swaps it for the save star.
 */
const SHIMMER_RUN_MS = 3000;

/**
 * A shimmer that comes round every `SHIMMER_PERIOD_MS`, first after
 * `offsetMs`: the workspaces at 0 and the tabs at half the period, so one of
 * the two runs every ten seconds. Nothing runs for someone who has asked the
 * system for less motion.
 * @param offsetMs How long after the app opens the first shimmer runs, and so where in the period the rest fall.
 * @returns `'a'` or `'b'` (by turns) while a shimmer runs, `null` between them — for a `data-shimmer` attribute.
 */
export function useShimmerTick(offsetMs: number): 'a' | 'b' | null {
  const [turn, setTurn] = useState<'a' | 'b' | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    let toggle: 'a' | 'b' = 'b';
    let stop = 0;
    const run = (): void => {
      toggle = toggle === 'a' ? 'b' : 'a';
      setTurn(toggle);
      window.clearTimeout(stop);
      stop = window.setTimeout(() => setTurn(null), SHIMMER_RUN_MS);
    };
    let interval = 0;
    const first = window.setTimeout(() => {
      run();
      interval = window.setInterval(run, SHIMMER_PERIOD_MS);
    }, offsetMs || SHIMMER_PERIOD_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(stop);
      window.clearInterval(interval);
    };
  }, [offsetMs]);

  return turn;
}
