// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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

/** The animation (in `tab-bar.css`) that ends a tab's opening, and the one that ends its closing. */
const TAB_TRANSITION_LAST_ANIMATIONS = new Set(['tab-bar-tab-rise', 'tab-bar-tab-close']);

/** Stands in for every handler of a closing tab, which takes no input while it shrinks away. */
const noop = (): void => undefined;

/** How far a press must move before it's a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/** How long a released tab takes to glide from the pointer into its slot. */
const SETTLE_MS = 160;

/** The longest a dropped order is held waiting for main's reordered tabs (see `heldOrder`). */
const HELD_ORDER_MS = 1500;

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
  /**
   * Called when a drag finishes reordering: `beforeId` is the tab it should land before, or `null` for the end of the
   * row. A drag only ever reorders — the tab stays in the row, so it can't be torn off into a window or dropped on a
   * workspace.
   */
  readonly onReorder: (id: string, beforeId: string | null) => void;
  /** The tab grabbed for keyboard reordering (Ctrl+Space held, then Left/Right to nudge it — see `TabManager.grabTabForReorder`), or `null` when nothing is grabbed. Shares the mouse-drag's `--dragging` highlight. */
  readonly grabbedTabId: string | null;
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
  pairTabIds,
  splitTabIds,
}: TabBarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  /**
   * The order a drag was dropped in, drawn until main's reordered tabs arrive (`handleDrop`). Dropped as soon as the
   * row's order changes — the new order is then the real one — or after `HELD_ORDER_MS` if it never does (a drop that
   * changed nothing, or a reorder main refused).
   */
  const [heldOrder, setHeldOrder] = useState<readonly string[] | null>(null);
  const tabOrderKey = tabs.map((tab) => tab.id).join('\n');
  useEffect(() => {
    setHeldOrder(null);
  }, [tabOrderKey]);
  useEffect(() => {
    if (heldOrder === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => setHeldOrder(null), HELD_ORDER_MS);
    return () => window.clearTimeout(timer);
  }, [heldOrder]);
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
  const tabIds = tabs.map((tab) => tab.id);
  // A just-dropped order, held until the tabs' own order catches up; ignored once the row holds other tabs.
  const held = heldOrder !== null && heldOrder.length === tabIds.length && tabIds.every((id) => heldOrder.includes(id));
  const displayIds = previewTabOrder(
    held ? heldOrder : tabIds,
    draggedGroup,
    pairTarget?.id ?? null,
    pairTarget?.position ?? 'before',
  );
  const orderOf = (id: string): number => {
    const index = displayIds.indexOf(id);
    return index === -1 ? displayIds.length : index;
  };

  // ── The drag: a press on a tab that moves sideways picks it up; it follows the pointer, kept inside the row, and the
  // others make room. Released, it's put where it's shown. It never leaves the row. ──

  /** The press that may become a drag: which tab, where it started, and where on the tab it was grabbed. */
  const pressRef = useRef<{
    readonly id: string;
    readonly pointerId: number;
    readonly startX: number;
    readonly grabX: number;
    readonly element: HTMLElement;
    dragging: boolean;
    lastX: number;
  } | null>(null);
  /** Set by a drag's release, so the click that follows it doesn't also switch to the tab. */
  const suppressClickRef = useRef(false);
  const draggedIdRef = useRef(draggedId);
  draggedIdRef.current = draggedId;

  /**
   * Draws the grabbed tab under the pointer: shifted from its laid-out slot by however far the pointer has moved, but
   * kept within the row of tabs (from the first tab's left edge to the last one's right).
   */
  const placeGrabbed = (): void => {
    const press = pressRef.current;
    const bar = tabBarRef.current;
    if (!press?.dragging || !bar) {
      return;
    }
    const { element } = press;
    const slots = Array.from(bar.querySelectorAll<HTMLElement>('.tab-bar__tab[data-tab-id]'));
    if (slots.length === 0) {
      return;
    }
    const parentLeft = (element.offsetParent ?? bar).getBoundingClientRect().left;
    const rowLeft = parentLeft + Math.min(...slots.map((slot) => slot.offsetLeft));
    const rowRight = parentLeft + Math.max(...slots.map((slot) => slot.offsetLeft + slot.offsetWidth));
    const slotLeft = parentLeft + element.offsetLeft;
    const wanted = Math.max(rowLeft, Math.min(press.lastX - press.grabX, rowRight - element.offsetWidth));
    element.style.transform = `translateX(${wanted - slotLeft}px)`;
  };

  /** Lets go of the grabbed tab: it glides from where it was drawn into its slot. */
  const settleGrabbed = (element: HTMLElement): void => {
    element.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1)`;
    element.style.transform = '';
    window.setTimeout(() => {
      element.style.transition = '';
      delete element.dataset['grabbed'];
    }, SETTLE_MS);
  };

  const startPress = (id: string, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || pressRef.current) {
      return;
    }
    // The close button is a button, not a handle.
    if ((event.target as HTMLElement).closest('.tab-bar__close')) {
      return;
    }
    const element = event.currentTarget;
    pressRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      grabX: event.clientX - element.getBoundingClientRect().left,
      element,
      dragging: false,
      lastX: event.clientX,
    };
  };

  // The move and the release are followed on the window, so a drag that wanders off the row keeps going (the tab
  // itself stays in it).
  const handlersRef = useRef({ move: (_event: PointerEvent): void => undefined, up: (_event: PointerEvent): void => undefined, cancel: (): void => undefined });
  handlersRef.current = {
    move: (event) => {
      const press = pressRef.current;
      if (!press || event.pointerId !== press.pointerId) {
        return;
      }
      press.lastX = event.clientX;
      if (!press.dragging) {
        if (Math.abs(event.clientX - press.startX) < DRAG_THRESHOLD_PX) {
          return;
        }
        press.dragging = true;
        press.element.dataset['grabbed'] = '';
        press.element.style.transition = '';
        try {
          press.element.setPointerCapture(press.pointerId);
        } catch {
          // The pointer already went up; the release below ends the drag.
        }
        setDraggedId(press.id);
      }
      const bar = tabBarRef.current?.getBoundingClientRect();
      if (bar) {
        previewLocalDrag(Math.max(bar.left, Math.min(event.clientX, bar.right - 1)));
      }
      placeGrabbed();
    },
    up: (event) => {
      const press = pressRef.current;
      if (!press || event.pointerId !== press.pointerId) {
        return;
      }
      pressRef.current = null;
      if (!press.dragging) {
        return;
      }
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const target = keepPairWhole(dropTarget);
      if (target && draggedIdRef.current !== null) {
        // The row stays as the drag left it until main's new order arrives, rather than springing back to the old
        // order for the moment in between and then sliding forward again.
        setHeldOrder(displayIds);
        const targetIndex = tabs.findIndex((tab) => tab.id === target.id);
        const insertIndex = target.position === 'before' ? targetIndex : targetIndex + 1;
        onReorder(draggedIdRef.current, tabs[insertIndex]?.id ?? null);
      }
      settleGrabbed(press.element);
      endDrag();
    },
    cancel: () => {
      const press = pressRef.current;
      pressRef.current = null;
      if (press?.dragging) {
        settleGrabbed(press.element);
        endDrag();
      }
    },
  };
  useEffect(() => {
    const move = (event: PointerEvent): void => handlersRef.current.move(event);
    const up = (event: PointerEvent): void => handlersRef.current.up(event);
    const cancel = (): void => handlersRef.current.cancel();
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && pressRef.current?.dragging) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
    };
  }, []);
  // The others moving round it re-lay the row, which moves the grabbed tab's slot: it's redrawn under the pointer.
  useLayoutEffect(placeGrabbed);
  // Every 20 s a shimmer runs along the tabs' icons and names, ten seconds out of step with the workspaces', so one of
  // the two runs every ten seconds.
  const shimmer = useShimmerTick(SHIMMER_PERIOD_MS / 2);
  const { enteringIds, exiting, endEnter, endExit } = useTabTransitions(
    tabs,
    workspaceId,
    displayIds,
    tabBarRef,
    [],
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
      // A click that ends a drag doesn't also switch tabs.
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
      onPointerDown={(event) =>
        notePress((event.target as HTMLElement).closest<HTMLElement>('.tab-bar__tab[data-tab-id]')?.dataset['tabId'] ?? null)
      }
    >
      {tabs.map((tab) => (
        <Tab
          pairSide={pairSideOf(tab.id)}
          key={tab.id}
          tab={tab}
          label={tab.kind === 'browser' ? pageLabel(tab.url, bookmarks) : null}
          order={slotOrder(orderOf(tab.id))}
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
          onPointerDown={(event) => startPress(tab.id, event)}
        />
      ))}
      {exiting.map(({ tab, slot }) => (
        <Tab
          pairSide={undefined}
          key={`exiting-${tab.id}`}
          tab={tab}
          label={tab.kind === 'browser' ? pageLabel(tab.url, bookmarks) : null}
          order={slotOrder(slot) - 1}
          isActive={false}
          isSelected={false}
          onToggleSelect={noop}
          onSelectRange={noop}
          onActivate={noop}
          onClose={noop}
          isDragging={false}
          onPointerDown={noop}
          isEntering={false}
          isExiting
          onTransitionEnd={() => endExit(tab.id)}
        />
      ))}
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
  /** Whether this is the tab being dragged (mouse) or grabbed (Ctrl+Space) — either way, drives its `--dragging` highlight. */
  readonly isDragging: boolean;
  /** Where this tab sits in the strip's current (possibly previewed) order, as a CSS `order`. */
  readonly order: number;
  /** A press on the tab, which becomes a drag if it moves sideways (`TabBar`'s `startPress`). */
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
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
  onPointerDown,
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

  return (
    <div
      role={isExiting ? 'presentation' : 'tab'}
      tabIndex={isExiting ? -1 : 0}
      aria-selected={isExiting ? undefined : isActive || isSelected}
      aria-hidden={isExiting || undefined}
      data-tab-id={isExiting ? undefined : tab.id}
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
      style={{ order, '--shimmer-index': order } as CSSProperties}
      onPointerDown={onPointerDown}
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
