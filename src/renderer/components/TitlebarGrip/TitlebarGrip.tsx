// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { useState, type PointerEvent } from 'react';

/**
 * The strip along the very top of the window, above the tabs, that you
 * grab to move the window. An ordinary element (not an OS drag region, which
 * can't react to the mouse at all) so it can go lighter/darker on hover and
 * while pressed and show a grab cursor — the drag itself is carried out by the
 * main process (`registerWindowIpc`), which follows the cursor from
 * `beginWindowDrag` until `endWindowDrag`. Double-clicking toggles maximize,
 * like a native titlebar.
 */
export function TitlebarGrip() {
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    // Capture keeps this element receiving the release (and the pressed look)
    // even once the window moves out from under the pointer.
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    window.northstar.beginWindowDrag();
  };

  const handlePointerEnd = (): void => {
    if (isDragging) {
      setIsDragging(false);
      window.northstar.endWindowDrag();
    }
  };

  return (
    <div
      className={`titlebar__grip${isDragging ? ' titlebar__grip--dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onDoubleClick={() => window.northstar.toggleMaximizeWindow()}
      aria-hidden="true"
    />
  );
}
