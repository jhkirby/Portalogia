// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

/** A tab with a plus in it: a table row's button to open it in a new tab (the History and Bookmarks tables). */
export function OpenInNewTabIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2 13.5V5.3a1.3 1.3 0 0 1 1.3-1.3h3.4l1.2 1.5h5.8a1.3 1.3 0 0 1 1.3 1.3v6.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M1.5 13.5h13M8 8v4M6 10h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
