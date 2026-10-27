// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { SecretStore, type SecretCipher } from '../../src/main/browser/SecretStore';
import { defaultSecretNames, secretOriginOf, secretSourceOf } from '../../src/shared/secrets';

/** A stand-in for `safeStorage`: reversible, and visibly not the plain text, so a test can tell nothing was left in the clear. */
function fakeCipher(available = true): SecretCipher {
  return {
    isAvailable: () => available,
    encrypt: (plainText) => Buffer.from(Buffer.from(plainText, 'utf-8').toString('base64').split('').reverse().join('')),
    decrypt: (data) => Buffer.from(data.toString().split('').reverse().join(''), 'base64').toString('utf-8'),
  };
}

/** A fresh directory for one test's secrets file, removed afterwards. */
function scratchFile(): { readonly path: string; readonly cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'northstar-secrets-'));
  return { path: join(directory, 'secrets.json'), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const LOGIN = 'https://accounts.example.com/login?next=%2Fhome#top';

test.describe('secret helpers', () => {
  test('a source is the page without its query or fragment; only web pages have one', () => {
    expect(secretSourceOf(LOGIN)).toBe('https://accounts.example.com/login');
    expect(secretSourceOf('file:///C:/notes.md')).toBeNull();
    expect(secretSourceOf('northstar://home')).toBeNull();
    expect(secretSourceOf('not a url')).toBeNull();
    expect(secretOriginOf('https://accounts.example.com/login')).toBe('https://accounts.example.com');
  });

  test('names start as the domain, without www., then what each secret is', () => {
    expect(defaultSecretNames('https://www.github.com/login')).toEqual({
      username: 'github.com - Username',
      password: 'github.com - Password',
    });
  });
});

test.describe('SecretStore', () => {
  test('saves a login encrypted, and reads it back on the next start', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher());
      expect(
        store.saveLogin(LOGIN, [
          { name: 'example.com, Username', value: 'ada@example.com', element: 'input[name="email"]' },
          { name: 'example.com, Password', value: 'hunter2!', element: 'input[type="password"]' },
        ]),
      ).toBe(true);
      const onDisk = readFileSync(file.path, 'utf-8');
      expect(onDisk).not.toContain('hunter2!');
      expect(onDisk).not.toContain('ada@example.com');

      const reopened = new SecretStore(file.path, fakeCipher());
      expect(reopened.list().map(({ name, source, element, secret }) => ({ name, source, element, secret }))).toEqual([
        { name: 'example.com, Username', source: 'https://accounts.example.com/login', element: 'input[name="email"]', secret: 'ada@example.com' },
        { name: 'example.com, Password', source: 'https://accounts.example.com/login', element: 'input[type="password"]', secret: 'hunter2!' },
      ]);
    } finally {
      file.cleanup();
    }
  });

  test('a new password for the same box replaces the old one rather than adding a second', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher());
      store.saveLogin(LOGIN, [{ name: 'Old', value: 'first', element: '#pw' }]);
      const id = store.list()[0]!.id;
      store.saveLogin('https://accounts.example.com/signin', [{ name: 'New', value: 'second', element: '#pw' }]);
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0]).toMatchObject({ id, name: 'New', secret: 'second' });
    } finally {
      file.cleanup();
    }
  });

  test('a login already saved exactly as typed is recognized, so it is not offered again', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher());
      store.saveLogin(LOGIN, [{ name: 'Password', value: 'hunter2!', element: '#pw' }]);
      expect(store.hasLogin('https://accounts.example.com/other', [{ value: 'hunter2!', element: '#pw' }])).toBe(true);
      expect(store.hasLogin(LOGIN, [{ value: 'changed', element: '#pw' }])).toBe(false);
      // Another site's page never matches, whatever the box and value.
      expect(store.hasLogin('https://evil.example.net/login', [{ value: 'hunter2!', element: '#pw' }])).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('fills only pages of the same origin', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher());
      store.saveLogin(LOGIN, [{ name: 'Password', value: 'hunter2!', element: '#pw' }]);
      expect(store.forOrigin('https://accounts.example.com')).toHaveLength(1);
      expect(store.forOrigin('http://accounts.example.com')).toHaveLength(0);
      expect(store.forOrigin('https://example.com')).toHaveLength(0);
    } finally {
      file.cleanup();
    }
  });

  test('an edit is refused over a blank name, a source that is not a web page, or an empty secret', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher());
      store.saveLogin(LOGIN, [{ name: 'Password', value: 'hunter2!', element: '#pw' }]);
      const id = store.list()[0]!.id;
      expect(store.update(id, '  ', LOGIN, 'x')).toMatchObject({ ok: false, field: 'name' });
      expect(store.update(id, 'Name', 'javascript:alert(1)', 'x')).toMatchObject({ ok: false, field: 'source' });
      expect(store.update(id, 'Name', LOGIN, '')).toMatchObject({ ok: false, field: 'secret' });
      expect(store.update('missing', 'Name', LOGIN, 'x')).toMatchObject({ ok: false });
      expect(store.update(id, ' Work ', 'https://example.org/in?x=1', 'new')).toEqual({ ok: true });
      expect(store.find(id)).toMatchObject({ name: 'Work', source: 'https://example.org/in', secret: 'new' });
    } finally {
      file.cleanup();
    }
  });

  test('a secret added by hand needs all four fields, and is kept as a row of its own', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher());
      store.saveLogin(LOGIN, [{ name: 'Saved', value: 'first', element: '#pw' }]);
      expect(store.add('', LOGIN, '#pw', 'x')).toMatchObject({ ok: false, field: 'name' });
      expect(store.add('Name', 'ftp://example.com', '#pw', 'x')).toMatchObject({ ok: false, field: 'source' });
      expect(store.add('Name', LOGIN, '   ', 'x')).toMatchObject({ ok: false, field: 'element' });
      expect(store.add('Name', LOGIN, '#pw', '')).toMatchObject({ ok: false, field: 'secret' });
      // Same site and box as the saved login: added beside it, not over it.
      expect(store.add(' Second account ', LOGIN, ' #pw ', 'second')).toEqual({ ok: true });
      const reopened = new SecretStore(file.path, fakeCipher());
      expect(reopened.list()).toHaveLength(2);
      expect(reopened.list()[1]).toMatchObject({
        name: 'Second account',
        source: 'https://accounts.example.com/login',
        element: '#pw',
        secret: 'second',
      });
    } finally {
      file.cleanup();
    }
  });

  test('deletes a secret', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher());
      store.saveLogin(LOGIN, [{ name: 'Password', value: 'hunter2!', element: '#pw' }]);
      expect(store.remove(store.list()[0]!.id)).toBe(true);
      expect(new SecretStore(file.path, fakeCipher()).list()).toEqual([]);
      expect(store.remove('missing')).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('without encryption nothing is saved, and nothing is written in the clear', () => {
    const file = scratchFile();
    try {
      const store = new SecretStore(file.path, fakeCipher(false));
      expect(store.canSave()).toBe(false);
      expect(store.saveLogin(LOGIN, [{ name: 'Password', value: 'hunter2!', element: '#pw' }])).toBe(false);
      expect(() => readFileSync(file.path)).toThrow();
    } finally {
      file.cleanup();
    }
  });

  test('a file that cannot be read is left alone, never saved over', () => {
    const file = scratchFile();
    try {
      writeFileSync(file.path, JSON.stringify({ version: 1, data: 'not what the cipher wrote' }));
      const store = new SecretStore(file.path, {
        ...fakeCipher(),
        decrypt: () => {
          throw new Error('belongs to another user');
        },
      });
      expect(store.canSave()).toBe(false);
      expect(store.saveLogin(LOGIN, [{ name: 'Password', value: 'hunter2!', element: '#pw' }])).toBe(false);
      expect(readFileSync(file.path, 'utf-8')).toContain('not what the cipher wrote');
    } finally {
      file.cleanup();
    }
  });
});
