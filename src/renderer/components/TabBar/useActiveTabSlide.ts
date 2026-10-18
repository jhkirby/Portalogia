// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { useLayoutEffect, useRef, type RefObject } from 'react';

/** How long the active tab's background takes to slide to the newly active tab; the same as a reordered tab's. */
const SLIDE_MS = 220;

/** How long after a press on a tab its activation still counts as a click (which shows a ripple, not a slide). */
const CLICK_WINDOW_MS = 600;

/**
 * Slides the active tab's background from the tab that was active to the one
 * that is now, when the switch comes from the keyboard (Ctrl+Left/Right,
 * wrapping round included). A click shows its ripple instead, and a tab that
 * just opened, one that just closed, or a whole new workspace switches at once.
 *
 * The moving background is drawn in pieces, one in every tab's own effects
 * layer (`.tab-bar__slide-layer`), each showing the part of it over that tab.
 * A single block above the strip would cover the titles it passes; drawn this
 * way it passes under them, like the active tab's own background. The new tab
 * shows no background of its own until the slide arrives (`data-slide-target`).
 * @param barRef The strip element, whose `.tab-bar__tab[data-tab-id]` children are the tabs.
 * @param activeTabId The active tab.
 * @param workspaceId The workspace the strip shows.
 * @param tabIds The strip's tab ids.
 * @returns A press handler for the strip, which tells a click apart from a keyboard switch.
 */
export function useActiveTabSlide(
  barRef: RefObject<HTMLElement | null>,
  activeTabId: string | null,
  workspaceId: string | null,
  tabIds: readonly string[],
): (pressedTabId: string | null) => void {
  const previousRef = useRef({ activeTabId, workspaceId, tabIds });
  const pressRef = useRef<{ id: string; at: number } | null>(null);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { activeTabId, workspaceId, tabIds };
    const bar = barRef.current;
    const from = previous.activeTabId;
    const to = activeTabId;
    const press = pressRef.current;
    const clicked = press !== null && press.id === to && performance.now() - press.at < CLICK_WINDOW_MS;
    if (
      !bar ||
      from === null ||
      to === null ||
      from === to ||
      clicked ||
      previous.workspaceId !== workspaceId ||
      !tabIds.includes(from) ||
      !previous.tabIds.includes(to) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const tabs = Array.from(bar.querySelectorAll<HTMLElement>('.tab-bar__tab[data-tab-id]'));
    const fromTab = tabs.find((tab) => tab.dataset['tabId'] === from);
    const toTab = tabs.find((tab) => tab.dataset['tabId'] === to);
    if (!fromTab || !toTab) {
      return;
    }
    // `offsetLeft` is the laid-out place, untouched by any slide of the tabs themselves.
    const start = { left: fromTab.offsetLeft, width: fromTab.offsetWidth };
    const end = { left: toTab.offsetLeft, width: toTab.offsetWidth };
    const pieces = tabs.flatMap((tab) => {
      const layer = tab.querySelector<HTMLElement>('.tab-bar__slide-layer');
      if (!layer) {
        return [];
      }
      const piece = document.createElement('span');
      piece.className = 'tab-bar__active-slide';
      layer.append(piece);
      const animation = piece.animate(
        [
          { left: `${start.left - tab.offsetLeft}px`, width: `${start.width}px` },
          { left: `${end.left - tab.offsetLeft}px`, width: `${end.width}px` },
        ],
        { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
      );
      return [{ piece, animation }];
    });
    toTab.dataset['slideTarget'] = '';
    const finish = (): void => {
      delete toTab.dataset['slideTarget'];
      pieces.forEach(({ piece }) => piece.remove());
    };
    // Every piece runs the same timing, so the first to end means all have.
    void pieces[0]?.animation.finished.then(finish, finish);
    if (pieces.length === 0) {
      finish();
    }
    // Only an actual change of the active tab slides; the strip's other changes are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, workspaceId]);

  return (pressedTabId) => {
    pressRef.current = pressedTabId === null ? null : { id: pressedTabId, at: performance.now() };
  };
}
