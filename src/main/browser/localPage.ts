// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { pathToFileURL } from 'node:url';

/** The kinds of file a web tab opens from the computer: a web page, saved alone or as one archive. */
export const LOCAL_PAGE_EXTENSIONS = ['html', 'htm', 'xhtml', 'mhtml', 'mht'] as const;

/**
 * The `file:` address a web tab loads for a page the user picked from the open dialog — the one way a tab may show a
 * `file:` address (`isNavigableUrl` refuses them everywhere else). Only a page on a drive of this computer: a network
 * share (`\\server\share\…`, or the same path with forward slashes) is refused, since loading it would make Windows
 * hand the user's sign-in to that server.
 * @param path The file's path, as the open dialog gave it.
 * @param platform The OS the app runs on; `process.platform` unless a test says otherwise.
 * @returns The address to load, or `null` for a path that isn't a local file.
 */
export function localPageUrl(path: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32') {
    // A drive letter, then a separator: `C:\…`. Rules out UNC (`\\…`, `//…`) and device (`\\?\…`) paths.
    if (!/^[a-zA-Z]:[\\/]/.test(path)) {
      return null;
    }
    return pathToFileURL(path, { windows: true }).toString();
  }
  // An absolute path, not one naming a network host (`//host/…`).
  if (!path.startsWith('/') || path.startsWith('//')) {
    return null;
  }
  return pathToFileURL(path, { windows: false }).toString();
}
