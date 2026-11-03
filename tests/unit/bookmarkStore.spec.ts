// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { BookmarkStore } from '../../src/main/browser/BookmarkStore';

function newStore(): { store: BookmarkStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ns-bookmarks-'));
  return { store: new BookmarkStore(join(dir, 'bookmarks.json')), dir };
}

test.describe('BookmarkStore names', () => {
  test('a bookmark saved under a taken name is numbered, ignoring case', () => {
    const { store, dir } = newStore();
    store.add('Docs', 'https://a.example/');
    store.add('docs', 'https://b.example/');
    store.addPdf('Docs', join(dir, 'paper.pdf'));
    expect(store.list().map((bookmark) => bookmark.title)).toEqual(['Docs', 'docs (2)', 'Docs (3)']);
    rmSync(dir, { recursive: true, force: true });
  });
});

test.describe('BookmarkStore.update', () => {
  test('renames and re-points a page, and the change persists', () => {
    const { store, dir } = newStore();
    const [page] = store.add('Docs', 'https://a.example/');
    expect(store.update(page!.id, '  Manual  ', 'https://manual.example/')).toEqual({ ok: true });
    const reloaded = new BookmarkStore(join(dir, 'bookmarks.json'));
    expect(reloaded.list()[0]).toMatchObject({ title: 'Manual', url: 'https://manual.example/', kind: 'page' });
    rmSync(dir, { recursive: true, force: true });
  });

  test('refuses an empty name or one another bookmark has, ignoring case and outer spaces', () => {
    const { store, dir } = newStore();
    store.add('Docs', 'https://a.example/');
    const [, second] = store.add('Blog', 'https://b.example/');
    expect(store.update(second!.id, '   ', 'https://b.example/')).toMatchObject({ ok: false, field: 'title' });
    expect(store.update(second!.id, ' docs ', 'https://b.example/')).toMatchObject({ ok: false, field: 'title' });
    expect(store.list()[1]?.title).toBe('Blog');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a bookmark may keep its own name and reference', () => {
    const { store, dir } = newStore();
    const [page] = store.add('Docs', 'https://a.example/');
    expect(store.update(page!.id, 'DOCS', 'https://a.example/')).toEqual({ ok: true });
    rmSync(dir, { recursive: true, force: true });
  });

  test('refuses a URL or path another bookmark already points at', () => {
    const { store, dir } = newStore();
    store.add('Docs', 'https://a.example/');
    const [, page] = store.add('Blog', 'https://b.example/');
    expect(store.update(page!.id, 'Blog', 'https://a.example/')).toMatchObject({ ok: false, field: 'reference' });

    const first = join(dir, 'one.pdf');
    store.addPdf('One', first);
    const pdf = store.addPdf('Two', join(dir, 'two.pdf')).at(-1)!;
    expect(store.update(pdf.id, 'Two', first)).toMatchObject({ ok: false, field: 'reference' });
    rmSync(dir, { recursive: true, force: true });
  });

  test("re-pointing a file bookmark moves its path and its file URL together", () => {
    const { store, dir } = newStore();
    const pdf = store.addPdf('One', join(dir, 'one.pdf')).at(-1)!;
    const moved = join(dir, 'moved.pdf');
    expect(store.update(pdf.id, 'One', moved)).toEqual({ ok: true });
    expect(store.findPdf(moved)).toMatchObject({ id: pdf.id, path: moved });
    expect(store.findPdf(moved)?.url.startsWith('file:')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a name clash saved before names had to differ does not block an edit of the other field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ns-bookmarks-'));
    const file = join(dir, 'bookmarks.json');
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'a', title: 'Docs', url: 'https://a.example/', kind: 'page', path: null },
        { id: 'b', title: 'Docs', url: 'https://b.example/', kind: 'page', path: null },
      ]),
    );
    const store = new BookmarkStore(file);
    expect(store.update('b', 'Docs', 'https://c.example/')).toEqual({ ok: true });
    expect(store.update('b', 'Blog', 'https://c.example/')).toEqual({ ok: true });
    rmSync(dir, { recursive: true, force: true });
  });

  test('refuses an edit to a bookmark that no longer exists', () => {
    const { store, dir } = newStore();
    expect(store.update('missing', 'Name', 'https://a.example/')).toMatchObject({ ok: false });
    rmSync(dir, { recursive: true, force: true });
  });
});
