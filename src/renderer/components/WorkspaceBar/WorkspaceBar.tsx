// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { useState, type DragEvent, type KeyboardEvent } from 'react';
import type { WorkspaceState } from '@shared/tab-state';
import { useOverlayTooltip } from '../../hooks/useOverlayTooltip';
import { formatShortcut } from '../../lib/shortcuts';

interface WorkspaceBarProps {
  readonly workspaces: readonly WorkspaceState[];
  readonly activeWorkspaceId: string;
  /** Whether the sidebar is shown or slid away (toggled via Ctrl+L) — stays mounted either way so the slide can animate. */
  readonly sidebarVisible: boolean;
  /**
   * Whether Focus Mode is on — distinct from `sidebarVisible` being
   * `false`: Focus Mode collapses the sidebar all the way to 0 (full
   * immersion) and hides `.sidebar__toggle` outright, while an ordinary
   * Ctrl+L toggle collapses it only to `SIDEBAR_COLLAPSED_WIDTH_PX`,
   * leaving that button visible and clickable — see workspace-bar.css's
   * `.sidebar--hidden`/`.sidebar--focus-mode`.
   */
  readonly focusMode: boolean;
  readonly onSwitch: (id: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onRemove: (id: string) => void;
  /** Called when a tab dragged from `TabBar` is dropped onto a workspace pill — moves it into that workspace. Tab id first, same argument order as every other tab action (`moveTab`, `activateTab`, ...). */
  readonly onDropTab: (tabId: string, workspaceId: string) => void;
  /** Called when a tab dragged from `TabBar` is dropped onto the "+ New workspace" button — creates a new workspace with that tab as its first (and only) one. */
  readonly onDropTabToNewWorkspace: (tabId: string) => void;
  /** Shows or hides the sidebar — `.sidebar__toggle`'s own click, the same Ctrl+L action. */
  readonly onToggleSidebar: () => void;
}

/**
 * The vertical sidebar of workspaces on the left edge of the window. Each
 * groups its own set of tabs (see `App`'s `workspaceTabs` filter);
 * switching one swaps which tabs the tab bar shows. Double-click a
 * workspace's name to rename it in place.
 */
export function WorkspaceBar({
  workspaces,
  activeWorkspaceId,
  sidebarVisible,
  focusMode,
  onSwitch,
  onCreate,
  onRename,
  onRemove,
  onDropTab,
  onDropTabToNewWorkspace,
  onToggleSidebar,
}: WorkspaceBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  /** Which pill a dragged tab is currently hovering over, if any — drives its drop-target highlight. */
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /** Whether a dragged tab is currently hovering the "+ New workspace" button — drives its own drop-target highlight, same idea as `dropTargetId` for the pills above it. */
  const [isNewWorkspaceDropTarget, setNewWorkspaceDropTarget] = useState(false);

  // Collapsed (`!sidebarVisible`), these two buttons swap their tooltip
  // from the plain CSS one (tooltip.css) to `TooltipOverlay` — see
  // `useOverlayTooltip`'s own doc comment for why. Still called
  // unconditionally (hooks can't be conditional); only actually wired onto
  // the buttons below while collapsed.
  const sidebarToggleTooltip = useOverlayTooltip(
    `${sidebarVisible ? 'Hide sidebar' : 'Show sidebar'} (${formatShortcut('L')})`,
  );
  const newWorkspaceTooltip = useOverlayTooltip(`New workspace (${formatShortcut('Shift+N')})`);

  const startEditing = (workspace: WorkspaceState): void => {
    setEditingId(workspace.id);
    setEditingText(workspace.name);
  };

  const commitEditing = (): void => {
    if (editingId) {
      onRename(editingId, editingText);
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      commitEditing();
    } else if (event.key === 'Escape') {
      setEditingId(null);
    }
  };

  return (
    <aside
      className={`sidebar${sidebarVisible ? '' : ' sidebar--hidden'}${focusMode ? ' sidebar--focus-mode' : ''}`}
    >
      {/* Everything that actually needs to disappear as the sidebar
          collapses lives in this inner wrapper, which clips to nothing —
          `.sidebar__toggle` below deliberately isn't in here, since it's
          the one thing meant to stay visible in the collapsed (but not
          Focus Mode) state; see workspace-bar.css's own comments. */}
      <div className="sidebar__inner">
        <div className="workspace-bar" role="tablist" aria-label="Workspaces" aria-orientation="vertical">
          {workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId;
            const isEditing = editingId === workspace.id;
            const isDropTarget = dropTargetId === workspace.id;

            // Accepts a tab dragged from `TabBar` (its own `handleDragStart`
            // puts the dragged tab's id on `dataTransfer` as `text/plain`) —
            // `preventDefault` in `dragover` is what marks this a valid drop
            // target at all, same reasoning as `TabBar`'s own in-bar reorder
            // targets, and is also what makes this drop's `dropEffect`
            // (`'move'`) show up on the dragged tab's own `dragend`, which is
            // how it knows *not* to treat this as a tear-off-to-new-window.
            const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropTargetId(workspace.id);
            };
            const handleDragLeave = (): void => {
              setDropTargetId((current) => (current === workspace.id ? null : current));
            };
            const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
              event.preventDefault();
              const tabId = event.dataTransfer.getData('text/plain');
              if (tabId) {
                onDropTab(tabId, workspace.id);
              }
              setDropTargetId(null);
            };

            return (
              <div
                key={workspace.id}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                className={`workspace-bar__pill${isActive ? ' workspace-bar__pill--active' : ''}${isDropTarget ? ' workspace-bar__pill--drop-target' : ''}`}
                onClick={() => !isEditing && onSwitch(workspace.id)}
                onDoubleClick={() => startEditing(workspace)}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <span
                  className="workspace-bar__dot"
                  style={{ background: workspace.color }}
                  aria-hidden="true"
                />
                {isEditing ? (
                  <input
                    autoFocus
                    className="workspace-bar__name-input"
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    onBlur={commitEditing}
                    onKeyDown={handleEditKeyDown}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : (
                  <span className="workspace-bar__name">{workspace.name}</span>
                )}
                {workspaces.length > 1 && !isEditing && (
                  <button
                    type="button"
                    className="workspace-bar__remove chrome-tooltip"
                    aria-label={`Remove ${workspace.name} workspace`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(workspace.id);
                    }}
                    data-tooltip={isActive ? `Close workspace (${formatShortcut('Alt+W')})` : 'Close workspace'}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={`workspace-bar__new chrome-tooltip${isNewWorkspaceDropTarget ? ' workspace-bar__new--drop-target' : ''}`}
          aria-label="New workspace"
          onClick={() => {
            newWorkspaceTooltip.hide();
            onCreate();
          }}
          data-tooltip={`New workspace (${formatShortcut('Shift+N')})`}
          onMouseEnter={sidebarVisible ? undefined : newWorkspaceTooltip.onMouseEnter}
          onMouseLeave={sidebarVisible ? undefined : newWorkspaceTooltip.onMouseLeave}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setNewWorkspaceDropTarget(true);
          }}
          onDragLeave={() => setNewWorkspaceDropTarget(false)}
          onDrop={(event) => {
            event.preventDefault();
            const tabId = event.dataTransfer.getData('text/plain');
            if (tabId) {
              onDropTabToNewWorkspace(tabId);
            }
            setNewWorkspaceDropTarget(false);
          }}
        >
          <span className="workspace-bar__new-icon" aria-hidden="true">
            +
          </span>
          <span className="workspace-bar__new-label">New workspace</span>
        </button>
      </div>
      {/* Outside `.sidebar__inner` on purpose — see the wrapper's own
          comment above. Omitted entirely in Focus Mode rather than just
          hidden: nothing chrome-drawn should be reachable (by click or by
          Tab-key focus) while it's on, matching the top bar's own
          `.app--focus-mode .app__bar` treatment. */}
      {!focusMode && (
        <button
          type="button"
          className="sidebar__toggle chrome-tooltip"
          onClick={() => {
            sidebarToggleTooltip.hide();
            onToggleSidebar();
          }}
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          data-tooltip={`${sidebarVisible ? 'Hide sidebar' : 'Show sidebar'} (${formatShortcut('L')})`}
          onMouseEnter={sidebarVisible ? undefined : sidebarToggleTooltip.onMouseEnter}
          onMouseLeave={sidebarVisible ? undefined : sidebarToggleTooltip.onMouseLeave}
        >
          {sidebarVisible ? '‹' : '›'}
        </button>
      )}
    </aside>
  );
}
