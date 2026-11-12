// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { SessionStore, type SessionContents } from '../../src/main/browser/SessionStore';

const CONTENTS: SessionContents = {
  workspaces: [{ id: 'w1', name: 'Home', color: '#fff', icon: 'dot' }],
  tabs: [{ kind: 'browser', url: 'https://example.com/', workspaceId: 'w1', active: true }],
  activeWorkspaceId: 'w1',
};

test.describe('SessionStore sidebars', () => {
  let dir: string;
  let file: string;

  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portalogia-session-'));
    file = join(dir, 'session.json');
  });

  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('has no sidebars on first launch, or in a file from before they were saved', () => {
    expect(new SessionStore(file).getSidebars()).toBeUndefined();
    writeFileSync(file, JSON.stringify(CONTENTS), 'utf-8');
    const store = new SessionStore(file);
    expect(store.getSidebars()).toBeUndefined();
    expect(store.get()?.tabs).toHaveLength(1);
  });

  test('a recorded layout survives a restart', () => {
    const store = new SessionStore(file);
    store.scheduleSave(CONTENTS);
    store.recordSidebars({ workspaces: false, tools: true });
    store.flush();
    expect(new SessionStore(file).getSidebars()).toEqual({ workspaces: false, tools: true });
  });

  test('the last window recorded wins', () => {
    const store = new SessionStore(file);
    store.scheduleSave(CONTENTS);
    store.recordSidebars({ workspaces: false, tools: false });
    store.flush();
    store.recordSidebars({ workspaces: true, tools: false });
    store.flush();
    expect(new SessionStore(file).getSidebars()).toEqual({ workspaces: true, tools: false });
  });

  test('a recorded layout is written even with no tab change pending, keeping the saved tabs', () => {
    writeFileSync(file, JSON.stringify(CONTENTS), 'utf-8');
    const store = new SessionStore(file);
    store.recordSidebars({ workspaces: false, tools: false });
    store.flush();
    const saved: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    expect(saved).toEqual({ ...CONTENTS, sidebars: { workspaces: false, tools: false } });
  });

  test('later tab saves keep the recorded layout', () => {
    const store = new SessionStore(file);
    store.recordSidebars({ workspaces: false, tools: true });
    store.scheduleSave(CONTENTS);
    store.flush();
    expect(new SessionStore(file).getSidebars()).toEqual({ workspaces: false, tools: true });
  });

  test('a malformed sidebars entry falls back to a fresh session rather than half-loading', () => {
    writeFileSync(file, JSON.stringify({ ...CONTENTS, sidebars: { workspaces: 'no' } }), 'utf-8');
    const store = new SessionStore(file);
    expect(store.get()).toBeNull();
    expect(store.getSidebars()).toBeUndefined();
  });
});
