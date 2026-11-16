// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PdfViewer } from './components/PdfViewer';
import { watchAccentColor } from './lib/accentStorage';
import { trackPageFocus } from './lib/pageFocus';
import { followSystemTheme } from './lib/themeFade';

// A separate renderer from the chrome's, so it doesn't inherit `<html data-theme>` (what colors.css's tokens key off):
// it follows the system theme, which main sets to the chrome's choice (`nativeTheme.themeSource`), and fades on a
// switch (`followSystemTheme`).
followSystemTheme();
watchAccentColor();
// The frame around the content lights up in the accent while this page has the keyboard.
trackPageFocus();

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
    <PdfViewer />
  </StrictMode>,
);
