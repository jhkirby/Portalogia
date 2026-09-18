// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-11

import type { NorthstarApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    /** The bridge exposed by the preload script via `contextBridge`. */
    readonly northstar: NorthstarApi;
  }
}

export {};
