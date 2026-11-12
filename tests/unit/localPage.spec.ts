// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { test, expect } from '@playwright/test';
import { localPageUrl } from '../../src/main/browser/localPage';

test.describe('localPageUrl', () => {
  test('a page on a Windows drive becomes its file address', () => {
    expect(localPageUrl('C:\\Users\\me\\Desktop\\notes.html', 'win32')).toBe('file:///C:/Users/me/Desktop/notes.html');
  });

  test('spaces and other characters a URL can’t hold are escaped', () => {
    expect(localPageUrl('D:\\My Pages\\a#b.html', 'win32')).toBe('file:///D:/My%20Pages/a%23b.html');
  });

  test('a network share is refused, by either slash, so Windows never sends the sign-in to its server', () => {
    expect(localPageUrl('\\\\server\\share\\page.html', 'win32')).toBeNull();
    expect(localPageUrl('//server/share/page.html', 'win32')).toBeNull();
  });

  test('a device path and a relative path are refused', () => {
    expect(localPageUrl('\\\\?\\C:\\page.html', 'win32')).toBeNull();
    expect(localPageUrl('page.html', 'win32')).toBeNull();
    expect(localPageUrl('C:page.html', 'win32')).toBeNull();
  });

  test('elsewhere, an absolute path is a page, and a network host is refused', () => {
    expect(localPageUrl('/home/me/page.html', 'linux')).toBe('file:///home/me/page.html');
    expect(localPageUrl('//host/share/page.html', 'linux')).toBeNull();
    expect(localPageUrl('page.html', 'darwin')).toBeNull();
  });
});
