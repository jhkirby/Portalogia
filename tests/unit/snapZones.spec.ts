// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { test, expect } from '@playwright/test';
import { snapZoneAt } from '../../src/main/windows/snapZones';

// A 1920x1080 display whose bottom 40px are the taskbar.
const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

test.describe('snapZoneAt', () => {
  test('the middle of the screen is no zone', () => {
    expect(snapZoneAt({ x: 900, y: 500 }, DISPLAY, WORK_AREA)).toBeNull();
    expect(snapZoneAt({ x: 900, y: 30 }, DISPLAY, WORK_AREA)).toBeNull();
  });

  test('the top edge maximizes into the work area', () => {
    const zone = snapZoneAt({ x: 900, y: 0 }, DISPLAY, WORK_AREA);
    expect(zone).toEqual({ kind: 'maximize', rect: WORK_AREA });
  });

  test('the left and right edges snap to that half of the work area', () => {
    expect(snapZoneAt({ x: 0, y: 500 }, DISPLAY, WORK_AREA)).toEqual({
      kind: 'snap',
      rect: { x: 0, y: 0, width: 960, height: 1040 },
    });
    expect(snapZoneAt({ x: 1919, y: 500 }, DISPLAY, WORK_AREA)).toEqual({
      kind: 'snap',
      rect: { x: 960, y: 0, width: 960, height: 1040 },
    });
  });

  test('the four corners snap to a quarter', () => {
    expect(snapZoneAt({ x: 0, y: 0 }, DISPLAY, WORK_AREA)?.rect).toEqual({ x: 0, y: 0, width: 960, height: 520 });
    expect(snapZoneAt({ x: 1919, y: 0 }, DISPLAY, WORK_AREA)?.rect).toEqual({ x: 960, y: 0, width: 960, height: 520 });
    expect(snapZoneAt({ x: 0, y: 1079 }, DISPLAY, WORK_AREA)?.rect).toEqual({ x: 0, y: 520, width: 960, height: 520 });
    expect(snapZoneAt({ x: 1919, y: 1079 }, DISPLAY, WORK_AREA)?.rect).toEqual({
      x: 960,
      y: 520,
      width: 960,
      height: 520,
    });
  });

  test('an odd work-area width gives the right half the extra pixel, so the halves tile exactly', () => {
    const work = { x: 0, y: 0, width: 1921, height: 1040 };
    const left = snapZoneAt({ x: 0, y: 500 }, DISPLAY, work)!.rect;
    const right = snapZoneAt({ x: 1919, y: 500 }, DISPLAY, work)!.rect;
    expect(left.width + right.width).toBe(1921);
    expect(right.x).toBe(left.x + left.width);
  });

  test('measures against the display the cursor is on, including one with a negative origin', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const leftWork = { x: -1920, y: 0, width: 1920, height: 1040 };
    expect(snapZoneAt({ x: -1920, y: 500 }, left, leftWork)?.rect).toEqual({
      x: -1920,
      y: 0,
      width: 960,
      height: 1040,
    });
    expect(snapZoneAt({ x: -1, y: 500 }, left, leftWork)?.rect).toEqual({ x: -960, y: 0, width: 960, height: 1040 });
  });
});
