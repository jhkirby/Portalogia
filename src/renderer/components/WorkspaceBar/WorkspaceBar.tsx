// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-12

import { useState, type KeyboardEvent } from 'react';
import type { WorkspaceState } from '@shared/tab-state';
import { formatShortcut } from '../../lib/shortcuts';

interface WorkspaceBarProps {
  readonly workspaces: readonly WorkspaceState[];
  readonly activeWorkspaceId: string;
  /** Whether the sidebar is shown or slid away (toggled via Ctrl+L) — stays mounted either way so the slide can animate. */
  readonly sidebarVisible: boolean;
  readonly onSwitch: (id: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onRemove: (id: string) => void;
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
  onSwitch,
  onCreate,
  onRename,
  onRemove,
}: WorkspaceBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

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
    <aside className={`sidebar${sidebarVisible ? '' : ' sidebar--hidden'}`}>
      <div className="workspace-bar" role="tablist" aria-label="Workspaces" aria-orientation="vertical">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          const isEditing = editingId === workspace.id;

          return (
            <div
              key={workspace.id}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              className={`workspace-bar__pill${isActive ? ' workspace-bar__pill--active' : ''}`}
              onClick={() => !isEditing && onSwitch(workspace.id)}
              onDoubleClick={() => startEditing(workspace)}
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
        className="workspace-bar__new chrome-tooltip"
        aria-label="New workspace"
        onClick={onCreate}
        data-tooltip={`New workspace (${formatShortcut('Shift+N')})`}
      >
        <span className="workspace-bar__new-icon" aria-hidden="true">
          +
        </span>
        New workspace
      </button>
    </aside>
  );
}
