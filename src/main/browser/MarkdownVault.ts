// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { lookup } from 'node:dns/promises';
import { readdir, stat } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { basename, dirname, extname, isAbsolute, join, parse as parsePath, relative, resolve, sep } from 'node:path';
import type { MarkdownBacklink } from '@shared/ipc-contract';
import { splitWikiTarget } from '@shared/markdown/parser';
import { readFileCapped } from '../platform/readFileCapped';

/** The files a note can be: `.md` and `.markdown`. */
export const MARKDOWN_EXTENSION_PATTERN = /\.(md|markdown)$/i;

/** Past this a note is not opened: it is text, so this is generous, and it bounds what is read into memory and sent to the page. */
export const MAX_NOTE_BYTES = 20 * 1024 * 1024;

/** The largest picture read for a note, as it travels to the page base64-encoded. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Folders a scan of a note's folder tree never goes into. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.obsidian', '.trash']);

/** A scan stops here, so opening a note in a huge folder (a home directory) can't stall on listing it. */
const MAX_SCAN_FILES = 5000;
const MAX_SCAN_DEPTH = 10;

/** How far up from a note to look for the `.obsidian` folder that marks a vault's top. */
const MAX_VAULT_LOOKUP_LEVELS = 10;

/** How long a scan of a vault is reused — resolving a note's every link would otherwise rescan the folder per link. */
const SCAN_CACHE_MS = 4000;

/** The most notes a backlink search reads, and the most of each it reads. */
const MAX_BACKLINK_FILES = 3000;
const MAX_BACKLINK_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BACKLINKS = 200;
const BACKLINK_READ_CONCURRENCY = 16;

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

/** Windows paths are case-insensitive, so two spellings of one file must match. */
export function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Whether `path` names a note by its extension. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSION_PATTERN.test(path);
}

/**
 * Whether a link's target is a plain file path this app may read: not a web
 * address or other scheme, and not a network share (reading `\\host\share`
 * makes Windows send the user's credentials to that host).
 */
function isLocalPathText(target: string): boolean {
  if (target.startsWith('\\\\') || target.startsWith('//')) {
    return false;
  }
  return !/^[a-z][a-z0-9+.-]+:/i.test(target) || /^[a-z]:[\\/]/i.test(target);
}

/**
 * Whether a path lies inside one of the folders a note may reach: its vault, or (outside a vault) its own folder and
 * the one above, the same places `![[name]]` embeds are looked for. A note is untrusted text, so `C:/Users/...` or a
 * run of `../` must not let it read any file on the disk.
 * @param path An absolute path.
 * @param roots The folders allowed, from `searchRoots`.
 */
function isWithinRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const fromRoot = relative(root, path);
    return fromRoot !== '' && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
  });
}

/** `decodeURIComponent` that gives the text back unchanged if it isn't validly encoded. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A path with `/` separators, however the platform writes it — how a link is written. */
function toLinkPath(path: string): string {
  return path.split(sep).join('/');
}

/** A note's name with its extension taken off, for matching against `[[Name]]`. */
function noteStem(path: string): string {
  return basename(path).replace(MARKDOWN_EXTENSION_PATTERN, '');
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The folders to look for a note or picture by name, best first: the vault's
 * own top, and — when the note isn't in a marked vault (a loose folder of
 * notes) — the folder above it as a second chance, so `docs/guide/a.md` can
 * still link to `docs/b.md`.
 * @param notePath The note doing the looking.
 */
async function searchRoots(notePath: string): Promise<string[]> {
  const root = await findVaultRoot(notePath);
  const hasMarker = !samePath(root, dirname(notePath));
  const parent = dirname(root);
  return hasMarker || parent === root ? [root] : [root, parent];
}

/**
 * The top of the vault a note belongs to: the nearest folder above it
 * holding an `.obsidian` folder (so a real Obsidian vault resolves links the
 * way Obsidian does), or else the note's own folder.
 * @param notePath The note's path.
 */
