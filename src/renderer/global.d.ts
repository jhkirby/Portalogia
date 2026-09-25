// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-11

import type {
  NorthstarAddressSuggestionsApi,
  NorthstarApi,
  NorthstarColorPickerApi,
  NorthstarTerminalApi,
  NorthstarTooltipApi,
} from '@shared/ipc-contract';

declare global {
  interface Window {
    /** The bridge exposed by the chrome's preload script via `contextBridge`. Only present in `index.html`'s page. */
    readonly northstar: NorthstarApi;
    /** The bridge exposed by a terminal tab's own preload script (`src/preload/terminal.ts`). Only present in `terminal.html`'s page. */
    readonly northstarTerminal: NorthstarTerminalApi;
    /** The bridge exposed by the address suggestions overlay's own preload script (`src/preload/suggestions.ts`). Only present in `suggestions.html`'s page. */
    readonly northstarSuggestions: NorthstarAddressSuggestionsApi;
    /** The bridge exposed by the tooltip overlay's own preload script (`src/preload/tooltip.ts`). Only present in `tooltip.html`'s page. */
    readonly northstarTooltip: NorthstarTooltipApi;
    /** The bridge exposed by the color picker overlay's own preload script (`src/preload/colorPicker.ts`). Only present in `color-picker.html`'s page. */
    readonly northstarColorPicker: NorthstarColorPickerApi;
  }
}

export {};
