// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorPickerOverlayView } from './components/ColorPickerOverlay';
import { watchAccentColor } from './lib/accentStorage';

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

// Same reasoning as `applyTheme` above, but for the accent color
// (`.color-picker__field:focus-within`'s border) — see
// `watchAccentColor`'s own doc comment. Everything else this page draws
// from the *current* accent (the square's gradient, the ring's thumb)
// comes from `ColorPickerOverlayView`'s own `onSync` payload instead,
// since that's live-dragged state the chrome already tracks precisely —
// this only covers what's left over as a plain CSS token.
watchAccentColor();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from color-picker.html');
}

createRoot(container).render(
  <StrictMode>
    <ColorPickerOverlayView />
  </StrictMode>,
);