export async function findVaultRoot(notePath: string): Promise<string> {
  let directory = dirname(notePath);
  for (let level = 0; level < MAX_VAULT_LOOKUP_LEVELS; level += 1) {
    try {
      if ((await stat(join(directory, '.obsidian'))).isDirectory()) {
        return directory;
      }
    } catch {
      // No marker here; keep climbing.
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return dirname(notePath);
}

interface CachedScan {
  readonly at: number;
  readonly files: readonly string[];
}
const scanCache = new Map<string, CachedScan>();

/**
 * Every file under `root` (folders starting with `.`, and `node_modules`,
 * left out), for finding a note or picture by name. Capped in count and depth,
 * and reused for a few seconds.
 * @param root The folder to scan.
 */
async function scanFiles(root: string): Promise<readonly string[]> {
  const cached = scanCache.get(root);
  if (cached && Date.now() - cached.at < SCAN_CACHE_MS) {
    return cached.files;
  }
  const files: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    // Files first so a shallow match is found before a deep folder eats the budget.
    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES) {
        return;
      }
      if (entry.isFile()) {
        files.push(join(directory, entry.name));
      }
    }
    if (depth >= MAX_SCAN_DEPTH) {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
        await walk(join(directory, entry.name), depth + 1);
      }
    }
  };
  await walk(root, 0);
  scanCache.set(root, { at: Date.now(), files });
  return files;
}

/** Every note under `root`. */
async function scanNotes(root: string): Promise<string[]> {
  return (await scanFiles(root)).filter(isMarkdownPath);
}

/** Forgets the cached scans — call after creating or renaming a note so the next lookup sees it. */
export function forgetVaultScans(): void {
  scanCache.clear();
}

/**
 * Picks the best of several files that match a name: one beside the current
 * note, else the one nearest the vault's top, else alphabetically first.
 */
function bestMatch(candidates: readonly string[], currentDirectory: string, root: string): string | null {
  const ranked = [...candidates].sort((a, b) => {
    const aBeside = samePath(dirname(a), currentDirectory) ? 0 : 1;
    const bBeside = samePath(dirname(b), currentDirectory) ? 0 : 1;
    if (aBeside !== bBeside) {
      return aBeside - bBeside;
    }
    const aDepth = relative(root, a).split(sep).length;
    const bDepth = relative(root, b).split(sep).length;
    return aDepth !== bDepth ? aDepth - bDepth : a.localeCompare(b);
  });
  return ranked[0] ?? null;
}

/**
 * The note a `[[wikilink]]` names, found the way Obsidian finds it: by name
 * anywhere in the vault (a `folder/Note` target must match the end of the
 * note's path), preferring one in the same folder as the note that links.
 * @param currentPath The note holding the link.
 * @param target The text inside the brackets (heading and alias allowed).
 * @returns The note's path, or `null` if no note has that name.
 */
export async function resolveWikiTarget(currentPath: string, target: string): Promise<string | null> {
  const { name } = splitWikiTarget(target);
  const wanted = name.replace(MARKDOWN_EXTENSION_PATTERN, '').replace(/\\/g, '/').toLowerCase();
  if (wanted === '') {
    // `[[#Heading]]` links within the note itself.
    return currentPath;
  }
  for (const root of await searchRoots(currentPath)) {
    const matches = (await scanNotes(root)).filter((note) => {
      const path = toLinkPath(relative(root, note)).replace(MARKDOWN_EXTENSION_PATTERN, '').toLowerCase();
      return wanted.includes('/') ? path === wanted || path.endsWith(`/${wanted}`) : path.split('/').pop() === wanted;
    });
    const best = bestMatch(matches, dirname(currentPath), root);
    if (best !== null) {
      return best;
    }
  }
  return null;
}

/**
 * The note an ordinary Markdown link points at, if it points at a note that
 * exists: relative to the note holding the link (or absolute), with any
 * `#heading` dropped. Only a note inside the linking note's vault counts (see `isWithinRoots`).
 * @param currentPath The note holding the link.
 * @param target The link's address.
 */
export async function resolveLinkTarget(currentPath: string, target: string): Promise<string | null> {
  const withoutFragment = target.split('#')[0] ?? '';
  if (withoutFragment === '' || !isLocalPathText(withoutFragment)) {
    return null;
  }
  const roots = await searchRoots(currentPath);
  for (const text of new Set([withoutFragment, safeDecode(withoutFragment)])) {
    const path = resolve(dirname(currentPath), text);
    if (isMarkdownPath(path) && isWithinRoots(path, roots) && (await isFile(path))) {
      return path;
    }
  }
  return null;
}

/**
 * Which of a note's `[[wikilinks]]` name a note that exists.
 * @param currentPath The note holding the links.
 * @param names The text inside each link's brackets.
 */
