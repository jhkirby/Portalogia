// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImageDataUrl, resolveLinkTarget } from '../../src/main/browser/MarkdownVault';
import { readFileCapped } from '../../src/main/platform/readFileCapped';

let root: string;

// Outside the vault: a folder beside it, two levels up from the note, holding an image and a note.
//   <root>/outside/secret.png, <root>/outside/secret.md
//   <root>/home/vault/.obsidian/, <root>/home/vault/notes/note.md, <root>/home/vault/pics/ok.png
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'portalogia-sec-'));
  await mkdir(join(root, 'outside'), { recursive: true });
  await mkdir(join(root, 'home', 'vault', '.obsidian'), { recursive: true });
  await mkdir(join(root, 'home', 'vault', 'notes'), { recursive: true });
  await mkdir(join(root, 'home', 'vault', 'pics'), { recursive: true });
  await writeFile(join(root, 'outside', 'secret.png'), Buffer.from([1, 2, 3]));
  await writeFile(join(root, 'outside', 'secret.md'), '# secret');
  await writeFile(join(root, 'home', 'vault', 'notes', 'note.md'), '# note');
  await writeFile(join(root, 'home', 'vault', 'notes', 'other.md'), '# other');
  await writeFile(join(root, 'home', 'vault', 'pics', 'ok.png'), Buffer.from([4, 5, 6]));
});

test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const note = (): string => join(root, 'home', 'vault', 'notes', 'note.md');

test.describe('a note can reach only files inside its own vault', () => {
  test('a picture inside the vault loads, by relative or absolute path', async () => {
    expect(await readImageDataUrl(note(), '../pics/ok.png')).toBe('data:image/png;base64,BAUG');
    expect(await readImageDataUrl(note(), join(root, 'home', 'vault', 'pics', 'ok.png'))).toBe('data:image/png;base64,BAUG');
  });

  test('a picture outside the vault is refused, by absolute path or by climbing out with ../', async () => {
    expect(await readImageDataUrl(note(), join(root, 'outside', 'secret.png'))).toBeNull();
    expect(await readImageDataUrl(note(), '../../../outside/secret.png')).toBeNull();
    expect(await readImageDataUrl(note(), '..%2F..%2F..%2Foutside%2Fsecret.png')).toBeNull();
  });

  test('a link opens a note inside the vault, never one outside it', async () => {
    expect(await resolveLinkTarget(note(), 'other.md')).toBe(join(root, 'home', 'vault', 'notes', 'other.md'));
    expect(await resolveLinkTarget(note(), join(root, 'outside', 'secret.md'))).toBeNull();
    expect(await resolveLinkTarget(note(), '../../../outside/secret.md')).toBeNull();
  });
});

test.describe('readFileCapped', () => {
  test('reads a file within the limit, and refuses one over it or a folder', async () => {
    const small = join(root, 'small.bin');
    await writeFile(small, Buffer.alloc(10, 7));
    const ok = await readFileCapped(small, 10);
    expect(ok.kind).toBe('ok');
    expect(ok.kind === 'ok' ? ok.data.length : -1).toBe(10);
    expect((await readFileCapped(small, 9)).kind).toBe('too-large');
    expect((await readFileCapped(root, 100)).kind).toBe('not-file');
  });

  test('reads a file bigger than one chunk whole', async () => {
    const big = join(root, 'big.bin');
    const data = Buffer.alloc(3 * 1024 * 1024 + 5, 1);
    await writeFile(big, data);
    const read = await readFileCapped(big, data.length);
    expect(read.kind === 'ok' ? read.data.equals(data) : false).toBe(true);
  });
});
