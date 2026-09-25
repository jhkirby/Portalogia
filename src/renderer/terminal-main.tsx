// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from './components/Terminal';
import { watchAccentColor } from './lib/accentStorage';

// `colors.css`'s `::selection` rule (this page loads it too) reads
// `--color-accent-rgb` the same as every other page — xterm's own
// canvas-rendered selection highlight is handled separately
// (`xtermThemes.ts`, since it isn't ordinary DOM text CSS can reach at
// all), but this still covers any plain selectable text this page ever
// renders outside the terminal itself. See `watchAccentColor`'s own doc
// comment.
watchAccentColor();

// This page is loaded once per terminal tab, each with its own `?id=` (see
// `TabManager.createTerminalTab`) — there's no chrome here to pass it down
// as a prop from, so it's read straight off the page's own URL instead.
const id = new URLSearchParams(location.search).get('id');
if (!id) {
  throw new Error('terminal.html loaded without a `?id=` query param');
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from terminal.html');
}

createRoot(container).render(
  <StrictMode>
    <Terminal id={id} />
  </StrictMode>,
);
