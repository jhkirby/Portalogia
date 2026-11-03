// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installChromeTooltips } from './lib/chromeTooltips';

// Every `.chrome-tooltip` in the chrome is shown above everything in the window, never off its edge.
installChromeTooltips();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
