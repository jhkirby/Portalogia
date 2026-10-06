// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import { MarkdownViewer } from './components/MarkdownViewer';
import { watchAccentColor } from './lib/accentStorage';

// Separate renderer from the chrome's, so it doesn't inherit `data-theme`
// — same fix as `pdf-main.tsx`'s `applyTheme`.
function applyTheme(): void {
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
watchAccentColor();

// Loaded once per Markdown tab with its own `?id=` (see `TabManager.createMarkdownTab`).
if (!new URLSearchParams(location.search).get('id')) {
  throw new Error('markdown.html loaded without a `?id=` query param');
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from markdown.html');
}

createRoot(container).render(
  <StrictMode>
    <MarkdownViewer />
  </StrictMode>,
);
