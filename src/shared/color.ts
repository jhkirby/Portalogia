// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

/**
 * An 8-bit-per-channel color — shared shape only (the conversion math lives
 * in `src/renderer/lib/color.ts`, renderer-only). Lives in `@shared` rather
 * than there because `ColorPickerOverlay` (main) and `ipc-contract.ts` both
 * need the shape too: it's what crosses the `ColorPickerSync`/
 * `ColorPickerColorChanged` boundary between the chrome and the picker's
 * own overlay `WebContentsView`.
 */
export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
