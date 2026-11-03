// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { RGB } from '@shared/color';
import { hsvToRgb, hueToRgb, rgbToHex, rgbToHsv } from '../../lib/color';

/** Matches `.color-picker__wheel`'s own `width`/`height` in color-wheel.css — needed here too for the ring thumb's trig (see `ringThumb` below). */
const WHEEL_SIZE_PX = 192;
/** Matches `.color-picker__ring`'s own thickness (the gap between `.color-picker__wheel`'s edge and `.color-picker__square-well`'s inset) — half of it is the ring thumb's orbit radius. */
const RING_THICKNESS_PX = 16;
const RING_RADIUS_PX = WHEEL_SIZE_PX / 2 - RING_THICKNESS_PX / 2;

interface ColorWheelProps {
  /** The current color; the wheel is fully controlled by it. */
  readonly value: RGB;
  /**
   * Called with every new color as it's dragged. `commit` is true at a settle
   * point (pointer released) — a drag mid-gesture isn't one.
   */
  readonly onChange: (next: RGB, commit: boolean) => void;
}

/**
 * The hue ring with the saturation/value square inside it — the picker the
 * accent color's dropdown and the workspace editor both use. The square has
 * no hue slider of its own: dragging inside it only changes saturation and
 * value, while the ring around it changes hue — the same split Photoshop's
 * picker uses.
 */
export function ColorWheel({ value, onChange }: ColorWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);

  const { h: hue, s, v } = useMemo(() => rgbToHsv(value), [value]);
  const hueColor = useMemo(() => rgbToHex(hueToRgb(hue)), [hue]);
  const ringThumb = useMemo(() => {
    const angleRad = (hue * Math.PI) / 180;
    return {
      left: WHEEL_SIZE_PX / 2 + RING_RADIUS_PX * Math.sin(angleRad),
      top: WHEEL_SIZE_PX / 2 - RING_RADIUS_PX * Math.cos(angleRad),
    };
  }, [hue]);

  const updateFromSquarePointer = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean): void => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return;
    }
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    onChange(hsvToRgb({ h: hue, s: x / rect.width, v: 1 - y / rect.height }), commit);
  };

  const handleSquarePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Routes subsequent move/up events to this element even once the
    // pointer strays outside it mid-drag — no document-level listeners
    // needed to keep tracking a fast drag that overshoots the square.
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromSquarePointer(event, false);
  };

  const handleSquarePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.buttons !== 1) {
      return;
    }
    updateFromSquarePointer(event, false);
  };

  /** Angle of the pointer around `.color-picker__wheel`'s own center, 0–360° clockwise from the top — matches `.color-picker__ring`'s `conic-gradient`, which also starts at the top and runs clockwise by CSS default, so this angle is directly usable as a hue. */
  const updateFromRingPointer = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean): void => {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (angle < 0) {
      angle += 360;
    }
    // Only hue changes — the square's own saturation/value stay exactly
    // where they were.
    onChange(hsvToRgb({ h: angle, s, v }), commit);
  };

  const handleRingPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromRingPointer(event, false);
  };

  const handleRingPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.buttons !== 1) {
      return;
    }
    updateFromRingPointer(event, false);
  };

  return (
    <div ref={wheelRef} className="color-picker__wheel">
      <div
        className="color-picker__ring"
        onPointerDown={handleRingPointerDown}
        onPointerMove={handleRingPointerMove}
        onPointerUp={(event) => updateFromRingPointer(event, true)}
      >
        <div className="color-picker__ring-thumb" style={ringThumb} aria-hidden="true" />
      </div>
      <div className="color-picker__square-well">
        <div
          ref={squareRef}
          className="color-picker__square"
          style={{ '--picker-hue-color': hueColor } as CSSProperties}
          onPointerDown={handleSquarePointerDown}
          onPointerMove={handleSquarePointerMove}
          onPointerUp={(event) => updateFromSquarePointer(event, true)}
        >
          <div
            className="color-picker__square-thumb"
            style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
