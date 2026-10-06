// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/**
 * The icons a workspace can wear in the sidebar. The ids live here, shared,
 * so main can refuse an id the chrome has no drawing for; the drawings
 * themselves are in the renderer (`workspaceIcons.tsx`), typed against this
 * list so a missing one is a compile error.
 */
export const WORKSPACE_ICON_IDS = [
  'dot',
  'home',
  'briefcase',
  'book',
  'bookmark',
  'calendar',
  'camera',
  'cloud',
  'code',
  'coffee',
  'compass',
  'cpu',
  'database',
  'dollar',
  'edit',
  'eye',
  'file',
  'film',
  'flag',
  'folder',
  'gift',
  'globe',
  'grid',
  'headphones',
  'heart',
  'image',
  'inbox',
  'key',
  'layers',
  'lock',
  'mail',
  'map-pin',
  'message',
  'mic',
  'monitor',
  'moon',
  'music',
  'package',
  'phone',
  'pie-chart',
  'printer',
  'shield',
  'shopping-cart',
  'smile',
  'star',
  'sun',
  'tag',
  'terminal',
  'tool',
  'trending-up',
  'truck',
  'tv',
  'user',
  'video',
  'wifi',
  'zap',
] as const;

export type WorkspaceIconId = (typeof WORKSPACE_ICON_IDS)[number];

/** The icon a new workspace starts with — the plain colored dot the sidebar always used. */
export const DEFAULT_WORKSPACE_ICON: WorkspaceIconId = 'dot';

/** @returns Whether a string names an icon the chrome can draw. */
export function isWorkspaceIconId(value: string): value is WorkspaceIconId {
  return (WORKSPACE_ICON_IDS as readonly string[]).includes(value);
}
