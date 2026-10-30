// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useState } from 'react';

/** How long a load's progress takes to fade out once it's done. Must match `.address-bar__progress--leaving`. */
const PROGRESS_FADE_MS = 300;

/** The progress to draw: its value, and whether it's on its way out. */
export interface ShownProgress {
  readonly value: number;
  readonly leaving: boolean;
}

/**
 * A load's progress as a bar draws it: when the progress goes (a second after 100%), it fades out rather than
 * vanishing, the last value staying drawn, marked as leaving, until the fade is done. Shared by the address bar and the
 * PDF and note tabs' file bar.
 * @param progress How far the load has got, 0-100, or `null` when there's none.
 * @returns What to draw, or `null` once there's nothing.
 */
export function useFadingProgress(progress: number | null): ShownProgress | null {
  const [shown, setShown] = useState<ShownProgress | null>(progress === null ? null : { value: progress, leaving: false });
  useEffect(() => {
    if (progress !== null) {
      setShown({ value: progress, leaving: false });
      return undefined;
    }
    setShown((current) => (current ? { ...current, leaving: true } : null));
    const timer = window.setTimeout(() => setShown(null), PROGRESS_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [progress]);
  return shown;
}
