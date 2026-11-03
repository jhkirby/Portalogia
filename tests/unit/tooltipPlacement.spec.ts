// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { test, expect } from '@playwright/test';
import { TOOLTIP_OVERLAY_GAP_PX } from '../../src/shared/constants';
import { TOOLTIP_EDGE_MARGIN_PX, placeTooltip } from '../../src/renderer/lib/tooltipOverlay';

const VIEWPORT = { width: 1000, height: 700 };
const SIZE = { width: 120, height: 24 };

/** A button's box at a point, 30px square. */
function anchorAt(left: number, top: number): { top: number; bottom: number; left: number; right: number } {
  return { top, bottom: top + 30, left, right: left + 30 };
}

function inside(rect: { top: number; left: number; width: number; height: number }): boolean {
  return (
    rect.left >= TOOLTIP_EDGE_MARGIN_PX &&
    rect.top >= TOOLTIP_EDGE_MARGIN_PX &&
    rect.left + rect.width <= VIEWPORT.width - TOOLTIP_EDGE_MARGIN_PX &&
    rect.top + rect.height <= VIEWPORT.height - TOOLTIP_EDGE_MARGIN_PX
  );
}

test.describe('placeTooltip', () => {
  test('opens above its button, centred on it, where there is room', () => {
    const rect = placeTooltip(SIZE, anchorAt(400, 300), VIEWPORT);
    expect(rect.top).toBe(300 - TOOLTIP_OVERLAY_GAP_PX - SIZE.height);
    expect(rect.left + rect.width / 2).toBe(415);
  });

  test('opens below a button in the top row, where there is no room above (the tab close and new-tab buttons)', () => {
    const rect = placeTooltip(SIZE, anchorAt(400, 8), VIEWPORT);
    expect(rect.top).toBe(38 + TOOLTIP_OVERLAY_GAP_PX);
  });

  test('a button at either side of the window keeps its tooltip inside it', () => {
    for (const left of [0, 2, VIEWPORT.width - 30, VIEWPORT.width - 10]) {
      expect(inside(placeTooltip(SIZE, anchorAt(left, 300), VIEWPORT)), `button at ${left}`).toBe(true);
    }
  });

  test('a button at the very bottom keeps its tooltip inside the window', () => {
    expect(inside(placeTooltip(SIZE, anchorAt(400, VIEWPORT.height - 30), VIEWPORT))).toBe(true);
  });

  test('a tooltip wider than the window takes the window\'s width, inside its margins', () => {
    const rect = placeTooltip({ width: 5000, height: 24 }, anchorAt(400, 300), VIEWPORT);
    expect(rect.width).toBe(VIEWPORT.width - 2 * TOOLTIP_EDGE_MARGIN_PX);
    expect(inside(rect)).toBe(true);
  });
});
