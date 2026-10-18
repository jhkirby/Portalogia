// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { useEffect, useRef, useState } from 'react';
import type { RGB } from '@shared/color';
import { ACCENT_STORAGE_KEY, DEFAULT_ACCENT, readStoredAccent } from '../../lib/accentStorage';

/** One point the pointer passed through while a stroke was down, timestamped against `performance.now()` so the render loop can age it out. */
interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  /** Which press drew it: segments are only drawn between points of the same stroke, so a new press never joins the last one's tail. */
  readonly stroke: number;
}

/** How long a trail point stays visible before it's dropped — the "tail fades over time" half of the streak. */
const TRAIL_MAX_AGE_MS = 550;
/** How many points a streak can hold at once regardless of age — the "finite length" half; a fast, sustained drag ages its oldest points out well before this caps it, but a very tight scribble hits this first. */
const TRAIL_MAX_POINTS = 60;
/** The pointer dot's radius, and the streak's width at its freshest (newest) point — the streak tapers to a point as it fades, same as a real laser's afterglow. */
const DOT_RADIUS_PX = 6;
const TRAIL_MAX_WIDTH_PX = 9;

/**
 * Reads the app's current accent color and keeps it live, for the canvas
 * below to draw the dot/streak in — the read-only half of `useAccentColor`
 * (this overlay never edits it), same mechanism `watchAccentColor` uses for
 * every other overlay page, just kept as `RGB` numbers here instead of a
 * `--color-accent-rgb` CSS custom property, since a `<canvas>` fillStyle
 * needs the actual channels, not something only CSS can read.
 */
function useAccent(): RGB {
  const [accent, setAccent] = useState<RGB>(() => readStoredAccent() ?? DEFAULT_ACCENT);
  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === ACCENT_STORAGE_KEY) {
        setAccent(readStoredAccent() ?? DEFAULT_ACCENT);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  return accent;
}

/**
 * The laser pointer's own page: a full-bleed, transparent `<canvas>` that
 * replaces the cursor with a colored dot tracking the mouse, and — while
 * the mouse is held down — leaves a streak behind it whose tail fades out
 * over `TRAIL_MAX_AGE_MS`. Runs entirely on its own `requestAnimationFrame`
 * loop against refs, not React state, since a state update per mouse-move
 * (easily 100+/sec) would otherwise re-render this component that often;
 * the only thing ever held in state is the accent color, which changes at
 * most a few times a session.
 *
 * `LaserPointerOverlay` (main process) mounts this page's `WebContentsView`
 * sized to exactly the active tab's own content bounds and never sends it
 * anything — every pixel this needs (window size, mouse position, accent
 * color) is already available inside this document itself.
 */
export function LaserPointerOverlayView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const accent = useAccent();
  const accentRef = useRef(accent);
  accentRef.current = accent;

  // Mutable, per-frame pointer state — see this component's own doc comment
  // for why these are refs rather than `useState`.
  const pointerRef = useRef<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const isDownRef = useRef(false);
  const trailRef = useRef<TrailPoint[]>([]);
  const strokeRef = useRef(0);

  // Sizes the canvas's backing store to the window's actual device pixels
  // (so the drawing stays crisp on a high-DPI display) while its CSS size
  // stays at the window's logical size — same split every canvas-based UI
  // needs, just with nothing else in this app having had one before now.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Pointer tracking — a stroke (and its streak) runs for as long as the
  // primary button stays down, same as dragging in any drawing tool.
  // `setPointerCapture` keeps `pointermove`/`pointerup` reporting even if a
  // fast drag's coordinates briefly land right at this view's own edge.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const handlePointerMove = (event: PointerEvent): void => {
      pointerRef.current = { x: event.clientX, y: event.clientY, visible: true };
      if (isDownRef.current) {
        trailRef.current.push({ x: event.clientX, y: event.clientY, t: performance.now(), stroke: strokeRef.current });
      }
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      isDownRef.current = true;
      strokeRef.current += 1;
      canvas.setPointerCapture(event.pointerId);
      trailRef.current.push({ x: event.clientX, y: event.clientY, t: performance.now(), stroke: strokeRef.current });
    };
    const handlePointerUp = (event: PointerEvent): void => {
      isDownRef.current = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    const handlePointerLeave = (): void => {
      pointerRef.current = { ...pointerRef.current, visible: false };
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  // The render loop itself — ages the trail out, draws whatever's left of
  // it plus the current dot, every frame, for as long as this page exists
  // (it's only ever unmounted by `LaserPointerOverlay` removing the whole
  // view, not by anything inside this document).
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    let frame = 0;

    const draw = (): void => {
      const now = performance.now();
      trailRef.current = trailRef.current
        .filter((point) => now - point.t <= TRAIL_MAX_AGE_MS)
        .slice(-TRAIL_MAX_POINTS);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const { r, g, b } = accentRef.current;
      const trail = trailRef.current;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < trail.length; i += 1) {
        const point = trail[i]!;
        const previous = trail[i - 1]!;
        if (previous.stroke !== point.stroke) {
          continue;
        }
        const age = now - point.t;
        const fade = Math.max(0, 1 - age / TRAIL_MAX_AGE_MS);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(fade * 0.85).toFixed(3)})`;
        ctx.lineWidth = Math.max(1, TRAIL_MAX_WIDTH_PX * fade);
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }

      const pointer = pointerRef.current;
      if (pointer.visible) {
        ctx.save();
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, DOT_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} />;
}
