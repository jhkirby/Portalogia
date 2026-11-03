// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { SecretState, SecretUpdateResult } from '@shared/ipc-contract';
import { secretOriginOf, secretSourceOf } from '@shared/secrets';

/**
 * Encrypts and decrypts the secrets file. Electron's `safeStorage` in the app
 * (on Windows, DPAPI: readable only by the same user on the same computer);
 * injectable so the store can be tested without Electron.
 */
export interface SecretCipher {
  /** Whether encryption can be used at all right now. */
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  /** Throws if the data can't be decrypted (another user's, or damaged). */
  decrypt(data: Buffer): string;
}

/** The file on disk: the whole list, encrypted as one. Its shape is checked on every read — the file is untrusted input. */
const secretFileSchema = z.object({
  version: z.literal(1),
  data: z.string(),
});

/** The list inside, once decrypted. */
const secretListSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string(),
    source: z.string().min(1),
    element: z.string(),
    secret: z.string(),
  }),
);

/** One secret of a login to keep: its name, its value, and the element it was typed into. */
export interface LoginSecret {
  readonly name: string;
  readonly value: string;
  readonly element: string;
}

/**
 * The saved secrets — usernames and passwords for filling in on websites —
 * kept encrypted in the app's user-data directory. Loaded once at
 * construction and kept in memory thereafter; every change re-writes the
 * whole file, as `BookmarkStore` does, through a temporary file so a crash
 * mid-write never leaves half of one.
 *
 * Nothing is ever written in the clear. Where encryption isn't available, or
 * the file there can't be decrypted (it belongs to another user, or is
 * damaged), the store holds nothing and refuses to save, rather than
 * overwriting a file it couldn't read.
 */
export class SecretStore {
  private secrets: SecretState[] = [];
  /** Whether saving is allowed: encryption works, and any file already there was read. */
  private writable = false;

  /**
   * @param filePath Where to read/write the encrypted secrets file.
   * @param cipher How it's encrypted (`safeStorage` in the app).
   */
  public constructor(
    private readonly filePath: string,
    private readonly cipher: SecretCipher,
  ) {
    this.load();
  }

  /** @returns Whether secrets can be saved: with no encryption, the save prompt isn't offered at all. */
  public canSave(): boolean {
    return this.writable;
  }

  /** @returns Every saved secret, in the order they were saved. */
  public list(): readonly SecretState[] {
    return this.secrets;
  }

  /** @returns The secret with this id, if there is one. */
  public find(id: string): SecretState | undefined {
    return this.secrets.find((secret) => secret.id === id);
  }

  /**
   * The secrets to fill into a page: those kept for pages of its origin.
   * @param origin The page's origin (`https://example.com`).
   */
  public forOrigin(origin: string): readonly SecretState[] {
    return this.secrets.filter((secret) => secretOriginOf(secret.source) === origin);
  }

  /**
   * Whether a login is already saved exactly as typed: each of its secrets
   * kept for the same site and element with the same value. Such a login
   * isn't offered for saving again.
   * @param source The page the login was typed into.
   * @param values Each secret's value and element.
   */
  public hasLogin(source: string, values: readonly { readonly value: string; readonly element: string }[]): boolean {
    const origin = secretOriginOf(source);
    return values.every(({ value, element }) =>
      this.secrets.some(
        (secret) => secretOriginOf(secret.source) === origin && secret.element === element && secret.secret === value,
      ),
    );
  }

  /**
   * Keeps a login's secrets. One already kept for the same site and element
   * (an earlier login there, or the same one with a new password) is
   * replaced, so a page is never offered two values for one box.
   * @param source The page the login was typed into.
   * @param secrets The username and/or password.
   * @returns Whether they were kept: `false` when saving isn't possible, or the source isn't a web page.
   */
  public saveLogin(source: string, secrets: readonly LoginSecret[]): boolean {
    const normalized = secretSourceOf(source);
    const origin = normalized ? secretOriginOf(normalized) : null;
    if (!this.writable || !normalized || !origin) {
      return false;
    }
    let next = [...this.secrets];
    for (const { name, value, element } of secrets) {
      const existing = next.findIndex(
        (secret) => secretOriginOf(secret.source) === origin && secret.element === element,
      );
      const kept: SecretState = {
        id: existing >= 0 ? next[existing]!.id : randomUUID(),
        name: name.trim() || element,
        source: normalized,
        element,
        secret: value,
      };
      next = existing >= 0 ? next.map((secret, index) => (index === existing ? kept : secret)) : [...next, kept];
    }
    return this.commit(next);
  }

