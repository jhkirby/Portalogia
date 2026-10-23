// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-19

import { test, expect } from '@playwright/test';
import { DragPanner, type PanScroller } from '../../src/shared/DragPanner';
import { PAN_WRAP_LANDING_INSET_PX, PAN_WRAP_TIMEOUT_MS, type PanBounds } from '../../src/shared/panWrap';

const VIEW: PanBounds = { left: 0, top: 0, right: 800, bottom: 600 };

/** A panner over `VIEW` with a clock the test moves by hand, and a record of every pointer warp it asked for. */
function setUp(bounds: PanBounds = VIEW): {
  panner: DragPanner;
  scroller: PanScroller;
  warps: { x: number; y: number }[];
  clock: { now: number };
} {
  const warps: { x: number; y: number }[] = [];
  const clock = { now: 1000 };
  const panner = new DragPanner({
    viewBounds: () => bounds,
    warpPointer: (x, y) => warps.push({ x, y }),
    now: () => clock.now,
  });
  return { panner, scroller: { scrollLeft: 500, scrollTop: 500 }, warps, clock };
}

test.describe('DragPanner', () => {
  test('the page follows the hand: dragging down and right scrolls up and left', () => {
    const { panner, scroller } = setUp();
    panner.press(scroller, 400, 300);
    panner.move(430, 340);
    expect(scroller).toEqual({ scrollLeft: 470, scrollTop: 460 });
    panner.move(420, 300);
    expect(scroller).toEqual({ scrollLeft: 480, scrollTop: 500 });
  });

  test('moving with nothing grabbed scrolls nothing', () => {
    const { panner, scroller } = setUp();
    panner.move(430, 340);
    expect(scroller).toEqual({ scrollLeft: 500, scrollTop: 500 });
    expect(panner.isPanning).toBe(false);
  });

  test('letting go ends the pan', () => {
    const { panner, scroller } = setUp();
    panner.press(scroller, 400, 300);
    expect(panner.isPanning).toBe(true);
    panner.release();
    expect(panner.isPanning).toBe(false);
    panner.move(300, 200);
    expect(scroller).toEqual({ scrollLeft: 500, scrollTop: 500 });
  });

  test('reaching an edge sends the pointer to just inside the opposite one', () => {
    const { panner, scroller, warps } = setUp();
    panner.press(scroller, 400, 300);
    panner.move(400, 599);
    expect(warps).toEqual([{ x: 400, y: PAN_WRAP_LANDING_INSET_PX }]);
  });

  test('the move that lands the wrapped pointer does not scroll, and the drag carries on from there', () => {
    const { panner, scroller } = setUp();
    panner.press(scroller, 400, 300);
    panner.move(400, 599);
    const afterEdge = scroller.scrollTop;
    // The pointer arrives at the top: a jump of most of the view, which is the wrap, not the hand.
    panner.move(400, PAN_WRAP_LANDING_INSET_PX);
    expect(scroller.scrollTop).toBe(afterEdge);
    panner.move(400, PAN_WRAP_LANDING_INSET_PX + 50);
    expect(scroller.scrollTop).toBe(afterEdge - 50);
  });

  test('only one wrap is asked for while one is on its way', () => {
    const { panner, scroller, warps } = setUp();
    panner.press(scroller, 400, 300);
    panner.move(400, 599);
    panner.move(400, 600);
    expect(warps).toHaveLength(1);
  });

  test('a wrap that never lands is given up on, and the drag goes on as an ordinary one', () => {
    const { panner, scroller, warps, clock } = setUp();
    panner.press(scroller, 400, 300);
    panner.move(400, 599);
    clock.now += PAN_WRAP_TIMEOUT_MS + 1;
    const before = scroller.scrollTop;
    panner.move(400, 590);
    expect(scroller.scrollTop).toBe(before + 9);
    // Back at the edge, it may ask again.
    panner.move(400, 599);
    expect(warps).toHaveLength(2);
  });

  test('a view too small to land in never wraps', () => {
    const tiny: PanBounds = { left: 0, top: 0, right: 2 * PAN_WRAP_LANDING_INSET_PX, bottom: 2 * PAN_WRAP_LANDING_INSET_PX };
    const { panner, scroller, warps } = setUp(tiny);
    panner.press(scroller, 5, 5);
    panner.move(0, 0);
    expect(warps).toEqual([]);
  });

  test('a second press starts a new pan on the new scroller', () => {
    const { panner, scroller } = setUp();
    const other: PanScroller = { scrollLeft: 0, scrollTop: 100 };
    panner.press(scroller, 400, 300);
    panner.press(other, 100, 100);
    panner.move(100, 80);
    expect(other).toEqual({ scrollLeft: 0, scrollTop: 120 });
    expect(scroller).toEqual({ scrollLeft: 500, scrollTop: 500 });
  });
});
