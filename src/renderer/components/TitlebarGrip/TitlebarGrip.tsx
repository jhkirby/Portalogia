// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { useEffect, useState, type PointerEvent } from 'react';

/**
 * The strip along the very top of the window, above the tabs, that you
 * grab to move the window. Double-clicking toggles maximize, like a native
 * titlebar.
 *
 * Normally an ordinary element (not an OS drag region, which can't react to
 * the mouse at all) so it can change color while pressed and show a grab
 * cursor; the drag itself is carried out by the main process
 * (`registerWindowIpc`), which follows the cursor from `beginWindowDrag` until
 * `endWindowDrag`.
 *
 * While the window is maximized it is an OS drag region instead. The main
 * process can't take a maximized window out of that state while the mouse
 * button is held (the restore is ignored, so the drag did nothing), whereas the
 * OS's own title-bar drag does exactly what Chrome's does: pull the window
 * back to its normal size under the cursor and carry on moving it. Only the
 * grab cursor is lost, and only while maximized.
 */
export function TitlebarGrip() {
  const [isDragging, setIsDragging] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  // Main is the authority on the state: read it once, then follow its pushes.
  useEffect(() => {
    let cancelled = false;
    void window.northstar.getWindowState().then((state) => {
      if (!cancelled) {
        setIsMaximized(state.isMaximized);
      }
    });
    const unsubscribe = window.northstar.onWindowStateChanged((state) => setIsMaximized(state.isMaximized));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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
      className={`titlebar__grip${isDragging ? ' titlebar__grip--dragging' : ''}${isMaximized ? ' titlebar__grip--native' : ''}`}
      onPointerDown={isMaximized ? undefined : handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onDoubleClick={isMaximized ? undefined : () => window.northstar.toggleMaximizeWindow()}
      aria-hidden="true"
    />
  );
}
