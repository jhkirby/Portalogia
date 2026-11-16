// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

interface WifiIconProps {
  /** How many of the three arcs are lit (0-3), as Windows' own tray icon shows signal strength. */
  readonly bars: number;
  /** Not connected: every arc dimmed, with a line struck through. */
  readonly disconnected?: boolean;
  /** Edge length in px. */
  readonly size?: number;
}

/** The arcs, innermost first, centred on the dot at (12, 19). */
const ARCS = ['M8.5 15.2a5 5 0 0 1 7 0', 'M5.3 12a9.5 9.5 0 0 1 13.4 0', 'M2.2 8.8a14 14 0 0 1 19.6 0'];

/** The Wi-Fi fan: a dot under three arcs, the unlit ones faint, so the signal reads at a glance. */
export function WifiIcon({ bars, disconnected = false, size = 16 }: WifiIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="19" r="1.6" fill="currentColor" opacity={disconnected ? 0.35 : 1} />
      {ARCS.map((d, index) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity={!disconnected && index < bars ? 1 : 0.3}
        />
      ))}
      {disconnected && <path d="M4 4l16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}
