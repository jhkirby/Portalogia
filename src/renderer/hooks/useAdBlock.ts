// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useState } from 'react';
import type { AdBlockState } from '@shared/ipc-contract';

const OFF: AdBlockState = { enabled: true, allowedSites: [], blockedByTab: {} };

/** @returns The hostname of a URL, or `null` if it has none (a blank or app page). */
export function hostOfUrl(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname || null : null;
  } catch {
    return null;
  }
}

/**
 * Mirrors the ad blocker's state from main: read once on mount, then kept
 * current by main's pushes (a toggle, or a tab's blocked count moving).
 */
export function useAdBlock(): AdBlockState {
  const [state, setState] = useState<AdBlockState>(OFF);

  useEffect(() => {
    let cancelled = false;
    void window.northstar.getAdBlockState().then((initial) => {
      if (!cancelled && initial) {
        setState(initial);
      }
    });
    const unsubscribe = window.northstar.onAdBlockState(setState);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
