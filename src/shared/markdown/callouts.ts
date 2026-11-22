// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

/** How a callout type is drawn: its colour family and the title it shows when the note gives none. */
export interface CalloutKind {
  readonly family: string;
  readonly title: string;
}

/**
 * The colour family and default title of each Obsidian callout type — shared
 * by the reader (which turns `> [!type]` quotes into boxes) and the formatted
 * editor (which offers the types in its callout picker).
 */
export const CALLOUT_KINDS: Readonly<Record<string, CalloutKind>> = {
  note: { family: 'blue', title: 'Note' },
  info: { family: 'blue', title: 'Info' },
  todo: { family: 'blue', title: 'To do' },
  abstract: { family: 'cyan', title: 'Abstract' },
  summary: { family: 'cyan', title: 'Summary' },
  tldr: { family: 'cyan', title: 'TL;DR' },
  tip: { family: 'cyan', title: 'Tip' },
  hint: { family: 'cyan', title: 'Hint' },
  important: { family: 'cyan', title: 'Important' },
  success: { family: 'green', title: 'Success' },
  check: { family: 'green', title: 'Check' },
  done: { family: 'green', title: 'Done' },
  question: { family: 'orange', title: 'Question' },
  help: { family: 'orange', title: 'Help' },
  faq: { family: 'orange', title: 'FAQ' },
  warning: { family: 'orange', title: 'Warning' },
  caution: { family: 'orange', title: 'Caution' },
  attention: { family: 'orange', title: 'Attention' },
  failure: { family: 'red', title: 'Failure' },
  fail: { family: 'red', title: 'Failure' },
  missing: { family: 'red', title: 'Missing' },
  danger: { family: 'red', title: 'Danger' },
  error: { family: 'red', title: 'Error' },
  bug: { family: 'red', title: 'Bug' },
  example: { family: 'purple', title: 'Example' },
  quote: { family: 'gray', title: 'Quote' },
  cite: { family: 'gray', title: 'Quote' },
};

/**
 * The types the editor's picker offers: one per distinct look, in the order
 * Obsidian lists them (the aliases — `hint`, `fail`, `cite`… — stay readable
 * but aren't offered twice).
 */
export const CALLOUT_PICKER_TYPES: readonly string[] = [
  'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
];

/** `[!type]`, an optional fold sign, then an optional title, at the start of a quote's first line. */
export const CALLOUT_PATTERN = /^\s*\[!([A-Za-z]+)\]([+-])?[ \t]*([^\n]*)\n?/;

/**
 * How a callout type is drawn; an unknown type is blue and titled after itself.
 * @param type The type as written, any case.
 */
export function calloutKind(type: string): CalloutKind {
  const key = type.toLowerCase();
  return CALLOUT_KINDS[key] ?? { family: 'blue', title: key.charAt(0).toUpperCase() + key.slice(1) };
}
