// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

interface SidebarIconProps {
  /** Whether the sidebar is shown: its left pane is drawn filled, where a hidden one is only a thin divider. */
  readonly open: boolean;
  /** Edge length in px — the workspace icons' size, so it lines up with them in the collapsed rail. */
  readonly size?: number;
}

/**
 * A window with a pane down its left side: the workspace sidebar, as its
 * show/hide button in `WorkspaceBar` draws it. The pane is filled while the
 * sidebar is shown and only outlined while it's hidden, so the icon shows
 * the sidebar's state rather than what a click will do.
 */
export function SidebarIcon({ open, size = 16 }: SidebarIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {open ? (
        <rect x="5.5" y="6.5" width="4.5" height="11" rx="1" fill="currentColor" />
      ) : (
        <path d="M9 4.5v15" fill="none" stroke="currentColor" strokeWidth="1.8" />
      )}
    </svg>
  );
}
