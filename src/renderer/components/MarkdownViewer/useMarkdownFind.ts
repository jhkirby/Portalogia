// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useRef, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';
import type { FindCommand } from '@shared/ipc-contract';
import { buildFindPattern, clampOccurrence, findMatches, MAX_FIND_MATCHES, stepIndex, type FindMatch, type FindOptions } from '@shared/find';
import { setEditorFind } from '../../lib/markdown/editorFind';
import { collectRenderedText, rangeForOffsets } from '../../lib/markdown/textOffsets';

/** Names registered with `CSS.highlights` for the matches in the rendered note, painted by `markdown-viewer.css`. */
const ALL_NAME = 'portalogia-md-find';
const CURRENT_NAME = 'portalogia-md-find-current';

/** How long typing in the editor must pause before the find bar's matches are recounted. */
const EDIT_RECOUNT_MS = 150;

interface UseMarkdownFindParams {
  /** Which of the two views the matches are in. */
  readonly mode: 'view' | 'edit';
  /** Whether a note is open at all — find has nothing to search before one is. */
  readonly hasNote: boolean;
  /** The element the reader draws the note inside (view mode); the note itself is its `.md-reader`. */
  readonly readerHostRef: RefObject<HTMLElement | null>;
  /** The editor (edit mode), once it exists. */
  readonly editorViewRef: RefObject<EditorView | null>;
  /** The element that scrolls in view mode. */
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** Changes whenever what the search runs over does: the note drawn anew, the mode, an edit. A change re-runs the last search. */
  readonly contentVersion: number;
}

/**
 * Answers the find bar (Ctrl+F — the same bar every tab uses) for a note, in
 * whichever view is showing. The bar lives in its own view; this answers its
 * commands (`window.portalogiaMarkdown.onFind`).
 *
 * In the rendered view it searches the note's visible text (not the page's
 * own buttons) and paints the matches with `CSS.highlights`. In the editor
 * it searches the source and marks the matches as editor decorations. Either
 * way the last search is remembered and run again when the note changes or
 * the mode flips, so the bar's count and highlights never go stale.
 */
export function useMarkdownFind({ mode, hasNote, readerHostRef, editorViewRef, scrollRef, contentVersion }: UseMarkdownFindParams): void {
  const searchRef = useRef<{ query: string; options: FindOptions } | null>(null);
  const matchesRef = useRef<readonly FindMatch[]>([]);
  const currentRef = useRef(-1);
  const cappedRef = useRef(false);

  // Everything the effects below need, in one function that reads the refs, so a command and a content change run the same code.
  const runRef = useRef<(reveal: boolean, restart: boolean) => void>(() => undefined);

  runRef.current = (reveal: boolean, restart: boolean): void => {
    const search = searchRef.current;
    const report = (invalid: boolean): void => {
      window.portalogiaMarkdown.reportFind({
        index: matchesRef.current.length === 0 ? 0 : currentRef.current + 1,
        total: matchesRef.current.length,
        capped: cappedRef.current,
        invalid,
      });
    };
    const clearPaint = (): void => {
      CSS.highlights.delete(ALL_NAME);
      CSS.highlights.delete(CURRENT_NAME);
      editorViewRef.current?.dispatch({ effects: setEditorFind.of({ matches: [], current: -1 }) });
    };
    if (!search || !hasNote) {
      matchesRef.current = [];
      currentRef.current = -1;
      clearPaint();
      return;
    }
    const pattern = buildFindPattern(search.query, search.options);
    if (pattern.kind !== 'ok') {
      matchesRef.current = [];
      currentRef.current = -1;
      clearPaint();
      report(pattern.kind === 'invalid');
      return;
    }

    if (mode === 'edit') {
      CSS.highlights.delete(ALL_NAME);
      CSS.highlights.delete(CURRENT_NAME);
      const view = editorViewRef.current;
      if (!view) {
        return;
      }
      const result = findMatches(view.state.doc.toString(), pattern.regExp, MAX_FIND_MATCHES);
      matchesRef.current = result.matches;
      cappedRef.current = result.capped;
      if (restart || currentRef.current < 0 || currentRef.current >= result.matches.length) {
        const head = view.state.selection.main.head;
        const next = result.matches.findIndex((match) => match.start >= head);
        currentRef.current = result.matches.length === 0 ? -1 : Math.max(next, 0);
      }
      const current = result.matches[currentRef.current];
      view.dispatch({
        effects: [
          setEditorFind.of({
            matches: result.matches.map((match) => ({ from: match.start, to: match.end })),
            current: currentRef.current,
          }),
          ...(reveal && current ? [EditorView.scrollIntoView(current.start, { y: 'center' })] : []),
        ],
      });
      report(false);
      return;
    }

    const root = readerHostRef.current?.querySelector<HTMLElement>('.md-reader');
    if (!root) {
      return;
    }
    const rendered = collectRenderedText(root);
    const result = findMatches(rendered.text, pattern.regExp, MAX_FIND_MATCHES);
    matchesRef.current = result.matches;
    cappedRef.current = result.capped;
    const ranges = result.matches.map((match) => rangeForOffsets(rendered, match.start, match.end));
    if (restart || currentRef.current < 0 || currentRef.current >= result.matches.length) {
      // Start at the first match on screen (or the one after, if none is).
      const top = scrollRef.current?.getBoundingClientRect().top ?? 0;
      const firstVisible = ranges.findIndex((range) => range !== null && range.getBoundingClientRect().bottom > top);
      currentRef.current = result.matches.length === 0 ? -1 : Math.max(firstVisible, 0);
    }
    const all = ranges.filter((range): range is Range => range !== null);
    if (all.length > 0) {
      CSS.highlights.set(ALL_NAME, new Highlight(...all));
    } else {
      CSS.highlights.delete(ALL_NAME);
    }
    const currentRange = ranges[currentRef.current] ?? null;
    if (currentRange) {
      const emphasized = new Highlight(currentRange);
      emphasized.priority = 1;
      CSS.highlights.set(CURRENT_NAME, emphasized);
      if (reveal) {
        currentRange.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    } else {
      CSS.highlights.delete(CURRENT_NAME);
    }
    report(false);
  };

  useEffect(
    () =>
      window.portalogiaMarkdown.onFind((command: FindCommand) => {
        switch (command.action) {
          case 'search':
            searchRef.current = { query: command.query, options: command.options };
            currentRef.current = -1;
            runRef.current(true, true);
            break;
          case 'step':
            if (matchesRef.current.length > 0) {
              currentRef.current = stepIndex(currentRef.current, command.direction, matchesRef.current.length);
              runRef.current(true, false);
            }
            break;
          case 'goto':
            if (matchesRef.current.length > 0) {
              currentRef.current = clampOccurrence(command.index, matchesRef.current.length);
              runRef.current(true, false);
            }
            break;
          case 'clear':
            searchRef.current = null;
            matchesRef.current = [];
            currentRef.current = -1;
            runRef.current(false, true);
            break;
        }
      }),
    [],
  );

  // The note changed under the search: recount, without jumping the view around.
  useEffect(() => {
    if (!searchRef.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => runRef.current(false, false), mode === 'edit' ? EDIT_RECOUNT_MS : 0);
    return () => window.clearTimeout(timer);
  }, [contentVersion, mode, hasNote]);

  useEffect(
    () => () => {
      CSS.highlights.delete(ALL_NAME);
      CSS.highlights.delete(CURRENT_NAME);
    },
    [],
  );
}
