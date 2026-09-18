// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from '@playwright/test';
import { isNavigableUrl, looksLikeUrl, normalizeUrlOrSearch } from '../../src/shared/url';

test.describe('looksLikeUrl', () => {
  test('accepts a dot-domain host, with or without a scheme', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('http://example.com/path?q=1')).toBe(true);
  });

  test('accepts localhost, bare or with a port', () => {
    expect(looksLikeUrl('localhost')).toBe(true);
    expect(looksLikeUrl('http://localhost:3000')).toBe(true);
  });

  test("accepts the app's own northstar: scheme", () => {
    expect(looksLikeUrl('northstar://home')).toBe(true);
  });

  test('rejects blank input', () => {
    expect(looksLikeUrl('')).toBe(false);
    expect(looksLikeUrl('   ')).toBe(false);
  });

  test('rejects free text that looks like a search query', () => {
    expect(looksLikeUrl('purdue university')).toBe(false);
  });

  test('rejects a bare word with no dot, since it cannot be a real host', () => {
    expect(looksLikeUrl('purdue')).toBe(false);
  });
});

test.describe('normalizeUrlOrSearch', () => {
  test('adds https:// to a bare domain', () => {
    expect(normalizeUrlOrSearch('example.com')).toBe('https://example.com/');
  });

  test('leaves an explicit scheme alone', () => {
    expect(normalizeUrlOrSearch('http://example.com')).toBe('http://example.com/');
  });

  test('falls back to a Google search URL for non-URL text', () => {
    const result = normalizeUrlOrSearch('purdue university');
    expect(result).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
    expect(result).toContain('purdue%20university');
  });

  test('blank input goes to about:blank', () => {
    expect(normalizeUrlOrSearch('   ')).toBe('about:blank');
  });
});

test.describe('isNavigableUrl', () => {
  test('allows http, https, about, and northstar', () => {
    expect(isNavigableUrl('https://example.com/')).toBe(true);
    expect(isNavigableUrl('http://example.com/')).toBe(true);
    expect(isNavigableUrl('about:blank')).toBe(true);
    expect(isNavigableUrl('northstar://home/')).toBe(true);
  });

  test('refuses file: and javascript: URLs', () => {
    expect(isNavigableUrl('file:///etc/passwd')).toBe(false);
    expect(isNavigableUrl('javascript:alert(1)')).toBe(false);
  });

  test('refuses unparseable input instead of throwing', () => {
    expect(isNavigableUrl('not a url')).toBe(false);
  });
});
