// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import type {
  PortalogiaAddressSuggestionsApi,
  PortalogiaApi,
  PortalogiaColorPickerApi,
  PortalogiaExportMenuApi,
  PortalogiaFindApi,
  PortalogiaHistoryApi,
  PortalogiaBookmarksApi,
  PortalogiaMarkdownApi,
  PortalogiaPdfApi,
  PortalogiaSecretPromptApi,
  PortalogiaSecretsApi,
  PortalogiaTerminalApi,
  PortalogiaTooltipApi,
} from '@shared/ipc-contract';

declare global {
  interface Window {
    /** The bridge exposed by the chrome's preload script via `contextBridge`. Only present in `index.html`'s page. */
    readonly portalogia: PortalogiaApi;
    /** The bridge exposed by a terminal tab's own preload script (`src/preload/terminal.ts`). Only present in `terminal.html`'s page. */
    readonly portalogiaTerminal: PortalogiaTerminalApi;
    /** The bridge exposed by the address suggestions overlay's own preload script (`src/preload/suggestions.ts`). Only present in `suggestions.html`'s page. */
    readonly portalogiaSuggestions: PortalogiaAddressSuggestionsApi;
    /** The bridge exposed by the tooltip overlay's own preload script (`src/preload/tooltip.ts`). Only present in `tooltip.html`'s page. */
    readonly portalogiaTooltip: PortalogiaTooltipApi;
    /** The bridge exposed by the color picker overlay's own preload script (`src/preload/colorPicker.ts`). Only present in `color-picker.html`'s page. */
    readonly portalogiaColorPicker: PortalogiaColorPickerApi;
    /** The bridge exposed by the export menu overlay's own preload script (`src/preload/exportMenu.ts`). Only present in `export-menu.html`'s page. */
    readonly portalogiaExportMenu: PortalogiaExportMenuApi;
    /** The bridge exposed by a PDF tab's own preload script (`src/preload/pdf.ts`). Only present in `pdf.html`'s page. */
    readonly portalogiaPdf: PortalogiaPdfApi;
    /** The bridge exposed by a Markdown tab's own preload script (`src/preload/markdown.ts`). Only present in `markdown.html`'s page. */
    readonly portalogiaMarkdown: PortalogiaMarkdownApi;
    /** The bridge exposed by a History tab's own preload script (`src/preload/history.ts`). Only present in `history.html`'s page. */
    readonly portalogiaHistory: PortalogiaHistoryApi;
    /** The bridge exposed by a Bookmarks tab's own preload script (`src/preload/bookmarks.ts`). Only present in `bookmarks.html`'s page. */
    readonly portalogiaBookmarks: PortalogiaBookmarksApi;
    /** The bridge exposed by a Secrets tab's own preload script (`src/preload/secrets.ts`). Only present in `secrets.html`'s page. */
    readonly portalogiaSecrets: PortalogiaSecretsApi;
    /** The bridge exposed by the save prompt's own preload script (`src/preload/secretPrompt.ts`). Only present in `secret-prompt.html`'s page. */
    readonly portalogiaSecretPrompt: PortalogiaSecretPromptApi;
    /** The bridge exposed by the find bar's own preload script (`src/preload/find.ts`). Only present in `find.html`'s page. */
    readonly portalogiaFind: PortalogiaFindApi;
  }
}

export {};
