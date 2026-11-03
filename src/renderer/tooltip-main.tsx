// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipOverlayView } from './components/TooltipOverlay';
import { watchAccentColor } from './lib/accentStorage';
import { followSystemTheme } from './lib/themeFade';

// A separate renderer from the chrome's, so it doesn't inherit `<html data-theme>` (what colors.css's tokens key off):
// it follows the system theme, which main sets to the chrome's choice (`nativeTheme.themeSource`), and fades on a
// switch (`followSystemTheme`).
followSystemTheme();

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
