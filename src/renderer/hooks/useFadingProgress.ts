// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { useEffect, useState } from 'react';

/** How long a load's progress takes to fade out once it's done. Must match `.address-bar__progress--leaving`. */
const PROGRESS_FADE_MS = 300;

/** The progress to draw: its value, and whether it's on its way out. */
export interface ShownProgress {
  readonly value: number;
  readonly leaving: boolean;
}

/** Any value as a bar draws it while it fades out: the last one, marked as leaving. */
export interface ShownValue<T> {
  readonly value: T;
  readonly leaving: boolean;
}

/**
 * A value a bar shows while a load runs, faded out rather than dropped when it goes: the last one stays drawn, marked
 * as leaving, until the fade is done (`PROGRESS_FADE_MS`).
 * @param value The value now, or `null` once there's none.
 * @returns What to draw, or `null` once there's nothing.
 */
export function useFadingValue<T>(value: T | null): ShownValue<T> | null {
  const [shown, setShown] = useState<ShownValue<T> | null>(value === null ? null : { value, leaving: false });
  useEffect(() => {
    if (value !== null) {
      setShown({ value, leaving: false });
      return undefined;
    }
    setShown((current) => (current ? { ...current, leaving: true } : null));
    const timer = window.setTimeout(() => setShown(null), PROGRESS_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return shown;
}

/**
 * A load's progress as a bar draws it: when the progress goes (a second after 100%), it fades out rather than
 * vanishing, the last value staying drawn, marked as leaving, until the fade is done. Shared by the address bar and the
 * PDF and note tabs' file bar.
 * @param progress How far the load has got, 0-100, or `null` when there's none.
 * @returns What to draw, or `null` once there's nothing.
 */
export function useFadingProgress(progress: number | null): ShownProgress | null {
  return useFadingValue(progress);
}
