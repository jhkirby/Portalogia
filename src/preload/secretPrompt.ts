// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { contextBridge, ipcRenderer } from 'electron';
import type { NorthstarSecretPromptApi, SecretPromptOffer } from '@shared/ipc-contract';

// Channel names inlined as literals — see `terminal.ts` for why. `SecretPromptOverlay` (main) uses the same strings.
const SecretPromptShow = 'secret-prompt:show';
const SecretPromptAnswer = 'secret-prompt:answer';
const SecretPromptHeight = 'secret-prompt:height';

// The latest offer, kept so the page's first subscription (after main may already have sent one) still gets it.
let latest: { readonly offer: SecretPromptOffer | null } | null = null;
const listeners = new Set<(offer: SecretPromptOffer | null) => void>();
ipcRenderer.on(SecretPromptShow, (_event, offer: SecretPromptOffer | null) => {
  latest = { offer };
  listeners.forEach((listener) => listener(offer));
});

const api: NorthstarSecretPromptApi = {
  onOffer: (listener) => {
    listeners.add(listener);
    if (latest !== null) {
      listener(latest.offer);
    }
    return () => {
      listeners.delete(listener);
    };
  },
  answer: (answer) => {
    ipcRenderer.send(SecretPromptAnswer, answer);
  },
  reportHeight: (height) => {
    ipcRenderer.send(SecretPromptHeight, height);
  },
};

contextBridge.exposeInMainWorld('northstarSecretPrompt', api satisfies NorthstarSecretPromptApi);
