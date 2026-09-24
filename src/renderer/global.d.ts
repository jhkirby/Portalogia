// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-11

import type { NorthstarApi, NorthstarTerminalApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    /** The bridge exposed by the chrome's preload script via `contextBridge`. Only present in `index.html`'s page. */
    readonly northstar: NorthstarApi;
    /** The bridge exposed by a terminal tab's own preload script (`src/preload/terminal.ts`). Only present in `terminal.html`'s page. */
    readonly northstarTerminal: NorthstarTerminalApi;
  }
}

export {};
