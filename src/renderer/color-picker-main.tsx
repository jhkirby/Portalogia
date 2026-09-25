// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorPickerOverlayView } from './components/ColorPickerOverlay';

// This page's own document is a separate renderer from the chrome's, so it
// doesn't inherit `<html data-theme>` the way the chrome's own DOM does
// (see `useTheme`) — same reasoning and same fix as `suggestions-main.tsx`'s
// own `applyTheme`.
function applyTheme(): void {
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from color-picker.html');
}

createRoot(container).render(
  <StrictMode>
    <ColorPickerOverlayView />
  </StrictMode>,
);
