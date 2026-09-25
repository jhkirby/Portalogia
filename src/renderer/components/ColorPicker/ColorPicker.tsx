// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAccentColor } from '../../hooks/useAccentColor';
import { clampChannel, hexToRgb, hsvToRgb, hueToRgb, rgbToHex, rgbToHsv, type RGB } from '../../lib/color';
import { ColorDropletIcon } from '../icons';

/** How many of the most recently picked colors the swatch grid shows — two rows of five (see `.color-picker__recents`' `grid-template-columns`). */
const RECENT_SLOTS = 10;

/** Matches `.color-picker__panel`'s own `width` in color-picker.css — needed here too since the panel's `left` is computed from it (right-aligned under the button). */
const PANEL_WIDTH_PX = 224;

/** Matches `.color-picker__wheel`'s own `width`/`height` in color-picker.css — needed here too for the ring thumb's trig (see `ringThumb` below). */
const WHEEL_SIZE_PX = 192;
/** Matches `.color-picker__ring`'s own thickness (the gap between `.color-picker__wheel`'s edge and `.color-picker__square-well`'s inset) — half of it is the ring thumb's orbit radius. */
const RING_THICKNESS_PX = 16;
const RING_RADIUS_PX = WHEEL_SIZE_PX / 2 - RING_THICKNESS_PX / 2;

interface ColorPickerProps {
  /** The tab whose native view `beginTabPreview` hides while the dropdown is open — `null` when there's no tab at all (e.g. the last one just closed). */
  readonly activeTabId: string | null;
}

/**
 * The toolbar's accent-color picker — a droplet button that drops down a
 * saturation/value square, the 10 most recently picked colors, and
 * synchronized RGB + hex fields. Whatever it lands on becomes
 * `--color-accent-rgb` (`useAccentColor`), which is what `colors.css`
 * builds the app's "default blue" from — the address bar's focus ring,
 * the loading spinner, a dragged tab's tint, and every selected/active
 * highlight — everywhere, not just here.
 *
 * The dropdown itself can't just be a `position: absolute` child of the
 * button the way `ZoomControl`'s bubble is: `.app` clips its own content
 * to a fixed `--size-chrome-height` (see app.css), and even escaping that
 * clip, the active tab's own `WebContentsView` is a separate native
 * surface that always paints above the chrome's HTML (see
 * `TabManager`'s class doc comment) — a plain CSS dropdown tall enough to
 * hold a color square would be invisible and unclickable under it either
 * way. Same problem `BookmarkPopup` already solves, and the same fix:
 * `beginTabPreview` takes the tab's view off the window for as long as
 * the dropdown is open, and a `createPortal` to `document.body` (not a
 * DOM descendant of `.app` any more, so no longer subject to its clip)
 * renders a crisp (unblurred — this is standing in for a still-live page,
 * not a modal dimming it) snapshot of it behind an anchored panel,
 * positioned in JS off the button's own `getBoundingClientRect()` since
 * it's no longer a CSS-positioned descendant of it either.
 *
 * The square alone only ever reaches one hue's worth of colors (it drags
 * across saturation/value, not hue), so it's ringed by a fixed rainbow
 * hue wheel — dragging that sets hue while leaving the square's current
 * saturation/value alone, the same split Photoshop's own picker uses.
 * Typing a differently-hued RGB or hex value moves the square's own
 * gradient and the ring's thumb to match, same as dragging either one.
 */
