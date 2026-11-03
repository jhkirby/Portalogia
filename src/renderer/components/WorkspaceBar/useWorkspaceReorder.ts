// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { useLayoutEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { previewTabOrder } from '../../lib/previewTabOrder';
import { tabDropTargetAt, type TabDropTarget } from '../../lib/tabDropTarget';

/**
 * What a dragged workspace carries, so the sidebar can tell it from a tab
 * dragged in from the tab strip (`text/plain`), which drops *into* a workspace.
 */
export const WORKSPACE_DRAG_TYPE = 'application/x-portalogia-workspace';

/** How long a workspace takes to slide to its new place; the same as a reordered tab's. */
const SLIDE_MS = 220;

/** A 1×1 transparent GIF: the dragged pill's own highlight is the cue, not a snapshot following the pointer. */
const TRANSPARENT_DRAG_IMAGE = new Image();
TRANSPARENT_DRAG_IMAGE.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';

/** The sidebar's reordering, for `WorkspaceBar` to wire onto its pills and list. */
export interface WorkspaceReorder {
  /** The workspace being dragged, if one is. */
  readonly draggedId: string | null;
  /** The workspaces in the order they're drawn: a drag previews where a release would leave the dragged one. */
  readonly displayIds: readonly string[];
  /** Whether a drag event is a workspace being reordered (rather than a tab being dropped into one). */
  readonly isWorkspaceDrag: (event: DragEvent<HTMLElement>) => boolean;
  /** A pill's `dragstart`. */
  readonly start: (id: string, event: DragEvent<HTMLElement>) => void;
  /** `dragover` anywhere in the list, during a workspace drag. */
  readonly over: (event: DragEvent<HTMLElement>) => void;
  /** `drop` anywhere in the list, during a workspace drag: commits the previewed place. */
  readonly drop: (event: DragEvent<HTMLElement>) => void;
  /** The dragged pill's `dragend`, wherever it was released. */
  readonly end: () => void;
}

/**
 * Drag-to-reorder for the sidebar's workspaces, like the tab strip's: while
 * a workspace is dragged the list previews where a release would put it (by
 * CSS `order`, since moving the dragged element in the DOM cancels a native
 * drag), and nothing is committed until the drop. The place is read from the
 * laid-out positions (`tabDropTargetAt`), so it doesn't flip back and forth
 * while the pills slide; and whenever the order changes, each pill slides
 * from where it was to where it is now.
 * @param listRef The list element: positioned, so its pills' `offsetTop` is measured from it.
 * @param ids The workspace ids, in their real order.
 * @param onMove Commits a move: the workspace, and the one it goes just above (`null` for the end).
 * @returns The state and handlers to wire.
 */
export function useWorkspaceReorder(
  listRef: RefObject<HTMLElement | null>,
  ids: readonly string[],
  onMove: (id: string, beforeId: string | null) => void,
): WorkspaceReorder {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [target, setTarget] = useState<TabDropTarget | null>(null);
  const dragged = draggedId === null ? [] : [draggedId];
  const displayIds = previewTabOrder(ids, dragged, target?.id ?? null, target?.side ?? 'before');

  const isWorkspaceDrag = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types).includes(WORKSPACE_DRAG_TYPE);

  const start = (id: string, event: DragEvent<HTMLElement>): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(WORKSPACE_DRAG_TYPE, id);
    event.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0);
    setDraggedId(id);
    setTarget(null);
  };

  const over = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const list = listRef.current;
    if (!list || draggedId === null) {
      return;
    }
    const y = event.clientY - list.getBoundingClientRect().top - list.clientTop + list.scrollTop;
    const slots = Array.from(list.querySelectorAll<HTMLElement>('[data-workspace-id]'))
      .map((pill) => ({ id: pill.dataset['workspaceId'] ?? '', left: pill.offsetTop, width: pill.offsetHeight }))
      .sort((first, second) => first.left - second.left);
    const next = tabDropTargetAt(slots, dragged, y);
    if (next) {
      setTarget((current) => (current?.id === next.id && current.side === next.side ? current : next));
    }
  };

  const end = (): void => {
    setDraggedId(null);
    setTarget(null);
  };

  const drop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    if (draggedId !== null) {
      const at = displayIds.indexOf(draggedId);
      const beforeId = displayIds[at + 1] ?? null;
      const realNext = ids[ids.indexOf(draggedId) + 1] ?? null;
      if (beforeId !== realNext) {
        onMove(draggedId, beforeId);
      }
    }
    end();
  };

  // ── The slide when pills change places ──
  const positionsRef = useRef(new Map<string, number>());
  const orderRef = useRef(displayIds.join('\n'));
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const pills = Array.from(list.querySelectorAll<HTMLElement>('[data-workspace-id]'));
    const positions = new Map(pills.map((pill) => [pill.dataset['workspaceId'] ?? '', pill.offsetTop]));
    const previous = positionsRef.current;
    const order = displayIds.join('\n');
    const reordered = order !== orderRef.current;
    positionsRef.current = positions;
    orderRef.current = order;
    // Only a pure reorder slides; a workspace added or removed just appears or goes.
    const sameSet = previous.size === positions.size && [...positions.keys()].every((id) => previous.has(id));
    if (!reordered || !sameSet || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    for (const pill of pills) {
      const from = previous.get(pill.dataset['workspaceId'] ?? '');
      const delta = from === undefined ? 0 : from - pill.offsetTop;
      if (Math.abs(delta) > 1) {
        pill.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], {
          duration: SLIDE_MS,
          easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
        });
      }
    }
  });

  return { draggedId, displayIds, isWorkspaceDrag, start, over, drop, end };
}
