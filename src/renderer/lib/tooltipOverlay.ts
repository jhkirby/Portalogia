// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import {
  TOOLTIP_OVERLAY_BORDER_PX,
  TOOLTIP_OVERLAY_FONT_PX,
  TOOLTIP_OVERLAY_GAP_PX,
  TOOLTIP_OVERLAY_LINE_HEIGHT_PX,
  TOOLTIP_OVERLAY_PADDING_X_PX,
  TOOLTIP_OVERLAY_PADDING_Y_PX,
} from '@shared/constants';

/** The least room kept between a tooltip and the window's edges. */
export const TOOLTIP_EDGE_MARGIN_PX = 4;

/** The hovered element's own box, as `getBoundingClientRect()` gives it. */
export interface TooltipAnchorRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** The window's size, in the chrome's CSS pixels. */
export interface TooltipViewport {
  readonly width: number;
  readonly height: number;
}

/** Where a tooltip goes, in the chrome's CSS pixels. */
export interface TooltipRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

let measureCanvas: HTMLCanvasElement | null = null;

/**
 * Measures how wide `text` renders at `TooltipOverlay`'s own font
 * (`tooltip-overlay.css`) — a `<canvas>` is reused across calls rather than
 * created fresh each time since every hover measures, and the text is never
 * laid out in this renderer to measure directly.
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
 * Places a tooltip of a given size against the element it explains: centred
 * on it, just above it — or just below where there's no room above (the top
 * row's buttons) — and moved in from any edge it would cross, so the whole
 * tooltip is always inside the window. One too wide for the window takes the
 * window's width (its text cut short).
 * @param size The tooltip's natural width and its height.
 * @param anchor The hovered element's box.
 * @param viewport The window's size.
 * @returns Where the tooltip goes.
 */
export function placeTooltip(
  size: { readonly width: number; readonly height: number },
  anchor: TooltipAnchorRect,
  viewport: TooltipViewport,
): TooltipRect {
  const margin = TOOLTIP_EDGE_MARGIN_PX;
  const width = Math.max(0, Math.min(size.width, viewport.width - 2 * margin));
  const { height } = size;
  const above = anchor.top - TOOLTIP_OVERLAY_GAP_PX - height;
  const below = anchor.bottom + TOOLTIP_OVERLAY_GAP_PX;
  const top = above >= margin ? above : below;
  const centred = (anchor.left + anchor.right) / 2 - width / 2;
  return {
    top: clamp(top, margin, viewport.height - height - margin),
    left: clamp(centred, margin, viewport.width - width - margin),
    width,
    height,
  };
}

/**
 * Computes the bounds `TooltipOverlay`'s native view should take for `text`
 * hovered on `anchor` — `placeTooltip` with the overlay's own measured size.
 */
export function computeTooltipOverlayRect(text: string, anchor: TooltipAnchorRect, viewport: TooltipViewport): TooltipRect {
  // The text, its padding, and the accent border around them.
  const width = Math.ceil(measureTooltipTextWidth(text)) + 2 * (TOOLTIP_OVERLAY_PADDING_X_PX + TOOLTIP_OVERLAY_BORDER_PX);
  const height = TOOLTIP_OVERLAY_LINE_HEIGHT_PX + 2 * (TOOLTIP_OVERLAY_PADDING_Y_PX + TOOLTIP_OVERLAY_BORDER_PX);
  return placeTooltip({ width, height }, anchor, viewport);
}

/** `value` held between `min` and `max` (`min` wins if they cross, as in a window too small for the tooltip). */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
