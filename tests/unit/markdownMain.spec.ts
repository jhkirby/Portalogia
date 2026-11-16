// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { allRunnableNames, runCodeBlock } from '../../src/main/browser/MarkdownCodeRunner';
import { MarkdownDocuments } from '../../src/main/browser/MarkdownDocuments';
import {
  fetchRemoteImageDataUrl,
  findBacklinks,
  forgetVaultScans,
  listNoteNames,
  readImageDataUrl,
  resolveLinkTarget,
  resolveWikiTarget,
  toNoteFileName,
} from '../../src/main/browser/MarkdownVault';
import { RUNNABLE_LANGUAGE_NAMES } from '../../src/shared/markdown/runnable';
import { matchLatexCommands } from '../../src/renderer/lib/markdown/latexCommands';
import { mathContextAt } from '../../src/renderer/lib/markdown/mathContext';

/** A throwaway vault: `a.md`, `sub/b.md` (links to a), `sub/c.md` (no links), and a picture. */
function makeVault(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ns-vault-'));
  mkdirSync(join(dir, 'sub'));
  // The marker that makes `dir` a vault, so names are looked for under all of it.
  mkdirSync(join(dir, '.obsidian'));
  writeFileSync(join(dir, 'a.md'), '# A\n\nSee [[b]] and [text](sub/c.md#h).\n');
  writeFileSync(join(dir, 'sub', 'b.md'), '# B\n\nBack to [[a]].\n');
  writeFileSync(join(dir, 'sub', 'c.md'), '# C\n');
  writeFileSync(join(dir, 'pic.png'), Buffer.from('iVBORw0KGgo=', 'base64'));
  writeFileSync(join(dir, 'notes.txt'), 'not an image');
  forgetVaultScans();
  return dir;
}

