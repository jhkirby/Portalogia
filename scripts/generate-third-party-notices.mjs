// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

/**
 * Writes license/THIRD_PARTY_NOTICES.txt: the license text of every production
 * dependency. MIT/BSD/Apache all require their notices travel with
 * redistributed copies, and MPL-2.0 additionally requires telling recipients
 * where the source is - so this is generated rather than maintained by hand.
 */

import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { init as checkLicenses } from 'license-checker-rseidelsohn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(root, 'license', 'THIRD_PARTY_NOTICES.txt');
const rule = '='.repeat(78);

/**
 * Reads a package's bundled license file, if it has one.
 *
 * @param {string | undefined} licenseFile Path reported by license-checker.
 * @returns {string} The file's text, or '' when the package ships none
 *   (license-checker sometimes points at a README instead, which isn't a
 *   license and would bloat the file).
 */
function readLicenseText(licenseFile) {
  if (!licenseFile || /readme/i.test(licenseFile)) {
    return '';
  }
  return readFileSync(licenseFile, 'utf8').trim();
}

/**
 * Formats one dependency's section of the notices file.
 *
 * @param {string} id `name@version`.
 * @param {{ licenses?: string | string[], repository?: string, publisher?: string, licenseFile?: string }} info
 * @returns {string} The section text.
 */
function formatEntry(id, info) {
  const licenses = [info.licenses ?? 'UNKNOWN'].flat().join(', ');
  const lines = [rule, id, `License: ${licenses}`];
  if (info.publisher) lines.push(`Author: ${info.publisher}`);
  if (info.repository) lines.push(`Source: ${info.repository}`);
  const text = readLicenseText(info.licenseFile);
  lines.push('', text || `(No license file shipped; see the ${licenses} license.)`, '');
  return lines.join('\n');
}

const packages = await promisify(checkLicenses)({ start: root, production: true, excludePrivatePackages: true });

const header = `Portalogia - Third-Party Notices

Portalogia includes the open-source software listed below. Each component is
the property of its respective authors and is used under the license shown.
Portalogia's own license (see LICENSE) does not apply to these components.

Components licensed under the Mozilla Public License 2.0 (MPL-2.0) are
included unmodified. Their source code is available from the "Source"
repository listed with each one, and from the npm registry
(https://www.npmjs.com/) under the same name and version.

Electron and Chromium notices are in LICENSE.electron.txt and
LICENSES.chromium.html, distributed alongside the Portalogia executable.

`;

const body = Object.entries(packages)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, info]) => formatEntry(id, info))
  .join('\n');

writeFileSync(outputPath, header + body, 'utf8');
console.log(`Wrote ${Object.keys(packages).length} components to ${outputPath}`);
