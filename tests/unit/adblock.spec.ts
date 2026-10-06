// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { AdBlockStore } from '../../src/main/adblock/AdBlockStore';
import { stripTrackingParams } from '../../src/main/adblock/trackingParams';

test.describe('stripTrackingParams', () => {
  test('removes tracking parameters and keeps the rest, in order', () => {
    expect(stripTrackingParams('https://a.com/p?id=7&utm_source=x&fbclid=abc&q=hi')).toBe('https://a.com/p?id=7&q=hi');
  });

  test('returns null when there is nothing to strip', () => {
    expect(stripTrackingParams('https://a.com/p?id=7')).toBeNull();
    expect(stripTrackingParams('https://a.com/')).toBeNull();
  });

  test('drops the ? when every parameter was tracking', () => {
    expect(stripTrackingParams('https://a.com/p?utm_medium=x')).toBe('https://a.com/p');
  });

  test('ignores non-http(s) and malformed URLs', () => {
    expect(stripTrackingParams('file:///x.html?utm_source=a')).toBeNull();
    expect(stripTrackingParams('not a url')).toBeNull();
  });

  test('does not touch look-alike parameters', () => {
    expect(stripTrackingParams('https://a.com/?utmost=1&refer=2')).toBeNull();
  });
});

test.describe('AdBlockStore', () => {
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adblock-'));
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('defaults to on with no allowed sites', () => {
    const store = new AdBlockStore(join(dir, 's.json'));
    expect(store.enabled).toBe(true);
    expect(store.allowedSites).toEqual([]);
  });

  test('allowing a site covers its subdomains but not its siblings', () => {
    const store = new AdBlockStore(join(dir, 's.json'));
    store.setSiteAllowed('Example.com', true);
    expect(store.isSiteAllowed('www.example.com')).toBe(true);
    expect(store.isSiteAllowed('example.com')).toBe(true);
    expect(store.isSiteAllowed('notexample.com')).toBe(false);
    expect(store.isSiteAllowed('example.org')).toBe(false);
    store.setSiteAllowed('example.com', false);
    expect(store.isSiteAllowed('example.com')).toBe(false);
  });

  test('persists across instances after a flush', () => {
    const file = join(dir, 's.json');
    const store = new AdBlockStore(file);
    store.setEnabled(false);
    store.setSiteAllowed('a.com', true);
    store.flush();
    const reloaded = new AdBlockStore(file);
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.allowedSites).toEqual(['a.com']);
  });

  test('a corrupt or hostile file falls back to defaults', () => {
    const file = join(dir, 's.json');
    writeFileSync(file, '{"enabled":"yes","allowedSites":[1]}');
    expect(new AdBlockStore(file).enabled).toBe(true);
    writeFileSync(file, 'not json');
    expect(new AdBlockStore(file).allowedSites).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('not json');
  });
});