export function ColorPicker({ activeTabId }: ColorPickerProps) {
  const { accent, setAccent, recentColors, commitRecent } = useAccentColor();
  const [isOpen, setIsOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [contentRect, setContentRect] = useState<DOMRect | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const rInputRef = useRef<HTMLInputElement>(null);
  const gInputRef = useRef<HTMLInputElement>(null);
  const bInputRef = useRef<HTMLInputElement>(null);
  const hexInputRef = useRef<HTMLInputElement>(null);
  // Which tab's view `beginTabPreview` actually hid — not necessarily
  // still `activeTabId` by the time the dropdown closes (the active tab
  // can change underneath an open dropdown, e.g. a `Ctrl+Tab` accelerator
  // firing while it's up), so restoring uses this instead of re-reading
  // the (possibly since-changed) prop.
  const hiddenTabIdRef = useRef<string | null>(null);

  const [rDraft, setRDraft] = useState(String(accent.r));
  const [gDraft, setGDraft] = useState(String(accent.g));
  const [bDraft, setBDraft] = useState(String(accent.b));
  const [hexDraft, setHexDraft] = useState(rgbToHex(accent).slice(1));

  const { h: hue, s, v } = useMemo(() => rgbToHsv(accent), [accent]);
  const hueColor = useMemo(() => rgbToHex(hueToRgb(hue)), [hue]);
  const ringThumb = useMemo(() => {
    const angleRad = (hue * Math.PI) / 180;
    return {
      left: WHEEL_SIZE_PX / 2 + RING_RADIUS_PX * Math.sin(angleRad),
      top: WHEEL_SIZE_PX / 2 - RING_RADIUS_PX * Math.cos(angleRad),
    };
  }, [hue]);

  // Same "draft resyncs only while not focused" pattern as `ZoomControl` —
  // a keystroke in one field must never get clobbered by the `accent`
  // update that same keystroke just triggered.
  useEffect(() => {
    if (document.activeElement !== rInputRef.current) setRDraft(String(accent.r));
    if (document.activeElement !== gInputRef.current) setGDraft(String(accent.g));
    if (document.activeElement !== bInputRef.current) setBDraft(String(accent.b));
    if (document.activeElement !== hexInputRef.current) setHexDraft(rgbToHex(accent).slice(1));
  }, [accent]);

  const closePicker = (): void => {
    setIsOpen(false);
    setPreviewImage(null);
    const hiddenTabId = hiddenTabIdRef.current;
    hiddenTabIdRef.current = null;
    if (hiddenTabId) {
      void window.northstar.endTabPreview(hiddenTabId);
    }
  };

  // The active tab changing while the dropdown is open (a menu
  // accelerator, not anything this component itself triggers) leaves
  // `hiddenTabIdRef` pointing at a tab that's no longer the one on
  // screen — simplest safe response is to close, which restores exactly
  // the tab `beginTabPreview` actually hid.
  useEffect(() => {
    if (isOpen && hiddenTabIdRef.current !== null && hiddenTabIdRef.current !== activeTabId) {
      closePicker();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reacts to `activeTabId` changing while open; re-running on `isOpen`'s own transitions would fire this right after `openPicker` sets it.
  }, [activeTabId]);

  // A dropdown left open when the toolbar itself goes away (e.g. the
  // window closing) must still restore whatever view it hid — nothing
  // else would.
  useEffect(
    () => () => {
      if (hiddenTabIdRef.current) {
        void window.northstar.endTabPreview(hiddenTabIdRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closePicker();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const openPicker = (): void => {
    const tabContent = document.querySelector('.tab-content');
    setContentRect(tabContent?.getBoundingClientRect() ?? null);
    setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setIsOpen(true);

    if (activeTabId) {
      hiddenTabIdRef.current = activeTabId;
      void window.northstar.beginTabPreview(activeTabId).then((result) => {
        if (result.ok) {
          setPreviewImage(result.data);
        }
      });
    }
  };

  /** Applies a new color everywhere it's synchronized — the square's thumb, the RGB/hex fields, and `--color-accent-rgb`. `commit` (a settle point: pointerup, blur, Enter, or picking a swatch) also files it into the recents list — a drag mid-gesture or a mid-keystroke draft doesn't, or the list would fill with noise instead of 10 deliberate choices. */
  const applyColor = (next: RGB, options?: { commit?: boolean }): void => {
    setAccent(next);
    if (options?.commit) {
      commitRecent(next);
    }
  };

  const updateFromSquarePointer = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean): void => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return;
    }
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    applyColor(hsvToRgb({ h: hue, s: x / rect.width, v: 1 - y / rect.height }), { commit });
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
    // where they were, same split Photoshop's ring+square picker uses.
    applyColor(hsvToRgb({ h: angle, s, v }), { commit });
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

  const handleChannelChange =
    (channel: keyof RGB, setDraft: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      // Digits only, capped at 3 — same "reject a keystroke that would
      // exceed the max" trick as `ZoomControl`'s own percent field.
      const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 3);
      if (digitsOnly !== '' && Number(digitsOnly) > 255) {
        return;
      }
      setDraft(digitsOnly);
      if (digitsOnly !== '') {
        applyColor({ ...accent, [channel]: Number(digitsOnly) });
      }
    };

  const commitChannel = (channel: keyof RGB, draft: string, setDraft: (value: string) => void): void => {
    const typed = Number(draft);
    const value = draft === '' || !Number.isFinite(typed) ? accent[channel] : clampChannel(typed);
    setDraft(String(value));
    applyColor({ ...accent, [channel]: value }, { commit: true });
  };

  const handleHexChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const digits = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexDraft(digits);
    if (digits.length === 3 || digits.length === 6) {
      const parsed = hexToRgb(digits);
      if (parsed) {
        applyColor(parsed);
      }
    }
  };

  const commitHex = (): void => {
    const parsed = hexToRgb(hexDraft);
    const next = parsed ?? accent;
    setHexDraft(rgbToHex(next).slice(1));
    applyColor(next, { commit: true });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={() => (isOpen ? closePicker() : openPicker())}
        aria-pressed={isOpen}
        aria-label="Accent color"
        data-tooltip="Accent color"
      >
        <ColorDropletIcon />
      </button>
      {isOpen &&
        createPortal(
          <div className="color-picker__backdrop" onClick={closePicker}>
            {contentRect && (
              <div
                className="color-picker__backdrop-frame"
                style={{
                  top: contentRect.top,
                  left: contentRect.left,
                  width: contentRect.width,
                  height: contentRect.height,
                }}
              >
                {previewImage && <img className="color-picker__preview" src={previewImage} alt="" aria-hidden="true" />}
              </div>
            )}
            {anchorRect && (
              <div
                className="color-picker__panel"
                role="dialog"
                aria-label="Accent color picker"
                style={{
                  top: anchorRect.bottom + 6,
                  left: Math.max(8, anchorRect.right - PANEL_WIDTH_PX),
                }}
                onClick={(event) => event.stopPropagation()}
              >
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
                <div className="color-picker__recents">
                  {Array.from({ length: RECENT_SLOTS }, (_, index) => recentColors[index] ?? null).map((color, index) => (
                    <button
                      // Keyed by fixed slot position, not by color identity —
                      // a swatch's color changes under a given slot as new
                      // picks push older ones along.
                      key={index}
                      type="button"
                      className="color-picker__recent"
                      style={color ? { background: rgbToHex(color) } : undefined}
                      disabled={!color}
                      aria-label={color ? `Recent color ${rgbToHex(color)}` : 'No recent color'}
                      onClick={() => color && applyColor(color, { commit: true })}
                    />
                  ))}
                </div>
                <div className="color-picker__fields">
                  <label className="color-picker__field">
                    <span className="color-picker__field-label">R</span>
                    <input
                      ref={rInputRef}
                      className="color-picker__field-input"
                      type="text"
                      inputMode="numeric"
                      value={rDraft}
                      onChange={handleChannelChange('r', setRDraft)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={() => commitChannel('r', rDraft, setRDraft)}
                      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                      aria-label="Red"
                    />
                  </label>
                  <label className="color-picker__field">
                    <span className="color-picker__field-label">G</span>
                    <input
                      ref={gInputRef}
                      className="color-picker__field-input"
                      type="text"
                      inputMode="numeric"
                      value={gDraft}
                      onChange={handleChannelChange('g', setGDraft)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={() => commitChannel('g', gDraft, setGDraft)}
                      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                      aria-label="Green"
                    />
                  </label>
                  <label className="color-picker__field">
                    <span className="color-picker__field-label">B</span>
                    <input
                      ref={bInputRef}
                      className="color-picker__field-input"
                      type="text"
                      inputMode="numeric"
                      value={bDraft}
                      onChange={handleChannelChange('b', setBDraft)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={() => commitChannel('b', bDraft, setBDraft)}
                      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                      aria-label="Blue"
                    />
                  </label>
                  <label className="color-picker__field color-picker__field--hex">
                    <span className="color-picker__field-label">#</span>
                    <input
                      ref={hexInputRef}
                      className="color-picker__field-input"
                      type="text"
                      value={hexDraft}
                      onChange={handleHexChange}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={commitHex}
                      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                      aria-label="Hex color"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
