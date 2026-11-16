// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { randomUUID } from 'node:crypto';
import { clipboard, ipcMain, type WebContents } from 'electron';
import {
  IpcChannel,
  type CapturedLogin,
  type SecretFillPayload,
  type SecretPromptAnswer,
  type SecretUpdateResult,
} from '@shared/ipc-contract';
import {
  capturedLoginSchema,
  secretAddRequestSchema,
  secretIdRequestSchema,
  secretUpdateRequestSchema,
} from '@shared/ipc-schemas';
import { defaultSecretNames, secretOriginOf, secretSourceOf } from '@shared/secrets';
import type { LoginSecret, SecretStore } from './SecretStore';
import type { SharedTabRegistry } from './SharedTabRegistry';

/** How long a copied secret stays on the clipboard before it's cleared (unless something else was copied since). */
const CLIPBOARD_CLEAR_MS = 45_000;

/** A login waiting on the save prompt's answer. */
interface PendingLogin {
  readonly tabId: string;
  readonly source: string;
  readonly login: CapturedLogin;
}

/**
 * Owns secrets' cross-process wiring — one instance shared by every window's
 * `TabManager`, as `BookmarksController` is. It does four things:
 *
 * - **Serves** the secrets to every open Secrets tab, pushed whenever one is
 *   saved, changed or deleted.
 * - **Obeys** edits, deletes and copies from the Secrets page — only from a
 *   Secrets tab's own view, and only in edit mode for a change.
 * - **Offers** to save a login a web page reports as it's sent: the window
 *   showing that tab puts up its save prompt, and the answer comes back here.
 *   Which page the login is for is read from the sending tab, never from the
 *   page's message, so a page can't save a secret for another site.
 * - **Fills** a web page's boxes with the secrets kept for its site, sent
 *   only to that page and only for its own origin.
 */
export class SecretsController {
  /** Logins waiting on an answer, by offer id. One per tab: a newer login there replaces the older offer. */
  private readonly pending = new Map<string, PendingLogin>();
  private clipboardTimer: NodeJS.Timeout | null = null;

