// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PdfViewer } from './components/PdfViewer';
import { watchAccentColor } from './lib/accentStorage';

// Separate renderer from the chrome's, so it doesn't inherit `data-theme`
// — same fix as `color-picker-main.tsx`'s `applyTheme`.
function applyTheme(): void {
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
watchAccentColor();

// Loaded once per PDF tab with its own `?id=` (see `TabManager.createPdfTab`).
const id = new URLSearchParams(location.search).get('id');
if (!id) {
  throw new Error('pdf.html loaded without a `?id=` query param');
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from pdf.html');
}

createRoot(container).render(
  <StrictMode>
    <PdfViewer tabId={id} />
  </StrictMode>,
);
