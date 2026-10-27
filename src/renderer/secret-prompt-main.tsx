// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SecretPrompt } from './components/SecretPrompt';
import { watchAccentColor } from './lib/accentStorage';
import { followSystemTheme } from './lib/themeFade';

// A separate renderer from the chrome's, so it follows the system theme the way the export menu does (see
// `export-menu-main.tsx`).
followSystemTheme();
watchAccentColor();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from secret-prompt.html');
}

createRoot(container).render(
  <StrictMode>
    <SecretPrompt />
  </StrictMode>,
);
