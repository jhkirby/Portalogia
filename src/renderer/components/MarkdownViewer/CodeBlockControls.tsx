// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useState } from 'react';
import type { MarkdownRunResult } from '@shared/ipc-contract';

/** What a code block shows under it: nothing yet, a run in progress, or how the last one went. */
export type RunState =
  | { readonly status: 'running' }
  | { readonly status: 'done'; readonly result: MarkdownRunResult };

interface CodeBlockControlsProps {
  readonly language: string;
  readonly code: string;
  readonly runnable: boolean;
  readonly running: boolean;
  readonly onRun: () => void;
}

/**
 * The buttons at a code block's top-right corner: its language, Copy, and —
 * for a language that can be run — Run. Drawn into the block by a portal (see
 * `MarkdownReader`), so it is part of the page, not of the note's text.
 */
export function CodeBlockControls({ language, code, runnable, running, onRun }: CodeBlockControlsProps) {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="md-code-controls">
      {language !== '' && <span className="md-code-controls__language">{language}</span>}
      <button type="button" className="md-code-controls__button" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      {runnable && (
        <button
          type="button"
          className="md-code-controls__button md-code-controls__button--run"
          onClick={onRun}
          disabled={running}
        >
          {running ? 'Running…' : '▶ Run'}
        </button>
      )}
    </div>
  );
}

interface CodeOutputProps {
  readonly state: RunState;
  readonly onClear: () => void;
}

/** What a code block printed: its output, its errors, how it ended — or why it wouldn't run. */
export function CodeOutput({ state, onClear }: CodeOutputProps) {
  if (state.status === 'running') {
    return <div className="md-code-output md-code-output--running">Running…</div>;
  }
  const { result } = state;
  if (!result.ran) {
    return (
      <div className="md-code-output md-code-output--error">
        <button type="button" className="md-code-output__clear" onClick={onClear} aria-label="Dismiss output">
          ×
        </button>
        {result.error ?? 'The code could not be run.'}
      </div>
    );
  }
  const failed = result.timedOut || (result.exitCode !== null && result.exitCode !== 0);
  const summary = result.timedOut
    ? 'Stopped after 30 seconds'
    : `Exited with code ${result.exitCode ?? '?'} in ${result.durationMs} ms`;
  return (
    <div className={`md-code-output${failed ? ' md-code-output--failed' : ''}`}>
      <button type="button" className="md-code-output__clear" onClick={onClear} aria-label="Dismiss output">
        ×
      </button>
      {result.stdout !== '' && <pre className="md-code-output__text">{result.stdout}</pre>}
      {result.stderr !== '' && <pre className="md-code-output__text md-code-output__text--stderr">{result.stderr}</pre>}
      {result.stdout === '' && result.stderr === '' && <div className="md-code-output__empty">No output</div>}
      <div className="md-code-output__summary">
        {summary}
        {result.truncated ? ' · output cut short' : ''}
      </div>
    </div>
  );
}
