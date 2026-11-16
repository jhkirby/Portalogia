// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { BookmarkState, TabState } from '@shared/tab-state';
import { pageLabel } from '../../lib/pageLabel';
import { MAX_TABS_PER_WORKSPACE } from '@shared/constants';
import { previewTabOrder } from '../../lib/previewTabOrder';
import { tabDropTargetAt } from '../../lib/tabDropTarget';
import { formatShortcut } from '../../lib/shortcuts';
import { BookmarksIcon, GlobeIcon, HistoryIcon, LockIcon } from '../icons';
import { SHIMMER_PERIOD_MS, useShimmerTick } from '../../hooks/useShimmerTick';
import { useTabTransitions } from './useTabTransitions';
import { useActiveTabSlide } from './useActiveTabSlide';
import { useClickRipples } from '../../hooks/useClickRipples';
import { NewTabMenu } from '../NewTabMenu';
import { useSharedFitText } from '../../hooks/useFitText';

/** A tab title's full size, in px: the tab row's own (`--size-font-md`). */
const TITLE_FONT_PX = 13;

/** The smallest a tab's title shrinks to as tabs narrow; below this it would be hard to read, so the ellipsis takes over. */
const TITLE_MIN_FONT_PX = 10;

/** Every tab's title, all sized together. */
const TITLE_SELECTOR = '.tab-bar__title';

/** The titles whose fit decides that size: tabs at rest, not still opening or closing (an animation squeezes them). */
const RESTING_TITLE_SELECTOR = '.tab-bar__tab:not(.tab-bar__tab--entering):not(.tab-bar__tab--exiting) .tab-bar__title';

// A native HTML5 drag shows the browser's own snapshot of the dragged
// element following the cursor by default; over this chrome's mix of HTML
// and layered native `WebContentsView`s that snapshot renders in the wrong
// place entirely (see the tab drag-and-drop work this came from). Handing
// `setDragImage` a fully transparent 1x1 pixel suppresses that snapshot,
// leaving only the dragged tab's own in-place `--dragging` highlight.
const TRANSPARENT_DRAG_IMAGE = new Image();
TRANSPARENT_DRAG_IMAGE.src =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';

/** The animation (in `tab-bar.css`) that ends a tab's opening, and the one that ends its closing. */
const TAB_TRANSITION_LAST_ANIMATIONS = new Set(['tab-bar-tab-rise', 'tab-bar-tab-close']);

/** Stands in for every handler of a closing tab, which takes no input while it shrinks away. */
const noop = (): void => undefined;

/** How far below the tab strip the cursor must travel before the tab tears off into its own window. */
const TEAR_OFF_MARGIN_PX = 16;
/** How long the cursor must stay out of the tab strip before it tears off — see `onDragMove`. */
const TEAR_OFF_DWELL_MS = 200;

