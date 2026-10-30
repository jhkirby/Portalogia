// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

interface SpeakerIconProps {
  /** How many of the three sound waves are lit (0-3), as Windows' own tray icon shows the volume. */
  readonly waves: number;
  /** Muted: no waves, an × beside the speaker instead. */
  readonly muted?: boolean;
  /** Edge length in px. */
  readonly size?: number;
}

/** The waves, innermost first, spreading from the speaker's mouth at the right. */
const WAVES = ['M14.5 9.5a3.5 3.5 0 0 1 0 5', 'M16.8 7a7 7 0 0 1 0 10', 'M19.1 4.5a10.5 10.5 0 0 1 0 15'];

/**
 * A speaker with sound waves, for the titlebar's audio section: the waves the
 * volume reaches lit and the rest faint, like `WifiIcon`'s arcs, so the level
 * reads at a glance. Muted, the waves give way to an ×.
 */
export function SpeakerIcon({ waves, muted = false, size = 16 }: SpeakerIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M3.5 9.5h3l4.5-4v13l-4.5-4h-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {muted ? (
        <path d="M15 9.5l5 5M20 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        WAVES.map((d, index) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity={index < waves ? 1 : 0.3}
          />
        ))
      )}
    </svg>
  );
}