  /**
   * @param registry The shared tabs/views, used to tell which `webContents` are Secrets tabs and web pages.
   * @param store Where secrets are kept.
   */
  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: SecretStore,
  ) {
    ipcMain.handle(IpcChannel.SecretsPageUpdate, (event, rawRequest: unknown): SecretUpdateResult => {
      const parsed = secretUpdateRequestSchema.safeParse(rawRequest);
      if (!parsed.success || !this.editingTabIdOf(event.sender)) {
        return { ok: false, field: 'name', message: 'That change could not be made' };
      }
      const { id, name, source, secret } = parsed.data;
      const result = this.store.update(id, name, source, secret);
      if (result.ok) {
        this.pushToAll();
      }
      return result;
    });
    ipcMain.handle(IpcChannel.SecretsPageAdd, (event, rawRequest: unknown): SecretUpdateResult => {
      const parsed = secretAddRequestSchema.safeParse(rawRequest);
      if (!parsed.success || !this.editingTabIdOf(event.sender)) {
        return { ok: false, field: 'name', message: 'That secret could not be added' };
      }
      const { name, source, element, secret } = parsed.data;
      const result = this.store.add(name, source, element, secret);
      if (result.ok) {
        this.pushToAll();
      }
      return result;
    });
    ipcMain.on(IpcChannel.SecretsPageDelete, (event, rawRequest: unknown) => {
      const parsed = secretIdRequestSchema.safeParse(rawRequest);
      if (parsed.success && this.editingTabIdOf(event.sender) && this.store.remove(parsed.data.id)) {
        this.pushToAll();
      }
    });
    // Copies what main has stored for this id, never text the page sends — as the Bookmarks page's copy does.
    ipcMain.on(IpcChannel.SecretsPageCopy, (event, rawRequest: unknown) => {
      const parsed = secretIdRequestSchema.safeParse(rawRequest);
      const secret = parsed.success && this.secretsTabIdOf(event.sender) ? this.store.find(parsed.data.id) : undefined;
      if (secret) {
        this.copyForAWhile(secret.secret);
      }
    });
    ipcMain.on(IpcChannel.TabSecretsCaptured, (event, rawRequest: unknown) => {
      const parsed = capturedLoginSchema.safeParse(rawRequest);
      if (parsed.success) {
        this.offerToSave(event.sender, parsed.data);
      }
    });
  }

  /** Sends the current list to one Secrets tab — call once its page has loaded, since a fresh page has never been sent anything. */
  public pushTo(tabId: string): void {
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed() && this.registry.states.get(tabId)?.kind === 'secrets') {
      view.webContents.send(IpcChannel.SecretsPageList, this.store.list());
    }
  }

  /** Re-sends the list to every open Secrets tab — call whenever a secret changes. */
  public pushToAll(): void {
    for (const [tabId, state] of this.registry.states) {
      if (state.kind === 'secrets') {
        this.pushTo(tabId);
      }
    }
  }

  /**
   * Sends a web page the secrets kept for its site, to fill into their
   * boxes — call once its document is ready. Only a browser tab's own page,
   * only for the origin it's showing now; the page checks it's still there.
   * @param contents The page's `webContents`.
   */
  public fill(contents: WebContents): void {
    if (contents.isDestroyed() || !this.isBrowserTab(contents)) {
      return;
    }
    const source = secretSourceOf(contents.getURL());
    const origin = source ? secretOriginOf(source) : null;
    if (!origin) {
      return;
    }
    const secrets = this.store.forOrigin(origin);
    if (secrets.length > 0) {
      const payload: SecretFillPayload = {
        origin,
        fills: secrets.map(({ element, secret }) => ({ element, value: secret })),
      };
      contents.send(IpcChannel.TabSecretsFill, payload);
    }
  }

  /**
   * The save prompt's answer: saves the login under the names typed, or
   * lets it go. An answer to an offer that's been replaced or already
   * answered does nothing.
   * @returns Whether anything was saved.
   */
  public answer(answer: SecretPromptAnswer): boolean {
    const pending = this.pending.get(answer.id);
    this.pending.delete(answer.id);
    if (!pending || !answer.accept) {
      return false;
    }
    const secrets: LoginSecret[] = [];
    if (pending.login.username) {
      secrets.push({ name: answer.usernameName, ...pending.login.username });
    }
    secrets.push({ name: answer.passwordName, ...pending.login.password });
    const saved = this.store.saveLogin(pending.source, secrets);
    if (saved) {
      this.pushToAll();
    }
    return saved;
  }

  /**
   * Lets an offer go without saving — the prompt closed some other way (its
   * tab left, or the tab closed).
   * @param id The offer.
   */
  public discard(id: string): void {
    this.pending.delete(id);
  }

  /**
   * Offers to save a login a web page just sent, unless it's saved already
   * or secrets can't be saved here.
   * @param contents The page that sent it.
   * @param login What was typed, and where.
   */
  private offerToSave(contents: WebContents, login: CapturedLogin): void {
    const tabId = this.browserTabIdOf(contents);
    const source = secretSourceOf(contents.getURL());
    if (!tabId || !source || !this.store.canSave()) {
      return;
    }
    const values = login.username ? [login.username, login.password] : [login.password];
    if (this.store.hasLogin(source, values)) {
      return;
    }
    for (const [id, pending] of this.pending) {
      if (pending.tabId === tabId) {
        this.pending.delete(id);
      }
    }
    const id = randomUUID();
    this.pending.set(id, { tabId, source, login });
    const names = defaultSecretNames(source);
    this.registry.mountOwners.get(tabId)?.offerSecret(tabId, {
      id,
      source,
      username: login.username?.value ?? null,
      usernameName: names.username,
      passwordName: names.password,
      password: login.password.value,
    });
  }

  /** Puts a secret on the clipboard, and takes it off again after a while if nothing else was copied since. */
  private copyForAWhile(text: string): void {
    clipboard.writeText(text);
    if (this.clipboardTimer) {
      clearTimeout(this.clipboardTimer);
    }
    this.clipboardTimer = setTimeout(() => {
      this.clipboardTimer = null;
      void Promise.resolve(clipboard.readText()).then((current) => {
        if (current === text) {
          clipboard.clear();
        }
      });
    }, CLIPBOARD_CLEAR_MS);
  }

  /** The tab a `webContents` is the page of, if any. */
  private tabIdOf(sender: WebContents): string | null {
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents === sender) {
        return tabId;
      }
    }
    return null;
  }

  /** Whether a `webContents` is a browser tab's own page. */
  private isBrowserTab(sender: WebContents): boolean {
    return this.browserTabIdOf(sender) !== null;
  }

  /** As `tabIdOf`, but only for a browser tab: no app page (a note, the History table) offers or is filled. */
  private browserTabIdOf(sender: WebContents): string | null {
    const tabId = this.tabIdOf(sender);
    return tabId && this.registry.states.get(tabId)?.kind === 'browser' ? tabId : null;
  }

  /** As `tabIdOf`, but only for a Secrets tab's page. */
  private secretsTabIdOf(sender: WebContents): string | null {
    const tabId = this.tabIdOf(sender);
    return tabId && this.registry.states.get(tabId)?.kind === 'secrets' ? tabId : null;
  }

  /** As `secretsTabIdOf`, but only for a tab in edit mode: a viewed table offers no way to change anything. */
  private editingTabIdOf(sender: WebContents): string | null {
    const tabId = this.secretsTabIdOf(sender);
    const state = tabId ? this.registry.states.get(tabId) : undefined;
    return state?.kind === 'secrets' && state.mode === 'edit' ? tabId : null;
  }
}
