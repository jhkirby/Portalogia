// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HistoryViewer } from './components/HistoryViewer';
import { watchAccentColor } from './lib/accentStorage';
import { followSystemTheme } from './lib/themeFade';

// A separate renderer from the chrome's, so it doesn't inherit `<html data-theme>` (what colors.css's tokens key off):
// it follows the system theme, which main sets to the chrome's choice (`nativeTheme.themeSource`), and fades on a
// switch (`followSystemTheme`).
followSystemTheme();
watchAccentColor();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from history.html');
}

createRoot(container).render(
  <StrictMode>
    <HistoryViewer />
  </StrictMode>,
);
