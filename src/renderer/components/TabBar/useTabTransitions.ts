// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { TabState } from '@shared/tab-state';

/** How long a reordered tab takes to slide into its new place. */
const SLIDE_MS = 220;

/** A tab that has closed but is still drawn while it shrinks away, at the slot it held. */
export interface ExitingTab {
  readonly tab: TabState;
  /** Its position in the strip just before it closed. */
  readonly slot: number;
}

/** What the tab strip draws on top of the plain list of tabs. */
export interface TabTransitions {
  /** Tabs that just opened, and grow in. */
  readonly enteringIds: ReadonlySet<string>;
  /** Tabs that just closed, and shrink out. */
  readonly exiting: readonly ExitingTab[];
  /** A tab's grow-in finished. */
  readonly endEnter: (id: string) => void;
  /** A closed tab finished shrinking: stop drawing it. */
  readonly endExit: (id: string) => void;
}

/**
 * The tab strip's motion: a newly opened tab grows into the row, a closed one
 * shrinks out of it, and when tabs swap places each slides from where it was
 * to where it is now (a FLIP animation: the layout changes at once, and each
 * tab is drawn offset back to its old place, then eased to its new one).
 *
 * Switching workspace swaps the whole row, which is neither an opening nor a
 * closing, so nothing animates then; a batch of tabs arriving at once (a
 * restored session) appears without the grow.
 * @param tabs The row's tabs, in their order.
 * @param workspaceId The workspace the row belongs to.
 * @param displayIds The tabs' ids in the order they're drawn (which a drag can preview differently from `tabs`).
 * @param barRef The strip element, whose `.tab-bar__tab[data-tab-id]` children are measured.
 * @param keepIds Tabs that leave the row without closing here (one torn off into its own window, still drawn
 *   until its drag ends), which mustn't also shrink out.
 * @returns The extra state to draw.
 */
export function useTabTransitions(
  tabs: readonly TabState[],
  workspaceId: string | null,
  displayIds: readonly string[],
  barRef: RefObject<HTMLElement | null>,
  keepIds: readonly string[],
): TabTransitions {
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set());
  const [exiting, setExiting] = useState<readonly ExitingTab[]>([]);
  const previousRef = useRef({ tabs, workspaceId, displayIds });

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { tabs, workspaceId, displayIds };
    if (previous.tabs === tabs && previous.workspaceId === workspaceId) {
      return;
    }
    if (previous.workspaceId !== workspaceId) {
      setEnteringIds(new Set());
      setExiting([]);
      return;
    }
    const now = new Set(tabs.map((tab) => tab.id));
    const before = new Set(previous.tabs.map((tab) => tab.id));
    const added = tabs.filter((tab) => !before.has(tab.id)).map((tab) => tab.id);
    const removed = previous.tabs
      .filter((tab) => !now.has(tab.id) && !keepIds.includes(tab.id))
      .map((tab) => ({ tab, slot: Math.max(0, previous.displayIds.indexOf(tab.id)) }));
    if (added.length === 1) {
      setEnteringIds((current) => new Set([...current, ...added]));
    }
    if (removed.length > 0) {
      setExiting((current) => [...current.filter((entry) => !now.has(entry.tab.id)), ...removed]);
    }
    // `displayIds` and `keepIds` are read as they are at the change; a new drag preview alone isn't an open or close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, workspaceId]);

  // ── The slide when tabs swap places ──
  const positionsRef = useRef(new Map<string, number>());
  const orderRef = useRef(displayIds.join('\n'));
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const elements = Array.from(bar.querySelectorAll<HTMLElement>('.tab-bar__tab[data-tab-id]'));
    const positions = new Map(elements.map((element) => [element.dataset['tabId'] ?? '', element.offsetLeft]));
    const previous = positionsRef.current;
    const order = displayIds.join('\n');
    const reordered = order !== orderRef.current;
    positionsRef.current = positions;
    orderRef.current = order;
    // Only a pure reorder slides: an opening or closing already moves its neighbours as it grows or shrinks.
    const sameTabs = previous.size === positions.size && [...positions.keys()].every((id) => previous.has(id));
    if (!reordered || !sameTabs || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    for (const element of elements) {
      const from = previous.get(element.dataset['tabId'] ?? '');
      const delta = from === undefined ? 0 : from - element.offsetLeft;
      if (Math.abs(delta) > 1) {
        element.animate([{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], {
          duration: SLIDE_MS,
          easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
        });
      }
    }
  });

  const endEnter = useCallback((id: string): void => {
    setEnteringIds((current) => {
      if (!current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const endExit = useCallback((id: string): void => {
    setExiting((current) => current.filter((entry) => entry.tab.id !== id));
  }, []);

  return { enteringIds, exiting, endEnter, endExit };
}
