// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { formatShortcut } from '../../lib/shortcuts';
import { CornerButton } from './CornerButton';

/** The side panel's shortcut, after Ctrl (the menu's `CmdOrCtrl+Alt+B`, see `buildMenu.ts`). */
const SIDE_PANEL_KEYS = 'Alt+B';

interface SidePanelToggleProps {
  readonly open: boolean;
  /** What the panel holds, for the button's label: "Show <what>" / "Hide <what>". */
  readonly what: string;
  readonly onToggle: () => void;
}

/**
 * The button in the top-right corner of a note or PDF that shows and hides
 * its side panel (Ctrl+Alt+B does too). Filled while the panel is open;
 * hovering fills it a shade further either way.
 */
export function SidePanelToggle({ open, what, onToggle }: SidePanelToggleProps) {
  return (
    <CornerButton
      label={`${open ? 'Hide' : 'Show'} ${what}`}
      shortcut={formatShortcut(SIDE_PANEL_KEYS)}
      pressed={open}
      onClick={onToggle}
    >
      ☰
    </CornerButton>
  );
}