interface TabBarProps {
  /** Tabs to render, left to right, in the order they were opened. */
  readonly tabs: readonly TabState[];
  /** The workspace the tabs belong to: switching it swaps the whole row, which isn't animated as tabs opening and closing. */
  readonly workspaceId: string | null;
  /** Every saved bookmark — a bookmarked page's tab shows its saved name, like the address bar's bubble. */
  readonly bookmarks: readonly BookmarkState[];
  /** Id of the tab drawn as selected; `null` while no window has one yet. */
  readonly activeTabId: string | null;
  /** The tabs multi-selected with Ctrl/Shift+click (active tab included), or empty — they're drawn selected. */
  readonly selectedTabIds: readonly string[];
  /** Ctrl+click: add/remove a tab from the selection without switching to it. */
  readonly onToggleSelect: (id: string) => void;
  /** Shift+click: select every tab from the active one to this one. */
  readonly onSelectRange: (id: string) => void;
  /** Called when the user picks a different tab. */
  readonly onActivate: (id: string) => void;
  /** Called when the user closes a tab. */
  readonly onClose: (id: string) => void;
  /** Called when a drag-and-drop reorder finishes: `beforeId` is the tab it should land before, or `null` for the end of the row. */
  readonly onReorder: (id: string, beforeId: string | null) => void;
  /** The tab grabbed for keyboard reordering (Ctrl+Space held, then Left/Right to nudge it — see `TabManager.grabTabForReorder`), or `null` when nothing is grabbed. Shares the mouse-drag's `--dragging` highlight. */
  readonly grabbedTabId: string | null;
  /**
   * Called when a tab drag ends without landing on any drop target this
   * chrome itself recognizes (an in-bar reorder, or a `WorkspaceBar` pill)
   * — `screenX`/`screenY` are the drag's OS screen coordinates at release,
   * for main to decide whether the release point actually left this
   * window (see `tearOffTab`), which alone means "open this tab in a new
   * window."
   */
  readonly onDragEndOutside: (id: string, screenX: number, screenY: number) => void;
  /** Called once, mid-drag, the moment the cursor leaves this window — main opens the new window right then and keeps it under the cursor, like Chrome. */
  readonly onDragOutOfWindow: (id: string, screenX: number, screenY: number) => void;
  /** Called when a drag that already tore off (`onDragOutOfWindow`) is released, so main stops moving the new window. */
  readonly onTearOffEnd: (id: string, accepted: boolean) => void;
  /** Called when a tab drag starts, with the window's other drop targets (workspace pills, "+ New workspace") — see `PortalogiaApi.reportDropRegions`. */
  readonly onReportDropRegions: (rects: readonly { x: number; y: number; width: number; height: number }[]) => void;
  /**
   * The workspace's split pair, left then right (`BrowserState.splitPair`): side by side in the row, drawn as one joint
   * tab with no line between its two — shown or put away. `null` with none.
   */
  readonly pairTabIds: readonly [string, string] | null;
  /** While split, the two tabs on screen: both look active, as both are being shown. */
  readonly splitTabIds: readonly string[];
}

/** Which half of a tab the dragged tab is currently hovering over — drives which side of it `beforeId` resolves to on drop. */
type DropPosition = 'before' | 'after';

interface DropTarget {
  readonly id: string;
  readonly position: DropPosition;
}

