// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipOverlayView } from './components/TooltipOverlay';
import { watchAccentColor } from './lib/accentStorage';

// This page's own document is a separate renderer from the chrome's, so it
// doesn't inherit `<html data-theme>` the way the chrome's own DOM does —
// same reasoning (and same mechanism) as `suggestions-main.tsx`'s own
// `applyTheme`.
function applyTheme(): void {
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// This page loads `colors.css` too, whose `::selection` rule (like every
// other accent-derived token) needs `--color-accent-rgb` set here
// explicitly — see `watchAccentColor`'s own doc comment. Nothing in a
// tooltip is normally selectable, but there's no reason for this page to
// be the one exception that's still stuck on the hard-coded default.
watchAccentColor();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from tooltip.html');
}

createRoot(container).render(
  <StrictMode>
    <TooltipOverlayView />
  </StrictMode>,
);