test.describe('vault: finding notes', () => {
  test('a wikilink finds a note by name in another folder, ignoring case and extension', async () => {
    const dir = makeVault();
    expect(await resolveWikiTarget(join(dir, 'a.md'), 'B')).toBe(join(dir, 'sub', 'b.md'));
    expect(await resolveWikiTarget(join(dir, 'a.md'), 'sub/b#Heading|alias')).toBe(join(dir, 'sub', 'b.md'));
    expect(await resolveWikiTarget(join(dir, 'a.md'), 'nope')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('an ordinary link resolves relative to the note, and only to notes that exist', async () => {
    const dir = makeVault();
    expect(await resolveLinkTarget(join(dir, 'a.md'), 'sub/c.md#h')).toBe(join(dir, 'sub', 'c.md'));
    expect(await resolveLinkTarget(join(dir, 'a.md'), 'missing.md')).toBeNull();
    expect(await resolveLinkTarget(join(dir, 'a.md'), 'notes.txt')).toBeNull();
    expect(await resolveLinkTarget(join(dir, 'a.md'), '\\\\evil\\share\\x.md')).toBeNull();
    expect(await resolveLinkTarget(join(dir, 'a.md'), 'file:///C:/x.md')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('backlinks find both wikilinks and relative links', async () => {
    const dir = makeVault();
    const toA = await findBacklinks(join(dir, 'a.md'));
    expect(toA.map((link) => link.name)).toEqual(['b']);
    expect(toA[0]?.target).toBe('sub/b.md');
    const toC = await findBacklinks(join(dir, 'sub', 'c.md'));
    expect(toC.map((link) => link.name)).toEqual(['a']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a PDF is linked to by name with its extension, by an embed, or by a relative path', async () => {
    const dir = makeVault();
    writeFileSync(join(dir, 'sub', 'Paper One.pdf'), '%PDF-1.4');
    writeFileSync(join(dir, 'reads.md'), 'Read [[Paper One.pdf#page=3|the paper]].\n');
    writeFileSync(join(dir, 'embeds.md'), '![[paper one.pdf]]\n');
    writeFileSync(join(dir, 'sub', 'path.md'), 'See [it](Paper%20One.pdf).\n');
    // Named without the extension it's a note's name, not the PDF's.
    writeFileSync(join(dir, 'loose.md'), 'Not [[Paper One]], nor [x](Paper One.md).\n');
    forgetVaultScans();
    const found = await findBacklinks(join(dir, 'sub', 'Paper One.pdf'));
    expect(found.map((link) => link.name)).toEqual(['embeds', 'path', 'reads']);
    expect(found.find((link) => link.name === 'reads')?.target).toBe('../reads.md');
    rmSync(dir, { recursive: true, force: true });
  });

  test('outside a marked vault, a note is still found one folder up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ns-loose-'));
    mkdirSync(join(dir, 'guide'));
    writeFileSync(join(dir, 'top.md'), '# Top');
    writeFileSync(join(dir, 'guide', 'g.md'), '# G');
    forgetVaultScans();
    expect(await resolveWikiTarget(join(dir, 'guide', 'g.md'), 'top')).toBe(join(dir, 'top.md'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('note names for completion leave out the open note', async () => {
    const dir = makeVault();
    expect(await listNoteNames(join(dir, 'a.md'))).toEqual(['b', 'c']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('images are read only if they are pictures', async () => {
    const dir = makeVault();
    expect(await readImageDataUrl(join(dir, 'sub', 'b.md'), 'pic.png')).toMatch(/^data:image\/png;base64,/);
    expect(await readImageDataUrl(join(dir, 'a.md'), 'notes.txt')).toBeNull();
    expect(await readImageDataUrl(join(dir, 'a.md'), '\\\\host\\share\\x.png')).toBeNull();
    // A web address is never read as a local picture — only `fetchRemoteImageDataUrl`, on a click, fetches one.
    expect(await readImageDataUrl(join(dir, 'a.md'), 'https://example.com/x.png')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

test.describe('fetchRemoteImageDataUrl', () => {
  /** Resolves every host to a public address (example.com's), so no test touches real DNS. */
  const publicHost = async (): Promise<readonly string[]> => ['93.184.215.14'];

  /** A stand-in `fetch` answering every request with `body` and `headers`, recording what it was asked. */
  function fakeFetch(
    body: Uint8Array | string,
    init: { status?: number; headers?: Record<string, string>; finalUrl?: string } = {},
  ): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (input: string | URL | Request, requestInit?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: requestInit });
      const response = new Response(body, { status: init.status ?? 200, headers: init.headers });
      Object.defineProperty(response, 'url', { value: init.finalUrl ?? url });
      return response;
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  test('an https picture comes back as a data URL, fetched without cookies', async () => {
    const { fetchImpl, calls } = fakeFetch(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png; x=y' } });
    expect(await fetchRemoteImageDataUrl('https://example.com/a.png', fetchImpl, publicHost)).toBe('data:image/png;base64,AQID');
    expect(calls[0]?.init?.credentials).toBe('omit');
  });

  test('anything but https is refused before any request is made', async () => {
    const { fetchImpl, calls } = fakeFetch('x', { headers: { 'content-type': 'image/png' } });
    for (const url of ['http://example.com/a.png', 'file:///C:/a.png', 'data:image/png;base64,AA==', 'javascript:alert(1)']) {
      expect(await fetchRemoteImageDataUrl(url, fetchImpl, publicHost)).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  test('a redirect away from https, a non-picture, an error status or an oversized body gives nothing', async () => {
    const png = { 'content-type': 'image/png' };
    expect(await fetchRemoteImageDataUrl('https://a.test/x', fakeFetch('x', { headers: png, finalUrl: 'http://a.test/x' }).fetchImpl, publicHost)).toBeNull();
    expect(await fetchRemoteImageDataUrl('https://a.test/x', fakeFetch('<script>', { headers: { 'content-type': 'text/html' } }).fetchImpl, publicHost)).toBeNull();
    expect(await fetchRemoteImageDataUrl('https://a.test/x', fakeFetch('x', { headers: png, status: 404 }).fetchImpl, publicHost)).toBeNull();
    const huge = new Uint8Array(15 * 1024 * 1024 + 1);
    expect(await fetchRemoteImageDataUrl('https://a.test/x', fakeFetch(huge, { headers: png }).fetchImpl, publicHost)).toBeNull();
  });

  test('a failed request gives nothing rather than throwing', async () => {
    const failing = (async () => {
      throw new TypeError('network down');
    }) as typeof fetch;
    expect(await fetchRemoteImageDataUrl('https://a.test/x', failing, publicHost)).toBeNull();
  });
  test('a host on this computer or the local network is refused before any request is made', async () => {
    const { fetchImpl, calls } = fakeFetch('x', { headers: { 'content-type': 'image/png' } });
    for (const url of [
      'https://localhost/a.png',
      'https://127.0.0.1/a.png',
      'https://2130706433/a.png',
      'https://192.168.1.10/a.png',
      'https://10.0.0.5/a.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.png',
      'https://[::ffff:127.0.0.1]/a.png',
      'https://[fd00::1]/a.png',
    ]) {
      expect(await fetchRemoteImageDataUrl(url, fetchImpl, async (host) => (host === 'localhost' ? ['127.0.0.1'] : ['93.184.215.14']))).toBeNull();
    }
    // A public-looking name that resolves to a private address is refused too, as is one that resolves to nothing.
    expect(await fetchRemoteImageDataUrl('https://intranet.example/a.png', fetchImpl, async () => ['10.1.2.3'])).toBeNull();
    expect(await fetchRemoteImageDataUrl('https://split.example/a.png', fetchImpl, async () => ['93.184.215.14', '192.168.0.2'])).toBeNull();
    expect(
      await fetchRemoteImageDataUrl('https://nx.example/a.png', fetchImpl, async () => {
        throw new Error('ENOTFOUND');
      }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a redirect is followed only to another public https host', async () => {
    const png = { 'content-type': 'image/png' };
    const redirectingTo = (location: string): typeof fetch =>
      (async (input: string | URL | Request) =>
        String(input).startsWith('https://public.example/')
          ? new Response(null, { status: 302, headers: { location } })
          : new Response(new Uint8Array([1, 2, 3]), { headers: png })) as typeof fetch;
    const resolve = async (host: string): Promise<readonly string[]> => (host === 'internal.example' ? ['10.0.0.9'] : ['93.184.215.14']);
    expect(await fetchRemoteImageDataUrl('https://public.example/a', redirectingTo('https://cdn.example/a.png'), resolve)).toBe(
      'data:image/png;base64,AQID',
    );
    expect(await fetchRemoteImageDataUrl('https://public.example/a', redirectingTo('https://internal.example/a.png'), resolve)).toBeNull();
    expect(await fetchRemoteImageDataUrl('https://public.example/a', redirectingTo('https://127.0.0.1/a.png'), resolve)).toBeNull();
    expect(await fetchRemoteImageDataUrl('https://public.example/a', redirectingTo('http://cdn.example/a.png'), resolve)).toBeNull();
  });

  test('an endless redirect loop gives nothing', async () => {
    const loop = (async () => new Response(null, { status: 302, headers: { location: 'https://public.example/again' } })) as typeof fetch;
    expect(await fetchRemoteImageDataUrl('https://public.example/a', loop, publicHost)).toBeNull();
  });
});

test.describe('toNoteFileName', () => {
  test('keeps only the last segment, strips forbidden characters and adds .md', () => {
    expect(toNoteFileName('../../etc/Evil: Note?')).toBe('Evil Note.md');
    expect(toNoteFileName('Plain')).toBe('Plain.md');
    expect(toNoteFileName('Already.markdown')).toBe('Already.markdown');
  });

  test('refuses names that are nothing, dots, or Windows devices', () => {
    expect(toNoteFileName('  ')).toBeNull();
    expect(toNoteFileName('..')).toBeNull();
    expect(toNoteFileName('CON')).toBeNull();
    expect(toNoteFileName('nul.txt')).toBeNull();
  });
});

test.describe('MarkdownDocuments', () => {
  test('saves keep the file’s CRLF endings and refuse a stale generation', async () => {
    const dir = makeVault();
    const path = join(dir, 'crlf.md');
    writeFileSync(path, '# T\r\nline\r\n');
    const documents = new MarkdownDocuments();
    const note = await documents.open('tab', path, 'reset');
    expect(note.content).toBe('# T\nline\n');
    await documents.save('tab', '# T\nedited\n', note.generation);
    expect(readFileSync(path, 'utf-8')).toBe('# T\r\nedited\r\n');
    await documents.save('tab', 'stale', note.generation + 99);
    expect(readFileSync(path, 'utf-8')).toBe('# T\r\nedited\r\n');
    rmSync(dir, { recursive: true, force: true });
  });

  test('following links builds Back and Forward; stepping returns through them', async () => {
    const dir = makeVault();
    const documents = new MarkdownDocuments();
    await documents.open('tab', join(dir, 'a.md'), 'reset');
    await documents.open('tab', join(dir, 'sub', 'b.md'), 'push');
    expect(documents.canGoBack('tab')).toBe(true);
    expect(documents.canGoForward('tab')).toBe(false);
    const back = await documents.step('tab', -1);
    expect(back?.name).toBe('a.md');
    expect(documents.canGoForward('tab')).toBe(true);
    expect((await documents.step('tab', 1))?.name).toBe('b.md');
    rmSync(dir, { recursive: true, force: true });
  });

  test('create never overwrites an existing note, and rename refuses paths and clashes', async () => {
    const dir = makeVault();
    const documents = new MarkdownDocuments();
    const existing = await documents.create('tab', join(dir, 'a.md'), 'reset');
    expect(existing.created).toBe(false);
    expect(readFileSync(join(dir, 'a.md'), 'utf-8')).toContain('See [[b]]');
    const fresh = await documents.create('tab', join(dir, 'new.md'), 'reset');
    expect(fresh.created).toBe(true);
    await expect(documents.rename('tab', '../escape.md')).rejects.toThrow();
    await expect(documents.rename('tab', 'a.md')).rejects.toThrow('already exists');
    const renamed = await documents.rename('tab', 'renamed.md');
    expect(renamed.newPath).toBe(join(dir, 'renamed.md'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('a change made on disk is noticed', async () => {
    const dir = makeVault();
    const documents = new MarkdownDocuments();
    await documents.open('tab', join(dir, 'a.md'), 'reset');
    expect(await documents.refreshIfChanged('tab')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 30));
    writeFileSync(join(dir, 'a.md'), '# Changed\n');
    expect(await documents.refreshIfChanged('tab')).toBe('# Changed\n');
    rmSync(dir, { recursive: true, force: true });
  });
});

test.describe('running code blocks', () => {
  test('the page’s list of runnable languages is the runner’s', () => {
    expect([...RUNNABLE_LANGUAGE_NAMES].sort()).toEqual(allRunnableNames().sort());
  });

  test('JavaScript runs, in the note’s folder, and reports its output and exit code', async () => {
    const dir = makeVault();
    const result = await runCodeBlock('js', 'console.log(process.cwd() === ' + JSON.stringify(dir) + '); console.error("e")', dir);
    expect(result.ran).toBe(true);
    expect(result.stdout).toContain('true');
    expect(result.stderr.trim()).toBe('e');
    expect(result.exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a failing script reports its exit code, and an endless one is stopped', async () => {
    const dir = makeVault();
    const failed = await runCodeBlock('javascript', 'process.exit(3)', dir);
    expect(failed.exitCode).toBe(3);
    const stopped = await runCodeBlock('js', 'setInterval(() => {}, 1000)', dir, 800);
    expect(stopped.timedOut).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an unknown language is refused without running anything', async () => {
    const result = await runCodeBlock('brainfuck', '+', tmpdir());
    expect(result.ran).toBe(false);
    expect(result.error).toContain('Runnable languages');
  });
});

test.describe('LaTeX completion', () => {
  test('math context follows $ and $$, skipping code and escapes', () => {
    expect(mathContextAt('plain text', 5)).toBe('none');
    expect(mathContextAt('a $x + \\al', 10)).toBe('inline');
    expect(mathContextAt('a $x$ and \\al', 13)).toBe('none');
    expect(mathContextAt('$$\nx = \\fr', 11)).toBe('display');
    expect(mathContextAt('costs \\$5 then \\al', 18)).toBe('none');
    expect(mathContextAt('`$x` then \\al', 13)).toBe('none');
    expect(mathContextAt('```\n$x \\al', 10)).toBe('none');
    expect(mathContextAt('costs $5 and $6 here \\al', 24)).toBe('none');
  });

  test('commands are matched by prefix, common ones first', () => {
    const names = matchLatexCommands('al', 10).map((command) => command.name);
    expect(names).toContain('alpha');
    expect(names).not.toContain('beta');
    expect(matchLatexCommands('fra', 5)[0]?.name).toBe('frac');
    expect(matchLatexCommands('fra', 5)[0]?.template).toContain('${numerator}');
    expect(matchLatexCommands('Delta', 3).map((command) => command.name)).toEqual(['Delta']);
  });
});