/** The row of open tabs at the top of the window, plus a "new tab" button. */
export function TabBar({
  tabs,
  workspaceId,
  bookmarks,
  activeTabId,
  selectedTabIds,
  onToggleSelect,
  onSelectRange,
  onActivate,
  onClose,
  onReorder,
  grabbedTabId,
  onDragEndOutside,
  onDragOutOfWindow,
  onTearOffEnd,
  onReportDropRegions,
  pairTabIds,
  splitTabIds,
}: TabBarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Set once the drag has already torn off into its own window, so the
  // release doesn't tear it off a second time (`onDragEndOutside`).
  const tornOffRef = useRef(false);
  // When the cursor last left the tab strip's tear-off zone, or null while it's inside.
  const outsideSinceRef = useRef<number | null>(null);
  // Last known copy of the dragged tab: once it tears off, it leaves
  // `tabs`, and unmounting its element would silently kill the in-flight
  // native drag (no `dragend`). It's kept rendered, invisibly, until release.
  const draggedTabRef = useRef<TabState | null>(null);
  const draggedTab = draggedId !== null ? tabs.find((tab) => tab.id === draggedId) : undefined;
  if (draggedTab) {
    draggedTabRef.current = draggedTab;
  }
  const ghostTab = draggedId !== null && !draggedTab ? draggedTabRef.current : null;
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  // Every title shrinks together as the tabs narrow, rather than ending in "…", down to a size still easy to read: the
  // size the most crowded title needs.
  useSharedFitText(
    tabBarRef,
    TITLE_SELECTOR,
    RESTING_TITLE_SELECTOR,
    tabs.map((tab) => `${tab.kind}:${tab.title}`).join('\n'),
    TITLE_FONT_PX,
    TITLE_MIN_FONT_PX,
  );

  const endDrag = (): void => {
    tornOffRef.current = false;
    outsideSinceRef.current = null;
    draggedTabRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  };

  /**
   * A drop place moved off the gap inside the split pair, which nothing may go into: before its right tab is before
   * the pair, and after its left tab is after it.
   * @param target Where a release would put the dragged tab(s), or `null`.
   * @returns The same place, or the nearest one outside the pair.
   */
  const keepPairWhole = (target: { id: string; position: 'before' | 'after' } | null): typeof target => {
    if (!target || !pairTabIds) {
      return target;
    }
    const [left, right] = pairTabIds;
    if (target.id === right && target.position === 'before') {
      return { id: left, position: 'before' };
    }
    if (target.id === left && target.position === 'after') {
      return { id: right, position: 'after' };
    }
    return target;
  };

  // Reads the dragged tab's id from `dataTransfer`, not the local
  // `draggedId` state — `draggedId` is only ever set by this *same*
  // window's own `Tab.onDragStart` (see below), so it stays `null` for a
  // drag dragged in from another window's tab bar, which never fires that
  // handler here. `dataTransfer` carries the id regardless of which
  // window's DOM started the drag, since it's the OS-level drag session's
  // own payload, not any one renderer's local state — same reasoning
  // `WorkspaceBar`'s own drop handlers already use.
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    const draggedTabId = event.dataTransfer.getData('text/plain');
    const target = keepPairWhole(dropTarget);
    if (draggedTabId && target) {
      const targetIndex = tabs.findIndex((tab) => tab.id === target.id);
      const insertIndex = target.position === 'before' ? targetIndex : targetIndex + 1;
      onReorder(draggedTabId, tabs[insertIndex]?.id ?? null);
    }
    endDrag();
  };

  // Fallback for the drag crossing off the last tab entirely — onto the
  // "+" button, or any gap `.tab-bar`'s own flex row leaves past the
  // tabs — where no `Tab` is underneath to report a precise before/after
  // position. `drop`/`dragover` both bubble, so this still fires (and
  // still needs its own `preventDefault`) even when the event originated
  // on a `Tab` beneath it; the `closest` check below only takes over when
  // it didn't, defaulting to "append at the end" rather than leaving
  // whatever `dropTarget` a previous, no-longer-relevant hover left set.
  const handleContainerDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggedId !== null) {
      previewLocalDrag(event.clientX);
      return;
    }
    const overTab = (event.target as HTMLElement).closest('.tab-bar__tab');
    const lastTab = tabs[tabs.length - 1];
    if (!overTab && lastTab) {
      setDropTarget({ id: lastTab.id, position: 'after' });
    }
  };

  // A tab from this strip: the target is read from where the tabs are laid out, not from which tab's half the pointer
  // is over. The preview moves tabs under the pointer and they slide there, so the hovered tab, and which half of it
  // the pointer is in, kept changing under a still pointer and the tabs flipped back and forth (`tabDropTargetAt`).
  const previewLocalDrag = (clientX: number): void => {
    const elements = Array.from(tabBarRef.current?.querySelectorAll<HTMLElement>('.tab-bar__tab[data-tab-id]') ?? []);
    const parent = elements[0]?.offsetParent;
    if (!parent) {
      return;
    }
    // `offsetLeft` is the laid-out place, which a sliding tab's animated transform doesn't change.
    const x = clientX - parent.getBoundingClientRect().left - parent.clientLeft + parent.scrollLeft;
    const slots = elements
      .map((element) => ({ id: element.dataset['tabId'] ?? '', left: element.offsetLeft, width: element.offsetWidth }))
      .sort((first, second) => first.left - second.left);
    const target = tabDropTargetAt(slots, draggedGroup, x);
    const last = slots[slots.length - 1];
    if (target) {
      setDropTarget((current) =>
        current?.id === target.id && current.position === target.side ? current : { id: target.id, position: target.side },
      );
    } else if (last && x >= last.left + last.width) {
      // Past the last tab (the "+" button, or the empty strip): the end.
      const lastRest = [...slots].reverse().find((slot) => !draggedGroup.includes(slot.id));
      if (lastRest) {
        setDropTarget((current) => (current?.id === lastRest.id && current.position === 'after' ? current : { id: lastRest.id, position: 'after' }));
      }
    }
  };

  const handleContainerDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    handleDrop(event);
  };

  // While a tab from this strip is dragged, the strip previews where a release
  // would leave it: the dragged tab(s) sit in the target slot and the others
  // make room. Done with CSS `order`, not by reordering the elements, because
  // moving the dragged element in the DOM mid-drag cancels the native drag.
  // Nothing is committed until the drop (`handleDrop` -> `onReorder`).
  // The split pair is one tab in the row, so grabbing either of its two drags both, left then right.
  const draggedGroup =
    draggedId === null
      ? []
      : pairTabIds?.includes(draggedId)
        ? [...pairTabIds]
        : selectedTabIds.includes(draggedId)
          ? selectedTabIds.filter((id) => tabs.some((tab) => tab.id === id))
          : [draggedId];
  const pairTarget = keepPairWhole(dropTarget);
  const displayIds = previewTabOrder(
    tabs.map((tab) => tab.id),
    draggedGroup,
    pairTarget?.id ?? null,
    pairTarget?.position ?? 'before',
  );
  const orderOf = (id: string): number => {
    const index = displayIds.indexOf(id);
    return index === -1 ? displayIds.length : index;
  };
  // A tab dragged in from another window has no element here to move, so the
  // slot it would take is held open with a blank placeholder instead.
  const foreignInsertAt =
    draggedId === null && pairTarget !== null
      ? tabs.findIndex((tab) => tab.id === pairTarget.id) + (pairTarget.position === 'after' ? 1 : 0)
      : null;
  // Every 20 s a shimmer runs along the tabs' icons and names, ten seconds out of step with the workspaces', so one of
  // the two runs every ten seconds.
  const shimmer = useShimmerTick(SHIMMER_PERIOD_MS / 2);
  const { enteringIds, exiting, endEnter, endExit } = useTabTransitions(
    tabs,
    workspaceId,
    displayIds,
    tabBarRef,
    draggedId === null ? [] : [draggedId],
  );
  const notePress = useActiveTabSlide(
    tabBarRef,
    activeTabId,
    workspaceId,
    tabs.map((tab) => tab.id),
  );
  /** Which half of the split pair's joint tab a tab is, if either. */
  const pairSideOf = (tabId: string): 'left' | 'right' | undefined =>
    pairTabIds?.[0] === tabId ? 'left' : pairTabIds?.[1] === tabId ? 'right' : undefined;
  // Live tabs take the even `order` slots and a closing tab the odd slot just before the tab that took its place, so
  // it shrinks where it was.
  const slotOrder = (index: number): number => 2 * index + 2;

  return (
    <div
      ref={tabBarRef}
      className="tab-bar"
      data-shimmer={shimmer ?? undefined}
      role="tablist"
      aria-label="Open tabs"
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      onPointerDown={(event) =>
        notePress((event.target as HTMLElement).closest<HTMLElement>('.tab-bar__tab[data-tab-id]')?.dataset['tabId'] ?? null)
      }
    >
      {(ghostTab ? [...tabs, ghostTab] : tabs).map((tab) => (
        <Tab
          pairSide={pairSideOf(tab.id)}
          key={tab.id}
          tab={tab}
          label={tab.kind === 'browser' ? pageLabel(tab.url, bookmarks) : null}
          isGhost={tab === ghostTab}
          order={slotOrder(foreignInsertAt !== null && orderOf(tab.id) >= foreignInsertAt ? orderOf(tab.id) + 1 : orderOf(tab.id))}
          isEntering={enteringIds.has(tab.id)}
          isExiting={false}
          onTransitionEnd={() => endEnter(tab.id)}
          isActive={tab.id === activeTabId || splitTabIds.includes(tab.id)}
          isSelected={selectedTabIds.includes(tab.id)}
          onToggleSelect={onToggleSelect}
          onSelectRange={onSelectRange}
          onActivate={onActivate}
          onClose={onClose}
          isDragging={
            tab.id === grabbedTabId ||
            // Dragging one selected tab drags them all, as one of the split pair drags both: they all show as grabbed.
            draggedGroup.includes(tab.id)
          }
          onDragStart={() => {
            setDraggedId(tab.id);
            onReportDropRegions(
              Array.from(document.querySelectorAll('.workspace-bar__pill, .workspace-bar__new')).map((element) => {
                const { x, y, width, height } = element.getBoundingClientRect();
                return { x, y, width, height };
              }),
            );
          }}
          onDragOver={(position) => {
            // A tab from this strip is placed by `previewLocalDrag`; this half-of-the-tab reading is for one dragged
            // in from another window. Over one of the dragged tabs' own slots, the preview is already right.
            if (draggedId !== null || draggedGroup.includes(tab.id)) {
              return;
            }
            setDropTarget({ id: tab.id, position });
          }}
          onDragEnd={(accepted) => {
            if (tornOffRef.current) {
              onTearOffEnd(tab.id, accepted);
            }
            endDrag();
          }}
          onDragEndOutside={(id, x, y) => {
            // A drag that already tore off has its window; nothing more to open.
            if (!tornOffRef.current) {
              onDragEndOutside(id, x, y);
            }
          }}
          onDragMove={(screenX, screenY, clientX, clientY) => {
            // Some platforms report (0,0) for the final `drag` event.
            if (tornOffRef.current || (screenX === 0 && screenY === 0)) {
              return;
            }
            // Torn off when the cursor leaves the tab strip and stays out
            // (a small margin plus a short dwell keep a sloppy reorder, or a
            // drag *through* the toolbar on the way to a workspace pill,
            // from opening a window that would only flash and close). The
            // workspace pills (and "+ New workspace") never count: they're
            // real drop targets. Everything else does — including the
            // sidebar's empty space and the toolbar band above it — so a tab
            // sitting over the sidebar's column can still be pulled straight
            // down and out.
            const barRect = tabBarRef.current?.getBoundingClientRect();
            const sidebarRect = document.querySelector('.sidebar')?.getBoundingClientRect();
            const overSidebar =
              document.elementFromPoint(clientX, clientY)?.closest('.workspace-bar__pill, .workspace-bar__new') != null;
            const leftWindow = clientX < 0 || clientX > window.innerWidth || clientY < 0;
            const belowStrip =
              barRect !== undefined &&
              clientY > barRect.bottom + TEAR_OFF_MARGIN_PX &&
              !overSidebar;
            if (!leftWindow && !belowStrip) {
              outsideSinceRef.current = null;
              return;
            }
            const now = Date.now();
            outsideSinceRef.current ??= now;
            // The dwell only matters over the sidebar's own column, where a
            // drag may be passing through the toolbar on its way to a workspace
            // pill; anywhere else there's nothing to drop on, so tear off now.
            const inSidebarColumn = sidebarRect !== undefined && clientX < sidebarRect.right;
            if (leftWindow || !inSidebarColumn || now - outsideSinceRef.current >= TEAR_OFF_DWELL_MS) {
              tornOffRef.current = true;
              outsideSinceRef.current = null;
              onDragOutOfWindow(tab.id, screenX, screenY);
            }
          }}
        />
      ))}
      {exiting.map(({ tab, slot }) => (
        <Tab
          pairSide={undefined}
          key={`exiting-${tab.id}`}
          tab={tab}
          label={tab.kind === 'browser' ? pageLabel(tab.url, bookmarks) : null}
          isGhost={false}
          order={slotOrder(slot) - 1}
          isActive={false}
          isSelected={false}
          onToggleSelect={noop}
          onSelectRange={noop}
          onActivate={noop}
          onClose={noop}
          isDragging={false}
          onDragStart={noop}
          onDragOver={noop}
          onDragEnd={noop}
          onDragEndOutside={noop}
          onDragMove={noop}
          isEntering={false}
          isExiting
          onTransitionEnd={() => endExit(tab.id)}
        />
      ))}
      {foreignInsertAt !== null && (
        <div className="tab-bar__placeholder" style={{ order: slotOrder(foreignInsertAt) }} aria-hidden="true" />
      )}
      {/* At the per-workspace limit the "+" goes away entirely (main enforces it too) and returns once a tab closes. It
          opens the menu of what a new tab can be (`NewTabMenu`). */}
      {tabs.length < MAX_TABS_PER_WORKSPACE && <NewTabMenu style={{ order: slotOrder(displayIds.length + 2) }} />}
    </div>
  );
}

