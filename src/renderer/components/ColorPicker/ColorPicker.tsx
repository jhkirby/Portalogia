// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { useEffect, useRef, useState } from 'react';
import { COLOR_PICKER_PANEL_WIDTH_PX } from '@shared/constants';
import { useAccentColor } from '../../hooks/useAccentColor';
import { ColorDropletIcon } from '../icons';

/**
 * Vertical gap, in CSS pixels, between the button's own bottom edge and the dropdown below it. The button sits a
 * few pixels above the toolbar's own bottom edge, so this is wide enough to leave clear space under the toolbar
 * as well — the dropdown's top border never touches it.
 */
const DROPDOWN_GAP_PX = 16;

/**
 * The toolbar's accent-color picker button. The dropdown itself — the hue
 * ring, saturation/value square, recent-color swatches, and RGB/hex
 * fields — isn't rendered here, or anywhere in this chrome's own DOM: it
 * lives entirely in its own dedicated `WebContentsView`
 * (`color-picker.html`, see `ColorPickerOverlay` on the main-process
 * side), specifically so it appears *instantly* on top of the active
 * tab's still-live page. A chrome-drawn dropdown can't do that at all
 * (the tab's own view always paints above chrome HTML), and the only
 * chrome-side workaround (`BookmarkPopup`'s `beginTabPreview` — hide the
 * tab's view, capture a frame, show that instead) makes it worse: hiding
 * the view is an async round-trip to main, which is exactly the "draws
 * behind, then snaps on top" delay this component exists to avoid.
 *
 * This component's own job is just what `AddressBar` already does for its
 * suggestions dropdown: own the accent/recents state (`useAccentColor`),
 * measure where the dropdown should sit, and push both down via
 * `syncColorPicker` — the only channel that connects the two. Every drag
 * pixel and keystroke happens in the overlay's own page and reports back
 * via `onColorPickerColorChanged`, which is what actually calls `setAccent`.
 */
export function ColorPicker() {
  const { accent, setAccent, recentColors, commitRecent } = useAccentColor();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const closePicker = (): void => setIsOpen(false);

  // Pushes this button's current dropdown state to its overlay on every
  // change — open/closed, position, the current accent, and the recents
  // list. Fire-and-forget (see `syncColorPicker`'s own doc comment); the
  // overlay's own view mounts/unmounts and repositions itself in response.
  useEffect(() => {
    if (!isOpen) {
      window.northstar.syncColorPicker({ open: false, rect: null, accent, recentColors });
      return;
    }
    const updateSync = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      window.northstar.syncColorPicker({
        open: true,
        rect: {
          top: rect.bottom + DROPDOWN_GAP_PX,
          left: Math.max(8, rect.right - COLOR_PICKER_PANEL_WIDTH_PX),
        },
        accent,
        recentColors,
      });
    };
    updateSync();
    window.addEventListener('resize', updateSync);
    return () => window.removeEventListener('resize', updateSync);
  }, [isOpen, accent, recentColors]);

  // Belt-and-suspenders close on unmount, same reasoning as `AddressBar`'s
  // own — the effect above already syncs `open: false` on the dropdown's
  // own closed transition, but this covers this component going away some
  // other way (e.g. a hot reload) skipping straight past that.
  useEffect(
    () => () => {
      window.northstar.syncColorPicker({ open: false, rect: null, accent, recentColors: [] });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only the unmount cleanup, not re-run on every `accent`/`recentColors` change — this is a closed sync either way, so their exact value at unmount time doesn't matter.
    [],
  );

  useEffect(
    () =>
      window.northstar.onColorPickerColorChanged(({ rgb, commit }) => {
        setAccent(rgb);
        if (commit) {
          commitRecent(rgb);
        }
      }),
    [setAccent, commitRecent],
  );

  // Also fires for a click on the still-live page itself — main watches
  // the active tab's own `webContents` for a `'focus'` event while this
  // dropdown is open and reports it back through this same channel (see
  // `ColorPickerOverlay`'s own doc comment), since that's a third,
  // entirely separate process chrome's own DOM never sees any event from
  // either.
  useEffect(() => window.northstar.onColorPickerCloseRequested(closePicker), []);

  // Escape while focus is still in chrome (e.g. right after opening, before
  // the user has clicked into the overlay's own fields at all — once they
  // have, `onColorPickerCloseRequested` above is what catches it instead,
  // since a chrome-side `keydown` listener never sees a keystroke typed
  // while focus is inside a different `WebContentsView`). Also closes on
  // any other same-chrome-process click (e.g. another toolbar button) — a
  // click on the overlay's own fields or on the live page underneath is
  // cross-process the same way, so neither ever reaches this listener
  // either; those two are exactly what `onColorPickerCloseRequested`
  // above covers instead.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closePicker();
      }
    };
    const handlePointerDown = (event: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        closePicker();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="page-actions__button chrome-tooltip"
      onClick={() => setIsOpen((open) => !open)}
      aria-pressed={isOpen}
      aria-label="Accent color"
      data-tooltip="Accent color"
    >
      <ColorDropletIcon />
    </button>
  );
}
