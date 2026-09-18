// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The e2e suite launches the built app directly (`out/main/index.js`), not
 * the dev server — `electron-vite dev`'s hot-reload has nothing to do with
 * what a real install runs. Rebuilding here on every run means a stale
 * `out/` can never make a test pass (or fail) for the wrong reason.
 */
export default function globalSetup(): void {
  execSync('npm run build', { stdio: 'inherit', cwd: ROOT_DIR });
}