interface TabProps {
  readonly tab: TabState;
  /** Which half of the split pair's joint tab this is (no edge drawn on the side it meets the other), or neither. */
  readonly pairSide: 'left' | 'right' | undefined;
  /** What the tab shows instead of its page title (saved name or domain), or `null` to show the title. */
  readonly label: string | null;
  readonly isActive: boolean;
  /** Part of the Ctrl/Shift+click multi-selection (the active tab is too, when one exists). */
  readonly isSelected: boolean;
  readonly onToggleSelect: (id: string) => void;
  readonly onSelectRange: (id: string) => void;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  /** Whether this is the tab currently being dragged (mouse) or grabbed (Ctrl+Space) — either way, drives its in-place `--dragging` highlight. */
  readonly isDragging: boolean;
  readonly onDragStart: () => void;
  /** Reports which half of this tab is being hovered; `TabBar` previews the dragged tab landing on that side. */
  readonly onDragOver: (position: DropPosition) => void;
  /** Where this tab sits in the strip's current (possibly previewed) order, as a CSS `order`. */
  readonly order: number;
  /** `accepted`: the drag ended on a drop target (any `dropEffect` but `'none'`). */
  readonly onDragEnd: (accepted: boolean) => void;
  /** See `TabBarProps.onDragEndOutside` — forwarded straight through, this tab already has its own `id` in scope. */
  readonly onDragEndOutside: (id: string, screenX: number, screenY: number) => void;
  /** Fires continuously during this tab's drag with the cursor's screen and client coordinates. */
  readonly onDragMove: (screenX: number, screenY: number, clientX: number, clientY: number) => void;
  /** True for the invisible stand-in kept mounted after the tab tore off — see `TabBar`'s `ghostTab`. */
  readonly isGhost: boolean;
  /** Just opened: grows into the row. */
  readonly isEntering: boolean;
  /** Already closed: drawn only while it shrinks out of the row, and takes no input. */
  readonly isExiting: boolean;
  /** The grow-in or shrink-out finished. */
  readonly onTransitionEnd: () => void;
}

