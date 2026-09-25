// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import {
  TOOLTIP_OVERLAY_FONT_PX,
  TOOLTIP_OVERLAY_GAP_PX,
  TOOLTIP_OVERLAY_LINE_HEIGHT_PX,
  TOOLTIP_OVERLAY_PADDING_X_PX,
  TOOLTIP_OVERLAY_PADDING_Y_PX,
} from '@shared/constants';

/** The hovered element's own `getBoundingClientRect()`, or just the two corners `computeTooltipOverlayRect` actually needs from it. */
export interface TooltipAnchorRect {
  readonly top: number;
  readonly left: number;
}

let measureCanvas: HTMLCanvasElement | null = null;

/**
 * Measures how wide `text` renders at `TooltipOverlay`'s own font
 * (`tooltip-overlay.css`) — a `<canvas>` is reused across calls rather than
 * created fresh each time since a hover fires this on every
 * `mouseenter`/text change, and there's no DOM node here to measure
 * against directly (unlike everywhere else this app measures a rect, this
 * text has never actually been laid out anywhere in *this* renderer).
 */
function measureTooltipTextWidth(text: string): number {
  const canvas = measureCanvas ?? (measureCanvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  if (!context) {
    return 0;
  }
  context.font = `400 ${TOOLTIP_OVERLAY_FONT_PX}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  return context.measureText(text).width;
}

/**
 * Computes the exact bounds `TooltipOverlay`'s own native view should
 * occupy for `text`, opening upward and left-anchored from `anchor` — the
 * same visual relationship tooltip.css's plain `::after` tooltip has to its
 * own button (`bottom: 100%`), just computed here instead of left to CSS
 * since this box lives in a second `WebContentsView`, not the chrome's own
 * DOM flow.
 */
export function computeTooltipOverlayRect(
  text: string,
  anchor: TooltipAnchorRect,
): { top: number; left: number; width: number; height: number } {
  const width = Math.ceil(measureTooltipTextWidth(text)) + 2 * TOOLTIP_OVERLAY_PADDING_X_PX;
  const height = TOOLTIP_OVERLAY_LINE_HEIGHT_PX + 2 * TOOLTIP_OVERLAY_PADDING_Y_PX;
  return {
    left: anchor.left,
    top: anchor.top - TOOLTIP_OVERLAY_GAP_PX - height,
    width,
    height,
  };
}
