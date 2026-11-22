// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SecretsViewer } from './components/SecretsViewer';
import { watchAccentColor } from './lib/accentStorage';
import { trackPageHover } from './lib/pageFocus';
import { followSystemTheme } from './lib/themeFade';

// A separate renderer from the chrome's, so it follows the system theme the way the Bookmarks page does (see
// `bookmarks-main.tsx`).
followSystemTheme();
watchAccentColor();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from secrets.html');
}

// The pointer over the table: its frame glows softly (history-viewer.css).
trackPageHover();

createRoot(container).render(
  <StrictMode>
    <SecretsViewer />
  </StrictMode>,
);
