// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { WorkspaceImageStore } from '../../src/main/browser/WorkspaceImageStore';

const TABS = [
  { kind: 'browser', value: 'https://example.com/' },
  { kind: 'terminal', value: '' },
  { kind: 'markdown', value: 'C:\notes\a.md' },
] as const;

function newStore(): { store: WorkspaceImageStore; file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ns-images-'));
  const file = join(dir, 'images.json');
  return { store: new WorkspaceImageStore(file), file, dir };
}

test.describe('WorkspaceImageStore', () => {
  test('saves an image with its tabs in order and lists it for the chrome', () => {
    const { store, dir } = newStore();
    store.save({ name: 'Research', color: '#e8710a', icon: 'dot', tabs: TABS, activeIndex: 1 });
    expect(store.listStates()).toEqual([
      { id: expect.any(String), name: 'Research', color: '#e8710a', icon: 'dot', tabCount: 3 },
    ]);
    const saved = store.get(store.listStates()[0]!.id);
    expect(saved?.tabs.map((tab) => tab.kind)).toEqual(['browser', 'terminal', 'markdown']);
    expect(saved?.activeIndex).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('saving never overwrites: a changed workspace is a different image', () => {
    const { store, dir } = newStore();
    store.save({ name: 'Research', color: '#e8710a', icon: 'dot', tabs: TABS, activeIndex: 0 });
    store.save({ name: 'Research', color: '#e8710a', icon: 'dot', tabs: TABS.slice(0, 1), activeIndex: 0 });
    expect(store.listStates().map((image) => image.tabCount)).toEqual([3, 1]);
    expect(store.list().map((image) => image.tabs.length)).toEqual([3, 1]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('removing deletes it, and images survive a restart', () => {
    const { store, file, dir } = newStore();
    store.save({ name: 'A', color: '#000000', icon: 'dot', tabs: TABS, activeIndex: 0 });
    store.save({ name: 'B', color: '#000000', icon: 'dot', tabs: TABS, activeIndex: 0 });
    store.remove(store.listStates()[0]!.id);
    expect(new WorkspaceImageStore(file).listStates().map((image) => image.name)).toEqual(['B']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('renaming changes the name, ignores a blank one, and persists', () => {
    const { store, file, dir } = newStore();
    store.save({ name: 'A', color: '#000000', icon: 'dot', tabs: TABS, activeIndex: 0 });
    const id = store.listStates()[0]!.id;
    store.rename(id, '  Thesis tabs  ');
    store.rename(id, '   ');
    store.rename('missing', 'Nope');
    expect(store.listStates().map((image) => image.name)).toEqual(['Thesis tabs']);
    expect(new WorkspaceImageStore(file).listStates().map((image) => image.name)).toEqual(['Thesis tabs']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a corrupt or malformed file is ignored rather than crashing', () => {
    const { file, dir } = newStore();
    writeFileSync(file, '{ not json');
    expect(new WorkspaceImageStore(file).listStates()).toEqual([]);
    writeFileSync(file, JSON.stringify([{ id: 'x', name: 'Bad', color: '', icon: '', tabs: [{ kind: 'nope', value: '' }] }]));
    expect(new WorkspaceImageStore(file).listStates()).toEqual([]);
    expect(readFileSync(file, 'utf-8')).toContain('Bad');
    rmSync(dir, { recursive: true, force: true });
  });
});
