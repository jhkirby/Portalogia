// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

interface WorkspaceImagesIconProps {
  /** Edge length in px. */
  readonly size?: number;
}

/** Three stacked layers — the sidebar's button for the list of saved workspace images (snapshots of a workspace's tabs). */
export function WorkspaceImagesIcon({ size = 16 }: WorkspaceImagesIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5 3.5 8.2 12 12.9l8.5-4.7L12 3.5Z" />
      <path d="m3.5 12.2 8.5 4.7 8.5-4.7" />
      <path d="m3.5 16.2 8.5 4.7 8.5-4.7" />
    </svg>
  );
}
