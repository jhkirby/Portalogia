// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { contextBridge, ipcRenderer } from 'electron';
import type { NorthstarSecretsApi, SecretState, SecretUpdateResult } from '@shared/ipc-contract';

// Channel names inlined as literals — see `terminal.ts` for why a sandboxed
// preload can't share the `IpcChannel` runtime object. `SecretsController`
// and `TabManager` (main) send and listen on the same strings.
const SecretsPageList = 'secrets-page:list';
const SecretsPageQuery = 'secrets-page:query';
const SecretsPageMode = 'secrets-page:mode';
const SecretsPageUpdate = 'secrets-page:update';
const SecretsPageDelete = 'secrets-page:delete';
const SecretsPageCopy = 'secrets-page:copy';
const SecretsPageAddRow = 'secrets-page:add-row';
const SecretsPageAdd = 'secrets-page:add';

// The page has no zoom: stopping Ctrl+wheel here keeps Chromium's own pinch/ctrl-wheel zoom from acting on it.
window.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  },
  { passive: false, capture: true },
);

/**
 * A value main pushes, kept so a listener subscribing after it arrived is
 * still handed it at once (the page's effects run after the first push can).
 * Repeated from `bookmarks.ts`: two preload entries can't share a module.
 * @param channel The channel main sends it on.
 */
function latestFrom<T>(channel: string): (listener: (value: T) => void) => () => void {
  let latest: { readonly value: T } | null = null;
  const listeners = new Set<(value: T) => void>();
  ipcRenderer.on(channel, (_event, value: T) => {
    latest = { value };
    listeners.forEach((listener) => listener(value));
  });
  return (listener) => {
    listeners.add(listener);
    if (latest !== null) {
      listener(latest.value);
    }
    return () => {
      listeners.delete(listener);
    };
  };
}

const api: NorthstarSecretsApi = {
  onSecrets: latestFrom<readonly SecretState[]>(SecretsPageList),
  onQuery: latestFrom<string>(SecretsPageQuery),
  onMode: latestFrom<'view' | 'edit'>(SecretsPageMode),
  update: (id, name, source, secret) =>
    ipcRenderer.invoke(SecretsPageUpdate, { id, name, source, secret }) as Promise<SecretUpdateResult>,
  // A press, not a state: only those after the page subscribes mean anything (the tab is open and showing by then).
  onAddRow: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(SecretsPageAddRow, handler);
    return () => {
      ipcRenderer.removeListener(SecretsPageAddRow, handler);
    };
  },
  add: (name, source, element, secret) =>
    ipcRenderer.invoke(SecretsPageAdd, { name, source, element, secret }) as Promise<SecretUpdateResult>,
  remove: (id) => {
    ipcRenderer.send(SecretsPageDelete, { id });
  },
  copy: (id) => {
    ipcRenderer.send(SecretsPageCopy, { id });
  },
};

contextBridge.exposeInMainWorld('northstarSecrets', api satisfies NorthstarSecretsApi);
