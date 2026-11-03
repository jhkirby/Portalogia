// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

interface BluetoothIconProps {
  /** The radio is off: the rune dimmed, with a forward slash struck through it. */
  readonly off?: boolean;
  /** Edge length in px. */
  readonly size?: number;
}

/** The Bluetooth rune, drawn in one stroke to match `WifiIcon`'s arcs. */
export function BluetoothIcon({ off = false, size = 16 }: BluetoothIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={off ? 0.35 : 1}
      />
      {off &&<path d="M4 20L20 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}
