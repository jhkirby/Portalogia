// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

/** A water-drop outline — `ColorPicker`'s toolbar button, next to the theme toggle it sits left of. */
const DROPLET_PATH =
  'M12 2.7C12 2.7 5.6 11.2 5.6 15.7C5.6 19.34 8.51 22.2 12 22.2C15.49 22.2 18.4 19.34 18.4 15.7C18.4 11.2 12 2.7 12 2.7Z';

interface ColorDropletIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

export function ColorDropletIcon({ size = 16 }: ColorDropletIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={DROPLET_PATH} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}
