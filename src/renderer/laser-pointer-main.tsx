// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LaserPointerOverlayView } from './components/LaserPointerOverlay';

// This page never shows any themed chrome UI (no panels, no text), just a
// canvas drawn in the current accent color, so unlike `color-picker-main.tsx`
// / `suggestions-main.tsx` it has no need for `applyTheme()` — there's no
// `data-theme`-keyed CSS here at all.

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from laser-pointer.html');
}

createRoot(container).render(
  <StrictMode>
    <LaserPointerOverlayView />
  </StrictMode>,
);
