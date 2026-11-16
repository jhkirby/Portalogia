// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceState } from '@shared/tab-state';

/** A workspace that has closed but is still drawn while it slides out of the sidebar. */
export interface ExitingWorkspace {
  readonly workspace: WorkspaceState;
  /** How many of the workspaces still open were drawn above it, which places it back between the same neighbours. */
  readonly above: number;
}

/** What the sidebar draws on top of its open workspaces. */
export interface WorkspaceTransitions {
  /** Workspaces that just opened, and slide in. */
  readonly enteringIds: ReadonlySet<string>;
  readonly exiting: readonly ExitingWorkspace[];
  /** A new workspace finished sliding in. */
  readonly endEnter: (id: string) => void;
  /** A closed workspace finished leaving: stop drawing it. */
  readonly endExit: (id: string) => void;
}

/**
 * The sidebar's opening and closing motion, the counterpart of the tab
 * strip's. A new workspace first opens its row, so the ones below it and the
 * "New workspace" button glide down, then slides in from the left. A closed
 * one stays drawn where it was while it slides left out of the sidebar and
 * then folds its row away, so the ones below glide up into the gap instead of
 * jumping there (see `.workspace-bar__pill--entering` and `--exiting`). Several
 * workspaces arriving at once (a restored session) just appear.
 * @param workspaces The open workspaces.
 * @param displayIds Their ids in the order they're drawn.
 * @returns What's coming and going.
 */
export function useWorkspaceTransitions(
  workspaces: readonly WorkspaceState[],
  displayIds: readonly string[],
): WorkspaceTransitions {
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set());
  const [exiting, setExiting] = useState<readonly ExitingWorkspace[]>([]);
  const previousRef = useRef({ workspaces, displayIds });

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { workspaces, displayIds };
    if (previous.workspaces === workspaces || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const open = new Set(workspaces.map((workspace) => workspace.id));
    const before = new Set(previous.workspaces.map((workspace) => workspace.id));
    const added = workspaces.filter((workspace) => !before.has(workspace.id)).map((workspace) => workspace.id);
    if (added.length === 1) {
      setEnteringIds((current) => new Set([...current, ...added]));
    }
    const removed = previous.workspaces
      .filter((workspace) => !open.has(workspace.id))
      .map((workspace) => {
        const slot = previous.displayIds.indexOf(workspace.id);
        const above = slot < 0 ? workspaces.length : previous.displayIds.slice(0, slot).filter((id) => open.has(id)).length;
        return { workspace, above };
      });
    if (removed.length > 0) {
      const removedIds = new Set(removed.map((entry) => entry.workspace.id));
      setExiting((current) => [
        ...current.filter((entry) => !open.has(entry.workspace.id) && !removedIds.has(entry.workspace.id)),
        ...removed,
      ]);
    }
    // `displayIds` is read as it was at the change; a drag preview alone isn't an open or a close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces]);

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
    setExiting((current) => current.filter((entry) => entry.workspace.id !== id));
  }, []);

  return { enteringIds, exiting, endEnter, endExit };
}
