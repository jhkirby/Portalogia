// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FindBar } from './components/FindBar';
import { watchAccentColor } from './lib/accentStorage';

// Separate renderer from the chrome's, so it doesn't inherit `data-theme`
// — same fix as `history-main.tsx`'s `applyTheme`.
function applyTheme(): void {
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
watchAccentColor();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from find.html');
}

createRoot(container).render(
  <StrictMode>
    <FindBar />
  </StrictMode>,
);