  /**
   * Renames a secret, points it at another page and/or changes its value —
   * a Secrets tab's edit.
   * @param id The secret.
   * @param name Its new name; must not be blank.
   * @param source Its new page; must be an http(s) address (kept as origin and path).
   * @param secret Its new value; must not be empty.
   * @returns Whether it was kept, or the field refused and why.
   */
  public update(id: string, name: string, source: string, secret: string): SecretUpdateResult {
    const existing = this.find(id);
    if (!existing) {
      return { ok: false, field: 'name', message: 'That secret no longer exists' };
    }
    if (!name.trim()) {
      return { ok: false, field: 'name', message: 'A secret needs a name' };
    }
    const normalized = secretSourceOf(source.trim());
    if (!normalized) {
      return { ok: false, field: 'source', message: 'Needs a web address (http or https)' };
    }
    if (secret.length === 0) {
      return { ok: false, field: 'secret', message: 'A secret can’t be empty' };
    }
    const updated: SecretState = { ...existing, name: name.trim(), source: normalized, secret };
    if (!this.commit(this.secrets.map((candidate) => (candidate.id === id ? updated : candidate)))) {
      return { ok: false, field: 'secret', message: 'Secrets can’t be saved on this computer' };
    }
    return { ok: true };
  }

  /**
   * Keeps a secret typed in by hand on a Secrets tab — all four of its fields,
   * checked as an edit's are, with the element needing to be there too. It's
   * added as its own row: unlike a saved login, it never replaces another.
   * @returns Whether it was kept, or the field refused and why.
   */
  public add(name: string, source: string, element: string, secret: string): SecretUpdateResult {
    if (!name.trim()) {
      return { ok: false, field: 'name', message: 'A secret needs a name' };
    }
    const normalized = secretSourceOf(source.trim());
    if (!normalized) {
      return { ok: false, field: 'source', message: 'Needs a web address (http or https)' };
    }
    if (!element.trim()) {
      return { ok: false, field: 'element', message: 'Needs the element it goes in (a CSS selector)' };
    }
    if (secret.length === 0) {
      return { ok: false, field: 'secret', message: 'A secret can’t be empty' };
    }
    const added: SecretState = { id: randomUUID(), name: name.trim(), source: normalized, element: element.trim(), secret };
    if (!this.commit([...this.secrets, added])) {
      return { ok: false, field: 'secret', message: 'Secrets can’t be saved on this computer' };
    }
    return { ok: true };
  }

  /**
   * Deletes a secret. A no-op if it doesn't exist.
   * @returns Whether anything was deleted.
   */
  public remove(id: string): boolean {
    if (!this.find(id)) {
      return false;
    }
    return this.commit(this.secrets.filter((secret) => secret.id !== id));
  }

  /** Writes a new list and, once it's on disk, keeps it. Nothing changes when it can't be written. */
  private commit(next: SecretState[]): boolean {
    if (!this.writable) {
      return false;
    }
    try {
      const data = this.cipher.encrypt(JSON.stringify(next)).toString('base64');
      const temporary = `${this.filePath}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, data }), { mode: 0o600 });
      renameSync(temporary, this.filePath);
    } catch (error) {
      console.error('[SecretStore] could not save secrets:', error);
      return false;
    }
    this.secrets = next;
    return true;
  }

  /** Reads and decrypts the file, if there is one; sets whether saving is allowed. */
  private load(): void {
    if (!this.cipher.isAvailable()) {
      console.warn('[SecretStore] encryption is unavailable; secrets will not be saved');
      return;
    }
    if (!existsSync(this.filePath)) {
      this.writable = true;
      return;
    }
    try {
      const file = secretFileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf-8')));
      const plain = this.cipher.decrypt(Buffer.from(file.data, 'base64'));
      this.secrets = secretListSchema.parse(JSON.parse(plain));
      this.writable = true;
    } catch (error) {
      // Left as it is on disk: overwriting what couldn't be read would lose it for good.
      console.error('[SecretStore] could not read the secrets file; not saving over it:', error);
    }
  }
}
