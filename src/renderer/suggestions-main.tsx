// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AddressSuggestionsView } from './components/AddressSuggestions';

// This page's own document is a separate renderer from the chrome's, so it
// doesn't inherit `<html data-theme>` the way the chrome's own DOM does
// (see `useTheme`) — `colors.css`'s tokens key off that attribute, not
// `prefers-color-scheme` directly. Setting it here from `matchMedia`
// instead works because `setNativeTheme` (part of `useTheme`) mirrors the
// chrome's choice onto `nativeTheme.themeSource` process-wide, which in
// turn drives `prefers-color-scheme` for every renderer, this one
// included — the same mechanism `Terminal.tsx`'s own `xtermThemes.ts`
// already relies on for its theme, just applied to an attribute instead of
// picking an object.
function applyTheme(): void {
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from suggestions.html');
}

createRoot(container).render(
  <StrictMode>
    <AddressSuggestionsView />
  </StrictMode>,
);
