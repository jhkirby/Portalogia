// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from './components/Terminal';

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
