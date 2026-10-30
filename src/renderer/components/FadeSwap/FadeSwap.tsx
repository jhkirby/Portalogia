// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useState } from 'react';

/** How long each half of a change takes: the old text fading out, then the new one fading in. Must match fade-swap.css. */
const FADE_MS = 220;

interface FadeSwapProps {
  /** What to show; a change fades the old text out, then the new one in. */
  readonly text: string;
  /** The span's own classes, for its look. */
  readonly className?: string;
}

/**
 * A short text that changes by fading: the old one fades out entirely, and only
 * then is the new one put in and faded in — the titlebar's temperature taking
 * its next unit, or the next connected Bluetooth device's name. Never both at
 * once, so the two never overlap or jump.
 */
export function FadeSwap({ text, className }: FadeSwapProps) {
  const [shown, setShown] = useState(text);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    if (text === shown) {
      setFadingOut(false);
      return undefined;
    }
    setFadingOut(true);
    const timer = window.setTimeout(() => {
      setShown(text);
      setFadingOut(false);
    }, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [text, shown]);

  return <span className={`fade-swap${fadingOut ? ' fade-swap--out' : ''}${className ? ` ${className}` : ''}`}>{shown}</span>;
}
