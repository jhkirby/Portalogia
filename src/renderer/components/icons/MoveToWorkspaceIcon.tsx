// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

interface MoveToWorkspaceIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/**
 * The move-to-workspace button's icon: a tab with an arrow leaving it for a
 * stack of workspaces (the sidebar's layered look), in the stroke of the
 * duplicate and split icons beside it.
 */
export function MoveToWorkspaceIcon({ size = 16 }: MoveToWorkspaceIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* The tab. */}
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h3l1 1.5h3A1.5 1.5 0 0 1 13 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 18.5Z" />
      {/* The arrow out of it. */}
      <path d="M8 14.5h7.5M13 12l2.5 2.5L13 17" />
      {/* The workspaces it goes to. */}
      <path d="M17 6.5l3.5 1.75L17 10l-3.5-1.75Z" />
      <path d="M20.5 11.5 17 13.25" />
    </svg>
  );
}
