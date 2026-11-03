// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

interface SplitScreenIconProps {
  /** Whether the screen is split now: the icon is then one screen, what a click goes back to. */
  readonly split: boolean;
  /** Edge length in px. */
  readonly size?: number;
}

/**
 * The split-screen button's icon: two screens side by side — what a click
 * makes — or, while split, one whole screen, what a click goes back to.
 */
export function SplitScreenIcon({ split, size = 16 }: SplitScreenIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {split ? (
        <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      ) : (
        <>
          <rect x="2.5" y="5" width="8.5" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <rect x="13" y="5" width="8.5" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </>
      )}
    </svg>
  );
}
