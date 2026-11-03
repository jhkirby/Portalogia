// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/**
 * The words after a code fence that name a language main can run — so the
 * page knows which blocks to give a Run button. Main's `MarkdownCodeRunner`
 * is the authority (it refuses anything else), and a unit test keeps this
 * list and its own in step.
 */
export const RUNNABLE_LANGUAGE_NAMES: readonly string[] = [
  'js', 'javascript', 'node', 'mjs', 'cjs',
  'python', 'py', 'python3',
  'bash', 'shell', 'zsh', 'sh',
  'powershell', 'pwsh', 'ps1',
  'cmd', 'bat', 'batch',
  'ruby', 'rb', 'perl', 'pl', 'php', 'lua', 'go', 'golang',
];

/** Whether a fence's language word names a language a block can be run in. */
export function isRunnableName(language: string): boolean {
  return RUNNABLE_LANGUAGE_NAMES.includes(language.trim().toLowerCase());
}
