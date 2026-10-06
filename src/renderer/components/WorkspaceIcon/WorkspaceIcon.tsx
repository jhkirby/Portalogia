// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { isWorkspaceIconId } from '@shared/workspaceIcons';
import { WORKSPACE_ICON_DRAWINGS } from './workspaceIcons';

interface WorkspaceIconProps {
  /** A `WorkspaceIconId`; anything unrecognized draws the plain dot. */
  readonly icon: string;
  /** The icon's color, as a CSS color. */
  readonly color: string;
  /** Edge length in px. */
  readonly size?: number;
}

/** One workspace icon in the workspace's own color — the sidebar's marker for it, and a choice in the editor's list. */
export function WorkspaceIcon({ icon, color, size = 16 }: WorkspaceIconProps) {
  const drawing = isWorkspaceIconId(icon) && icon !== 'dot' ? WORKSPACE_ICON_DRAWINGS[icon] : null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill={drawing ? 'none' : color}
      stroke={drawing ? color : 'none'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawing ?? <circle cx="12" cy="12" r="5" />}
    </svg>
  );
}
