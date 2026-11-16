// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

/** Who wants to hear that some page's marks changed. */
const listeners = new Set<() => void>();

/**
 * Says that a page's marks changed — a highlight, comment, text box or pen
 * stroke on a web page, or a PDF's or note's marks. Called by each mark store
 * as it changes; whoever listens (`onAnnotationsChanged`) then looks again at
 * what it cares about, as the Tools sidebar's Revert does whether there's
 * anything left to revert.
 */
export function notifyAnnotationsChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Listens for any page's marks changing (`notifyAnnotationsChanged`).
 * @param listener Called after each change.
 * @returns A function that stops listening.
 */
export function onAnnotationsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
