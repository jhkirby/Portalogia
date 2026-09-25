// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { useEffect, useState } from 'react';
import type { TooltipSyncPayload } from '@shared/ipc-contract';

/**
 * The whole of `tooltip.html`'s page — a collapsed-sidebar tooltip's text,
 * rendered here instead of in the chrome's own DOM so it can sit visually
 * above the active tab's live `WebContentsView` without that view ever
 * needing to be hidden (see `TooltipOverlay` on the main-process side for
 * why a chrome-drawn tooltip can't do that here the way it can everywhere
 * else — tooltip.css's plain `::after` version).
 *
 * This view's own `WebContentsView` bounds are always sized to exactly the
 * text's own measured box (see `TooltipOverlay.sync`), so there's nothing
 * to lay out here beyond the text itself.
 */
export function TooltipOverlayView() {
  const [payload, setPayload] = useState<TooltipSyncPayload | null>(null);

  useEffect(() => window.northstarTooltip.onSync(setPayload), []);

  if (!payload || !payload.visible) {
    return null;
  }

  return <div className="tooltip-overlay">{payload.text}</div>;
}
