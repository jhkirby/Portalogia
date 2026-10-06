// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { RGB } from '@shared/color';
import type { ColorPickerSyncPayload } from '@shared/ipc-contract';
import { clampChannel, hexToRgb, rgbToHex } from '../../lib/color';
import { ColorWheel } from '../ColorWheel';

/** How many of the most recently picked colors the swatch grid shows — two rows of five (see `.color-picker__recents`' `grid-template-columns`). */
const RECENT_SLOTS = 10;

const FALLBACK_ACCENT: RGB = { r: 26, g: 115, b: 232 };

/**
 * The whole of `color-picker.html`'s own page — `ColorPicker`'s dropdown
 * (hue ring, saturation/value square, recent-color swatches, RGB/hex
 * fields), rendered here instead of in the chrome's own DOM so it can sit
 * visually above the active tab's live `WebContentsView`, appearing
 * instantly, without that view ever needing to be hidden first (see
 * `ColorPickerOverlay` on the main-process side for why a chrome-drawn
 * dropdown can't do either of those).
 *
 * Owns the actual drag/type interaction itself — `localAccent` is this
 * view's own working color, updated immediately on every drag pixel or
 * keystroke for instant feedback, and reported up to the chrome's
 * `ColorPicker` on every change (`changeColor`) so it can apply
 * `--color-accent-rgb` and persist the choice. It only re-seeds
 * `localAccent` from a fresh sync's `accent` on the closed→open
 * transition (tracked via `wasOpenRef`) — once open, this view's own
 * state stays authoritative rather than fighting the round-tripped echo
 * of what it just reported.
 *
 * The square has no separate hue slider: dragging inside it only ever
 * changes saturation/value; `.color-picker__ring` around it is what
 * changes hue instead — same split Photoshop's own picker uses.
 */
export function ColorPickerOverlayView() {
  const [payload, setPayload] = useState<ColorPickerSyncPayload | null>(null);
  const [localAccent, setLocalAccent] = useState<RGB>(FALLBACK_ACCENT);
  const wasOpenRef = useRef(false);

  const rInputRef = useRef<HTMLInputElement>(null);
  const gInputRef = useRef<HTMLInputElement>(null);
  const bInputRef = useRef<HTMLInputElement>(null);
  const hexInputRef = useRef<HTMLInputElement>(null);

  const [rDraft, setRDraft] = useState(String(localAccent.r));
  const [gDraft, setGDraft] = useState(String(localAccent.g));
  const [bDraft, setBDraft] = useState(String(localAccent.b));
  const [hexDraft, setHexDraft] = useState(rgbToHex(localAccent).slice(1));

  useEffect(
    () =>
      window.northstarColorPicker.onSync((next) => {
        setPayload(next);
        if (next.open && !wasOpenRef.current) {
          setLocalAccent(next.accent);
        }
        wasOpenRef.current = next.open;
      }),
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.northstarColorPicker.requestClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Same "draft resyncs only while not focused" pattern as `ZoomControl` —
  // a keystroke in one field must never get clobbered by the `localAccent`
  // update that same keystroke just triggered.
  useEffect(() => {
    if (document.activeElement !== rInputRef.current) setRDraft(String(localAccent.r));
    if (document.activeElement !== gInputRef.current) setGDraft(String(localAccent.g));
    if (document.activeElement !== bInputRef.current) setBDraft(String(localAccent.b));
    if (document.activeElement !== hexInputRef.current) setHexDraft(rgbToHex(localAccent).slice(1));
  }, [localAccent]);

  /** Applies a new color locally (instant feedback) and reports it up to the chrome. `commit` (a settle point: pointerup, blur, Enter, or picking a swatch) is what tells the chrome to file it into the recents list — a drag mid-gesture or a mid-keystroke draft doesn't, or the list would fill with noise instead of 10 deliberate choices. */
  const applyColor = (next: RGB, options?: { commit?: boolean }): void => {
    setLocalAccent(next);
    window.northstarColorPicker.changeColor(next, options?.commit ?? false);
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
        applyColor({ ...localAccent, [channel]: Number(digitsOnly) });
      }
    };

  const commitChannel = (channel: keyof RGB, draft: string, setDraft: (value: string) => void): void => {
    const typed = Number(draft);
    const value = draft === '' || !Number.isFinite(typed) ? localAccent[channel] : clampChannel(typed);
    setDraft(String(value));
    applyColor({ ...localAccent, [channel]: value }, { commit: true });
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
    const next = parsed ?? localAccent;
    setHexDraft(rgbToHex(next).slice(1));
    applyColor(next, { commit: true });
  };

  if (!payload || !payload.open) {
    return null;
  }

  const recentColors = payload.recentColors;

  return (
    <div className="color-picker__panel" role="dialog" aria-label="Accent color picker">
      <ColorWheel value={localAccent} onChange={(next, commit) => applyColor(next, { commit })} />
      <div className="color-picker__recents">
        {Array.from({ length: RECENT_SLOTS }, (_, index) => recentColors[index] ?? null).map((color, index) => (
          <button
            // Keyed by fixed slot position, not by color identity — a
            // swatch's color changes under a given slot as new picks push
            // older ones along.
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
  );
}