export async function resolveWikiLinks(
  currentPath: string,
  names: readonly string[],
): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const name of new Set(names)) {
    result[name] = (await resolveWikiTarget(currentPath, name)) !== null;
  }
  return result;
}

/**
 * The names of the notes in a note's vault (file names without the extension,
 * a name shared by notes in different folders listed with its folder), for
 * completing `[[` as it is typed.
 * @param currentPath The note being edited.
 */
export async function listNoteNames(currentPath: string): Promise<string[]> {
  const root = await findVaultRoot(currentPath);
  const notes = (await scanNotes(root)).filter((note) => !samePath(note, currentPath));
  const stems = notes.map((note) => noteStem(note));
  const duplicated = new Set(stems.filter((stem, index) => stems.indexOf(stem) !== index).map((stem) => stem.toLowerCase()));
  return notes
    .map((note) => {
      const stem = noteStem(note);
      return duplicated.has(stem.toLowerCase())
        ? toLinkPath(relative(root, note)).replace(MARKDOWN_EXTENSION_PATTERN, '')
        : stem;
    })
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The notes in a file's vault that link to it, by `[[wikilink]]` (or `![[embed]]`) or by an ordinary relative link.
 * The file is a note or any other file a note can link to (a PDF): a note is named without its extension, as
 * Obsidian writes `[[Note]]`, and any other file with it (`[[Paper.pdf]]`).
 * @param currentPath The file to find links to.
 * @returns Up to `MAX_BACKLINKS`, each with the path from `currentPath`'s folder that opens it.
 */
export async function findBacklinks(currentPath: string): Promise<MarkdownBacklink[]> {
  const root = await findVaultRoot(currentPath);
  const notes = (await scanNotes(root)).filter((note) => !samePath(note, currentPath)).slice(0, MAX_BACKLINK_FILES);
  const isNote = isMarkdownPath(currentPath);
  const stem = (isNote ? noteStem(currentPath) : basename(currentPath)).toLowerCase();
  const pathFromRoot = toLinkPath(relative(root, currentPath)).replace(MARKDOWN_EXTENSION_PATTERN, '').toLowerCase();
  // An ordinary link names the file with its extension: `.md`/`.markdown` for a note, the file's own otherwise.
  const extension = isNote ? '(?:md|markdown)' : extname(currentPath).slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const relativeLinkPattern = new RegExp(`\\]\\(([^)\\s]+\\.${extension})(?:#[^)\\s]*)?\\)`, 'gi');
  const found: MarkdownBacklink[] = [];

  const links = (note: string, text: string): boolean => {
    for (const match of text.matchAll(/\[\[([^[\]\n]+?)\]\]/g)) {
      const { name } = splitWikiTarget(match[1] ?? '');
      const wanted = name.replace(MARKDOWN_EXTENSION_PATTERN, '').replace(/\\/g, '/').toLowerCase();
      if (wanted === stem || (wanted.includes('/') && (wanted === pathFromRoot || pathFromRoot.endsWith(`/${wanted}`)))) {
        return true;
      }
    }
    for (const match of text.matchAll(relativeLinkPattern)) {
      const text2 = match[1] ?? '';
      if (!isLocalPathText(text2)) {
        continue;
      }
      for (const candidate of new Set([text2, safeDecode(text2)])) {
        if (samePath(isAbsolute(candidate) ? candidate : resolve(dirname(note), candidate), currentPath)) {
          return true;
        }
      }
    }
    return false;
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    while (found.length < MAX_BACKLINKS) {
      const index = next;
      next += 1;
      const note = notes[index];
      if (note === undefined) {
        return;
      }
      try {
        const read = await readFileCapped(note, MAX_BACKLINK_FILE_BYTES);
        if (read.kind !== 'ok') {
          continue;
        }
        if (links(note, read.data.toString('utf-8'))) {
          found.push({ name: noteStem(note), target: toLinkPath(relative(dirname(currentPath), note)) });
        }
      } catch {
        // Unreadable: it can't be said to link here.
      }
    }
  };
  await Promise.all(Array.from({ length: BACKLINK_READ_CONCURRENCY }, worker));
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A picture a note shows, as a `data:` URL: an `![[embed]]` name found
 * anywhere in the vault, or an ordinary image path relative to the note.
 * Only picture file types are read, and only up to a size cap.
 * @param currentPath The note showing the picture.
 * @param src The embed's name or the image's path.
 * @param isPicked Whether the user picked this exact file in the image dialog — the one way a picture outside the
 *   note's folders may be shown (see `PickedImageStore`).
 * @returns The data URL, or `null` if it can't be read.
 */
export async function readImageDataUrl(
  currentPath: string,
  src: string,
  isPicked: (path: string) => boolean = () => false,
): Promise<string | null> {
  if (!isLocalPathText(src)) {
    return null;
  }
  const withoutFragment = src.split('#')[0] ?? '';
  let found: string | null = null;
  const roots = await searchRoots(currentPath);
  for (const text of new Set([withoutFragment, safeDecode(withoutFragment)])) {
    const path = resolve(dirname(currentPath), text);
    if (extname(path).toLowerCase() in IMAGE_MIME_TYPES && (isWithinRoots(path, roots) || isPicked(path)) && (await isFile(path))) {
      found = path;
      break;
    }
  }
  if (found === null) {
    // `![[name.png]]` names a file anywhere in the vault.
    const wanted = basename(safeDecode(withoutFragment)).toLowerCase();
    if (!(extname(wanted) in IMAGE_MIME_TYPES)) {
      return null;
    }
    for (const root of roots) {
      const matches = (await scanFiles(root)).filter((file) => basename(file).toLowerCase() === wanted);
      found = bestMatch(matches, dirname(currentPath), root);
      if (found !== null) {
        break;
      }
    }
  }
  if (found === null) {
    return null;
  }
  try {
    const read = await readFileCapped(found, MAX_IMAGE_BYTES);
    if (read.kind !== 'ok') {
      return null;
    }
    const mime = IMAGE_MIME_TYPES[extname(found).toLowerCase()] ?? 'application/octet-stream';
    return `data:${mime};base64,${read.data.toString('base64')}`;
  } catch {
    return null;
  }
}

/** The picture types the formatted editor's image dialog offers — the ones `readImageDataUrl` can show. */
export const PICKABLE_IMAGE_EXTENSIONS: readonly string[] = Object.keys(IMAGE_MIME_TYPES).map((extension) => extension.slice(1));

/**
 * How a note links to a picture the user picked: a path relative to the
 * note's folder with `/` separators (as Obsidian and the web write it), each
 * part URL-encoded so spaces and brackets can't end the link early. A picture
 * on another drive can't be reached relatively, so it gets its absolute path.
 * @param notePath The note's absolute path.
 * @param imagePath The picture's absolute path.
 * @param pathApi The path functions to use (Windows or POSIX) — injected for testing.
 */
export function imageLinkFor(
  notePath: string,
  imagePath: string,
  pathApi: Pick<typeof import('node:path'), 'dirname' | 'relative' | 'parse'> = { dirname, relative, parse: parsePath },
): string {
  const from = pathApi.dirname(notePath);
  const sameRoot = pathApi.parse(from).root.toLowerCase() === pathApi.parse(imagePath).root.toLowerCase();
  const raw = (sameRoot ? pathApi.relative(from, imagePath) : imagePath).replace(/\\/g, '/');
  return raw
    .split('/')
    .map((part, index) => (index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
    .join('/');
}

/** How long a web picture may take to arrive before it's given up on. */
const REMOTE_IMAGE_TIMEOUT_MS = 15_000;

/** How many redirects a web picture may take; each one's destination is checked like the first. */
const MAX_IMAGE_REDIRECTS = 5;

/**
 * Addresses a note's picture may not be fetched from: this computer, the local network, link-local (including cloud
 * metadata at 169.254.169.254) and other non-public ranges. Fetched from main, a picture would otherwise let a note
 * probe services only reachable from where the user sits.
 */
const NON_PUBLIC_ADDRESSES = (() => {
  const list = new BlockList();
  for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 3],
  ] as const) {
    list.addSubnet(network, prefix, 'ipv4');
  }
  for (const [network, prefix] of [
    // No `::ffff:0:0/96` rule: `BlockList` checks IPv4 addresses against IPv4-mapped rules too, so it would block
    // every IPv4 address. Mapped addresses are unwrapped to IPv4 instead (see `unmapIpv4`).
    ['::', 127],
    ['64:ff9b::', 96],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ] as const) {
    list.addSubnet(network, prefix, 'ipv6');
  }
  return list;
})();

/** Finds every address a host name stands for; injectable so tests needn't use real DNS. */
export type HostResolver = (host: string) => Promise<readonly string[]>;

/** Every address the system resolves a host to. */
const resolveWithDns: HostResolver = async (host) => (await lookup(host, { all: true })).map((entry) => entry.address);

/**
 * Whether a URL's host is somewhere public: every address it resolves to is outside `NON_PUBLIC_ADDRESSES`
 * (IPv4-mapped IPv6 is judged as the IPv4 address it carries). A name that can't be resolved counts as not public.
 * @param url The address about to be fetched.
 * @param resolveHost Resolves its host name.
 */
async function isPublicHost(url: URL, resolveHost: HostResolver): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: readonly string[];
  try {
    addresses = isIP(host) ? [host] : await resolveHost(host);
  } catch {
    return false;
  }
  return (
    addresses.length > 0 &&
    addresses.every((address) => {
      const ipv4 = isIP(address) === 4 ? address : unmapIpv4(address);
      return ipv4 !== null ? !NON_PUBLIC_ADDRESSES.check(ipv4, 'ipv4') : !NON_PUBLIC_ADDRESSES.check(address, 'ipv6');
    })
  );
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 one, in either spelling: `::ffff:127.0.0.1`, or `::ffff:7f00:1` as the
 * `URL` parser normalizes it.
 * @param address An IPv6 address.
 * @returns The IPv4 address, or `null` if it isn't a mapped one.
 */
function unmapIpv4(address: string): string | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (dotted) {
    return dotted;
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) {
    return null;
  }
  const high = Number.parseInt(hex[1]!, 16);
  const low = Number.parseInt(hex[2]!, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * A web picture as a `data:` URL — fetched here rather than by the Markdown
 * page, whose content-security-policy loads no web content at all: a note
 * from anywhere must not be able to tell a server it was opened. The page
 * only asks for a picture the user clicked to load.
 *
 * `https:` only (redirects included), public hosts only (redirects included,
 * see `isPublicHost`), no cookies, an `image/*` response only, and at most
 * `MAX_IMAGE_BYTES` — read as a stream so an oversized reply is dropped
 * without being held in memory. A host whose DNS answer changes between the
 * check and the request (DNS rebinding) isn't caught; the user's click is still
 * required first.
 * @param url The picture's address.
 * @param fetchImpl The `fetch` to use, for tests.
 * @param resolveHost Resolves a host name, for tests.
 * @returns The data URL, or `null` if it can't be fetched or isn't a picture.
 */
export async function fetchRemoteImageDataUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
  resolveHost: HostResolver = resolveWithDns,
): Promise<string | null> {
  if (!/^https:\/\//i.test(url)) {
    return null;
  }
  try {
    const signal = AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS);
    let target = new URL(url);
    let response: Response | null = null;
    // Redirects are followed by hand, so each hop's host is checked before it is contacted.
    for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop += 1) {
      if (target.protocol !== 'https:' || !(await isPublicHost(target, resolveHost))) {
        return null;
      }
      const reply = await fetchImpl(target.href, { credentials: 'omit', redirect: 'manual', signal });
      const location = reply.status >= 300 && reply.status < 400 ? reply.headers.get('location') : null;
      if (location === null) {
        response = reply;
        break;
      }
      target = new URL(location, target);
    }
    if (!response || !response.ok || !/^https:\/\//i.test(response.url || target.href) || !response.body) {
      return null;
    }
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!/^image\/[a-z0-9.+-]+$/.test(mime)) {
      return null;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      total += next.value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * A file name a note can be created or renamed to, from what a person typed
 * or a `[[link]]` names: the last path segment only (so a name can never
 * climb out of the folder it goes in), no characters Windows forbids, and a
 * `.md` extension if it has none.
 * @param name The proposed name.
 * @returns The safe file name, or `null` if nothing usable is left.
 */
export function toNoteFileName(name: string): string | null {
  const segment = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = segment
    // eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not have.
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/[. ]+$/, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return null;
  }
  // Windows treats these names as devices, whatever extension they have.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) {
    return null;
  }
  const withExtension = MARKDOWN_EXTENSION_PATTERN.test(cleaned) ? cleaned : `${cleaned}.md`;
  return withExtension.length > 255 ? null : withExtension;
}
