// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

interface BatteryIconProps {
  /** Charge remaining, 0-100: how much of the body is filled. */
  readonly percent: number;
  /** Plugged in: a bolt over the fill. */
  readonly charging?: boolean;
  /** Width in px; the height follows at the icon's own proportions. */
  readonly width?: number;
}

/** The inside of the battery's body, which the fill grows across. */
const INNER = { x: 3.5, y: 6.5, width: 15, height: 7 };

/**
 * A horizontal battery: a rounded outline with a nub on the right, filled
 * from the left as far as the charge goes. The fill takes its color from the
 * `--battery-fill` custom property (set by the titlebar for low, critical and
 * charging), falling back to the text color.
 */
export function BatteryIcon({ percent, charging = false, width = 26 }: BatteryIconProps) {
  const level = Math.min(100, Math.max(0, percent));
  // Any charge at all shows a sliver, so a nearly empty battery doesn't read as missing its fill.
  const fillWidth = level === 0 ? 0 : Math.max(1.5, (INNER.width * level) / 100);
  return (
    <svg viewBox="0 0 24 20" width={width} height={(width * 20) / 24} aria-hidden="true">
      <rect x="1.5" y="4.5" width="19" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22.5 8.2v3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect
        x={INNER.x}
        y={INNER.y}
        width={fillWidth}
        height={INNER.height}
        rx="1.2"
        style={{ fill: 'var(--battery-fill, currentColor)' }}
      />
      {charging && (
        <path
          d="M12.2 5.2 8.6 10.6h2.6l-1 4.2 3.6-5.4h-2.6z"
          fill="currentColor"
          stroke="var(--color-chrome-bg)"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
