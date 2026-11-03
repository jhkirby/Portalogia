// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from '@playwright/test';
import { domainOfUrl, isNavigableUrl, looksLikeUrl, normalizeUrlOrSearch } from '../../src/shared/url';

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

  test("accepts the app's own portalogia: scheme", () => {
    expect(looksLikeUrl('portalogia://home')).toBe(true);
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
  test('allows http, https, about, and portalogia', () => {
    expect(isNavigableUrl('https://example.com/')).toBe(true);
    expect(isNavigableUrl('http://example.com/')).toBe(true);
    expect(isNavigableUrl('about:blank')).toBe(true);
    expect(isNavigableUrl('portalogia://home/')).toBe(true);
  });

  test('refuses file: and javascript: URLs', () => {
    expect(isNavigableUrl('file:///etc/passwd')).toBe(false);
    expect(isNavigableUrl('javascript:alert(1)')).toBe(false);
  });

  test('refuses unparseable input instead of throwing', () => {
    expect(isNavigableUrl('not a url')).toBe(false);
  });
});

test.describe('domainOfUrl', () => {
  test('returns the hostname, without a leading www.', () => {
    expect(domainOfUrl('https://slack.com/')).toBe('slack.com');
    expect(domainOfUrl('https://www.google.com/search?q=google')).toBe('google.com');
    expect(domainOfUrl('http://docs.example.co.uk:8080/a/b')).toBe('docs.example.co.uk');
  });

  test('keeps non-www subdomains', () => {
    expect(domainOfUrl('https://claude.ai/chat/1')).toBe('claude.ai');
    expect(domainOfUrl('https://wwwx.example.com')).toBe('wwwx.example.com');
  });

  test('is null for non-web pages, blank input, and garbage', () => {
    expect(domainOfUrl('portalogia://home/')).toBeNull();
    expect(domainOfUrl('file:///C:/a.html')).toBeNull();
    expect(domainOfUrl('')).toBeNull();
    expect(domainOfUrl('not a url')).toBeNull();
  });
});