/** One tab. A `div[role=tab]` rather than a `<button>` because it hosts its own close `<button>`. */
function Tab({
  tab,
  pairSide,
  label,
  isActive,
  isSelected,
  onToggleSelect,
  onSelectRange,
  onActivate,
  onClose,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragEndOutside,
  onDragMove,
  isGhost,
  order,
  isEntering,
  isExiting,
  onTransitionEnd,
}: TabProps) {
  const activate = (): void => onActivate(tab.id);
  const ripples = useClickRipples();
  const titleText = label ?? (tab.title || 'New Tab');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  const handleClose = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onClose(tab.id);
  };

  // A native HTML5 drag needs `dataTransfer` populated even though this
  // reorder is entirely local — some platforms refuse to start a drag (or
  // show a "no drop" cursor throughout) if nothing was ever set on it.
  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tab.id);
    event.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0);
    onDragStart();
  };

  // Fires continuously while hovering — `preventDefault` is what tells the
  // browser this element accepts the drop at all; without it, the drop
  // event (handled up at `.tab-bar` itself, since `drop` bubbles same as
  // this) would never fire. Which half of the tab the pointer is over
  // decides "insert before" vs. "insert after" this tab.
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const isLeftHalf = event.clientX - rect.left < rect.width / 2;
    onDragOver(isLeftHalf ? 'before' : 'after');
  };

  // `dropEffect` reflects whatever the drop target's own `dragover`
  // handler last set before the drop (or `'none'` if the release never
  // landed on a target that called `preventDefault` at all — including a
  // release outside this OS window entirely, which never dispatches a
  // `drop` event here in the first place). Both this tab bar's own
  // in-place reorder and `WorkspaceBar`'s pills set `'move'` when they
  // accept a drop, so `'none'` uniquely means "didn't land on either" —
  // main gets the final say on whether that point was actually outside
  // the window (see `tearOffTab`'s own doc comment).
  const handleDragEnd = (event: DragEvent<HTMLDivElement>): void => {
    const accepted = event.dataTransfer.dropEffect !== 'none';
    if (!accepted) {
      onDragEndOutside(tab.id, event.screenX, event.screenY);
    }
    onDragEnd(accepted);
  };

  return (
    <div
      role={isExiting ? 'presentation' : 'tab'}
      tabIndex={isExiting ? -1 : 0}
      aria-selected={isExiting ? undefined : isActive || isSelected}
      aria-hidden={isExiting || undefined}
      draggable={!isExiting}
      data-tab-id={isExiting || isGhost ? undefined : tab.id}
      className={`tab-bar__tab${isActive ? ' tab-bar__tab--active' : ''}${isSelected ? ' tab-bar__tab--selected' : ''}${isDragging ? ' tab-bar__tab--dragging' : ''}${isEntering ? ' tab-bar__tab--entering' : ''}${isExiting ? ' tab-bar__tab--exiting' : ''}${pairSide ? ` tab-bar__tab--pair-${pairSide}` : ''}`}
      onAnimationEnd={(event) => {
        // Only the last of the tab's own opening or closing animations, not a ripple's (which bubbles up from inside
        // it): the tab is tidied away, or settles, once all of its motion is over.
        if (event.target === event.currentTarget && TAB_TRANSITION_LAST_ANIMATIONS.has(event.animationName)) {
          onTransitionEnd();
        }
      }}
      onClick={(event) => {
        // Ctrl+click adds to the selection and Shift+click selects a range —
        // neither switches the viewed tab; a plain click does (and ends any selection).
        if (event.ctrlKey || event.metaKey) {
          onToggleSelect(tab.id);
        } else if (event.shiftKey) {
          onSelectRange(tab.id);
        } else {
          ripples.add(tab.id, event);
          activate();
        }
      }}
      onKeyDown={handleKeyDown}
      style={
        (isGhost
          ? { position: 'absolute', opacity: 0, pointerEvents: 'none', order }
          : { order, '--shimmer-index': order }) as CSSProperties
      }
      onDragStart={handleDragStart}
      onDrag={(event) => onDragMove(event.screenX, event.screenY, event.clientX, event.clientY)}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* Below the tab's content: the active background sliding past on a keyboard switch (`useActiveTabSlide`
          draws into it), and the click ripples. */}
      <span className="tab-bar__effects" aria-hidden="true">
        <span className="tab-bar__slide-layer" />
        {ripples.ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="click-ripple"
            style={{ left: ripple.x - ripple.size / 2, top: ripple.y - ripple.size / 2, width: ripple.size, height: ripple.size }}
            onAnimationEnd={() => ripples.remove(ripple.id)}
          />
        ))}
      </span>
      {tab.kind === 'terminal' ? (
        <span className="tab-bar__terminal-icon" aria-hidden="true">
          {'>_'}
        </span>
      ) : tab.kind === 'pdf' ? (
        <span className="tab-bar__terminal-icon" aria-hidden="true">
          PDF
        </span>
      ) : tab.kind === 'markdown' ? (
        <span className="tab-bar__terminal-icon" aria-hidden="true">
          MD
        </span>
      ) : tab.kind === 'history' ? (
        <span className="tab-bar__terminal-icon tab-bar__history-icon" aria-hidden="true">
          <HistoryIcon size={13} />
        </span>
      ) : tab.kind === 'bookmarks' ? (
        <span className="tab-bar__terminal-icon tab-bar__history-icon" aria-hidden="true">
          <BookmarksIcon size={13} />
        </span>
      ) : tab.kind === 'secrets' ? (
        <span className="tab-bar__terminal-icon tab-bar__history-icon" aria-hidden="true">
          <LockIcon size={13} />
        </span>
      ) : tab.isLoading ? (
        <span className="tab-bar__spinner" aria-hidden="true" />
      ) : (
        <span className="tab-bar__terminal-icon tab-bar__history-icon" aria-hidden="true">
          <GlobeIcon size={13} />
        </span>
      )}
      <span className="tab-bar__title" title={tab.title || undefined}>
        {titleText}
      </span>
      <button
        type="button"
        className="tab-bar__close hover-glow chrome-tooltip"
        aria-label={`Close ${tab.title || 'tab'}`}
        onClick={handleClose}
        data-tooltip={isActive ? `Close tab (${formatShortcut('W')})` : 'Close tab'}
      >
        ×
      </button>
    </div>
  );
}
