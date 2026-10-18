// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { test, expect } from '@playwright/test';
import {
  PAN_WRAP_EDGE_PX,
  PAN_WRAP_LANDING_INSET_PX,
  wrapTargetAt,
} from '../../src/renderer/components/PdfViewer/panWrap';

const VIEW = { left: 100, top: 50, right: 900, bottom: 650 };

test.describe('wrapTargetAt', () => {
  test('away from every edge, the pointer stays put', () => {
    expect(wrapTargetAt(VIEW, 500, 300)).toBeNull();
  });

  test('at the bottom edge it goes to just inside the top, keeping its x', () => {
    expect(wrapTargetAt(VIEW, 500, 649)).toEqual({ x: null, y: 50 + PAN_WRAP_LANDING_INSET_PX });
  });

  test('at the left edge it goes to just inside the right', () => {
    expect(wrapTargetAt(VIEW, 100 + PAN_WRAP_EDGE_PX, 300)).toEqual({ x: 899 - PAN_WRAP_LANDING_INSET_PX, y: null });
  });

  test('past an edge (a captured drag outside the view) counts as at it', () => {
    expect(wrapTargetAt(VIEW, 500, 20)).toEqual({ x: null, y: 649 - PAN_WRAP_LANDING_INSET_PX });
  });

  test('in a corner both axes wrap', () => {
    expect(wrapTargetAt(VIEW, 899, 649)).toEqual({ x: 100 + PAN_WRAP_LANDING_INSET_PX, y: 50 + PAN_WRAP_LANDING_INSET_PX });
  });

  test('a landing spot is never in a wrap zone, so landing doesn\'t wrap again', () => {
    for (const target of [wrapTargetAt(VIEW, 100, 300), wrapTargetAt(VIEW, 899, 300)]) {
      expect(wrapTargetAt(VIEW, target!.x!, 300)).toBeNull();
    }
  });

  test('a view too small to land in clear of both edges never wraps', () => {
    expect(wrapTargetAt({ left: 0, top: 0, right: 20, bottom: 600 }, 0, 300)).toBeNull();
  });
});
