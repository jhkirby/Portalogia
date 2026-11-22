// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { MAX_WORKSPACES } from '@shared/constants';
import type { WorkspaceState } from '@shared/tab-state';
import { useClickRipples } from '../../hooks/useClickRipples';
import { formatShortcut } from '../../lib/shortcuts';
import { BookmarkStarIcon, PencilIcon, SidebarIcon, WorkspaceImagesIcon } from '../icons';
import { Mist } from '../Mist';
import { WorkspaceIcon } from '../WorkspaceIcon';
import { usePointerGlow } from '../../hooks/usePointerGlow';
import { useShimmerTick } from '../../hooks/useShimmerTick';
import { useWorkspaceTransitions } from './useWorkspaceTransitions';
import { useWorkspaceReorder } from './useWorkspaceReorder';

interface WorkspaceBarProps {
  readonly workspaces: readonly WorkspaceState[];
  /** For each workspace whose tabs match a saved image exactly, that image's id: it shows a filled star, and the star's click removes the image. */
  readonly savedImageIds: Readonly<Record<string, string>>;
  readonly activeWorkspaceId: string;
  /** Whether the sidebar is shown or slid away (toggled via Ctrl+L) — stays mounted either way so the slide can animate. */
  readonly sidebarVisible: boolean;
  /**
   * Whether Focus Mode is on — distinct from `sidebarVisible` being
   * `false`: Focus Mode collapses the sidebar all the way to 0 (full
   * immersion) and drops `.sidebar__toggle` outright, while an ordinary
   * Ctrl+L toggle collapses it only to `SIDEBAR_COLLAPSED_WIDTH_PX`,
   * leaving that button at the top of the rail, visible and clickable — see
   * workspace-bar.css's `.sidebar--hidden`/`.sidebar--focus-mode`.
   */
  readonly focusMode: boolean;
  /** The workspaces multi-selected with Ctrl/Shift+click (active one included), or empty — they're drawn selected. */
  readonly selectedWorkspaceIds: readonly string[];
  /** Ctrl+click: add/remove a workspace from the selection without switching to it. */
  readonly onToggleSelect: (id: string) => void;
  /** Shift+click: select every workspace from the active one to this one. */
  readonly onSelectRange: (id: string) => void;
  readonly onSwitch: (id: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (id: string, name: string) => void;
  /** Moves a workspace to just above `beforeId`, or to the end for `null`: a drag in the sidebar. */
  readonly onMove: (id: string, beforeId: string | null) => void;
  /** Opens the workspace editor (name, icon color, icon) for one workspace: its pencil button. */
  readonly onEdit: (id: string) => void;
  readonly onRemove: (id: string) => void;
  /** Saves a workspace (its tabs in order) as a workspace image: the star its icon turns into while hovered. */
  readonly onSaveImage: (id: string) => void;
  /** Deletes a saved image: a click on a filled star. */
  readonly onRemoveImage: (imageId: string) => void;
  /** Opens the workspace images popup. */
  readonly onOpenImages: () => void;
  /** Shows or hides the sidebar — the heading's `.sidebar__toggle` click, the same Ctrl+L action. */
  readonly onToggleSidebar: () => void;
}

/**
 * The vertical sidebar of workspaces on the left edge of the window. Each
 * groups its own set of tabs (see `App`'s `workspaceTabs` filter);
 * switching one swaps which tabs the tab bar shows. Double-click a
 * workspace's name to rename it in place, or drag it to a new place in the list.
 */
export function WorkspaceBar({
  workspaces,
  savedImageIds,
  activeWorkspaceId,
  sidebarVisible,
  focusMode,
  selectedWorkspaceIds,
  onToggleSelect,
  onSelectRange,
  onSwitch,
  onCreate,
  onRename,
  onMove,
  onEdit,
  onRemove,
  onSaveImage,
  onRemoveImage,
  onOpenImages,
  onToggleSidebar,
}: WorkspaceBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  usePointerGlow(sidebarRef);
  const reorder = useWorkspaceReorder(
    listRef,
    workspaces.map((workspace) => workspace.id),
    onMove,
  );
  const { enteringIds, exiting, endEnter, endExit } = useWorkspaceTransitions(workspaces, reorder.displayIds);
  const ripples = useClickRipples();
  // Every 20 s a shimmer runs down the workspaces' icons and names (the tabs' runs 10 s apart from it).
  const shimmer = useShimmerTick(0);

  // Collapsing the sidebar mid-rename drops the rename, for the same reason a double-click can't start one then.
  if (!sidebarVisible && editingId !== null) {
    setEditingId(null);
  }

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
      ref={sidebarRef}
      className={`sidebar pointer-glow-host${sidebarVisible ? '' : ' sidebar--hidden'}${focusMode ? ' sidebar--focus-mode' : ''}`}
    >
      {/* Mist drifting up and down the sidebar, then the accent glowing around the pointer, under everything in it. */}
      <Mist variant="rail" />
      <div className="pointer-glow" aria-hidden="true" />
      {/* Everything in the sidebar lives in this inner wrapper, which clips what no longer fits as it collapses. */}
      <div className="sidebar__inner">
        {/* The sidebar's heading: its name, and the show/hide button at the right. Collapsing squeezes the name away
            first, leaving the button alone in the rail above the workspaces' icons. */}
        <div className="sidebar__header">
          <span className="sidebar__title">Workspaces</span>
          {/* Omitted in Focus Mode rather than just clipped away: nothing chrome-drawn should be reachable (by click
              or by Tab-key focus) while it's on, matching the top bar's own `.app--focus-mode .app__bar`. */}
          {!focusMode && (
            <button
              type="button"
              className="sidebar__toggle hover-glow icon-hop chrome-tooltip"
              data-hop="slide-x"
              onClick={(event) => {
                onToggleSidebar();
                // Let go of focus: a focused button can keep itself looking "active" after the click.
                event.currentTarget.blur();
              }}
              aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
              aria-expanded={sidebarVisible}
              data-tooltip={`${sidebarVisible ? 'Hide sidebar' : 'Show sidebar'} (${formatShortcut('L')})`}
            >
              <SidebarIcon open={sidebarVisible} />
            </button>
          )}
        </div>
        <div
          ref={listRef}
          className="workspace-bar"
          data-shimmer={shimmer ?? undefined}
          role="tablist"
          aria-label="Workspaces"
          aria-orientation="vertical"
          // The gaps between pills: a workspace dragged over them still places itself.
          onDragOver={(event) => {
            if (reorder.isWorkspaceDrag(event)) {
              reorder.over(event);
            }
          }}
          onDrop={(event) => {
            if (reorder.isWorkspaceDrag(event)) {
              reorder.drop(event);
            }
          }}
        >
          {workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId;
            const isEditing = editingId === workspace.id;
            const isDragged = reorder.draggedId === workspace.id;
            const order = reorder.displayIds.indexOf(workspace.id);

            return (
              <div
                key={workspace.id}
                role="tab"
                tabIndex={0}
                aria-selected={isActive || selectedWorkspaceIds.includes(workspace.id)}
                data-workspace-id={workspace.id}
                className={`workspace-bar__pill hover-glow${isActive ? ' workspace-bar__pill--active' : ''}${selectedWorkspaceIds.includes(workspace.id) ? ' workspace-bar__pill--selected' : ''}${isDragged ? ' workspace-bar__pill--dragging' : ''}${enteringIds.has(workspace.id) ? ' workspace-bar__pill--entering' : ''}`}
                onAnimationEnd={(event) => {
                  // Bubbled up from the ripples and the selected colour too; only the slide-in ends the opening.
                  if (event.animationName === 'workspace-pill-slide-in') {
                    endEnter(workspace.id);
                  }
                }}
                // Doubled, leaving the odd places between pills for closed ones still sliding out (below).
                style={{ order: order * 2, '--shimmer-index': order } as CSSProperties}
                draggable={!isEditing}
                onDragStart={(event) => reorder.start(workspace.id, event)}
                onDragEnd={reorder.end}
                onClick={(event) => {
                  if (isEditing) {
                    return;
                  }
                  // Ctrl+click adds to the selection and Shift+click selects a
                  // range, neither switching workspaces; a plain click switches.
                  if (event.ctrlKey || event.metaKey) {
                    onToggleSelect(workspace.id);
                  } else if (event.shiftKey) {
                    onSelectRange(workspace.id);
                  } else {
                    ripples.add(workspace.id, event);
                    onSwitch(workspace.id);
                  }
                }}
                // Not while collapsed: there's no room for the name box, and focusing it scrolled the whole list sideways.
                onDoubleClick={sidebarVisible ? () => startEditing(workspace) : undefined}
              >
                {/* Below the pill's content: the selected colour, which grows in like the hover when this workspace
                    becomes the selected one, and the click ripples. */}
                <span className="workspace-bar__effects" aria-hidden="true">
                  <span className="workspace-bar__selected-fill" />
                  {ripples.ripples
                    .filter((ripple) => ripple.ownerId === workspace.id)
                    .map((ripple) => (
                      <span
                        key={ripple.id}
                        className="click-ripple"
                        style={{
                          left: ripple.x - ripple.size / 2,
                          top: ripple.y - ripple.size / 2,
                          width: ripple.size,
                          height: ripple.size,
                        }}
                        onAnimationEnd={() => ripples.remove(ripple.id)}
                      />
                    ))}
                </span>
                <span className="workspace-bar__icon">
                  <span className="workspace-bar__glyph" aria-hidden="true">
                    <WorkspaceIcon icon={workspace.icon} color={workspace.color} />
                  </span>
                  {/* The icon turns into this star while the workspace is hovered: a click saves the workspace as an image. */}
                  {!isEditing && (
                    <button
                      type="button"
                      className="workspace-bar__star chrome-tooltip"
                      aria-label={`Save ${workspace.name} as a workspace image`}
                      aria-pressed={savedImageIds[workspace.id] !== undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        const imageId = savedImageIds[workspace.id];
                        if (imageId === undefined) {
                          onSaveImage(workspace.id);
                        } else {
                          onRemoveImage(imageId);
                        }
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                      data-tooltip={savedImageIds[workspace.id] !== undefined ? 'Remove workspace image' : 'Save workspace image'}
                    >
                      <BookmarkStarIcon filled={savedImageIds[workspace.id] !== undefined} size={14} />
                    </button>
                  )}
                </span>
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
                {!isEditing && (
                  <button
                    type="button"
                    className="workspace-bar__edit hover-glow chrome-tooltip"
                    aria-label={`Edit ${workspace.name} workspace`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(workspace.id);
                    }}
                    data-tooltip={isActive ? `Edit Workspace (${formatShortcut('Shift+E')})` : 'Edit Workspace'}
                  >
                    <PencilIcon size={12} />
                  </button>
                )}
                {workspaces.length > 1 && !isEditing && (
                  <button
                    type="button"
                    className="workspace-bar__remove hover-glow chrome-tooltip"
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
          {/* Closed workspaces, slid left out of the sidebar where they were before their space folds away. No
              `data-workspace-id`: the reorder measuring must not see them. */}
          {exiting.map(({ workspace, above }) => (
            <div
              key={`exiting-${workspace.id}`}
              className="workspace-bar__pill workspace-bar__pill--exiting"
              style={{ order: above * 2 - 1 }}
              aria-hidden="true"
              onAnimationEnd={(event) => {
                if (event.animationName === 'workspace-pill-collapse') {
                  endExit(workspace.id);
                }
              }}
            >
              <span className="workspace-bar__icon">
                <span className="workspace-bar__glyph">
                  <WorkspaceIcon icon={workspace.icon} color={workspace.color} />
                </span>
              </span>
              <span className="workspace-bar__name">{workspace.name}</span>
            </div>
          ))}
        </div>
        <div className="workspace-bar__actions">
        {/* Gone entirely at the workspace limit (main refuses too), back once one is removed. */}
        {workspaces.length < MAX_WORKSPACES && (
          <button
            type="button"
            className="workspace-bar__new hover-glow icon-hop chrome-tooltip"
            data-hop="turn"
            aria-label="New workspace"
            onClick={() => {
              onCreate();
            }}
            data-tooltip={`New workspace (${formatShortcut('Shift+N')})`}
          >
            <span className="workspace-bar__new-icon" aria-hidden="true">
              +
            </span>
            <span className="workspace-bar__new-label">New workspace</span>
          </button>
        )}
        <button
          type="button"
          className="workspace-bar__images hover-glow icon-hop chrome-tooltip"
          data-hop="stack"
          aria-label="Workspace images"
          onClick={() => {
            onOpenImages();
          }}
          data-tooltip={`Workspace images (${formatShortcut('Shift+S')})`}
        >
          <WorkspaceImagesIcon size={16} />
        </button>
        </div>
      </div>
    </aside>
  );
}
