// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { test, expect } from '@playwright/test';
import { previewTabOrder } from '../../src/renderer/lib/previewTabOrder';

const IDS = ['a', 'b', 'c', 'd'];

test.describe('previewTabOrder', () => {
  test('moves the dragged tab before or after the target', () => {
    expect(previewTabOrder(IDS, ['a'], 'c', 'before')).toEqual(['b', 'a', 'c', 'd']);
    expect(previewTabOrder(IDS, ['a'], 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(previewTabOrder(IDS, ['d'], 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
  });

  test('leaves the order alone with no target, or when hovering a dragged tab', () => {
    expect(previewTabOrder(IDS, ['b'], null, 'before')).toEqual(IDS);
    expect(previewTabOrder(IDS, ['b'], 'b', 'after')).toEqual(IDS);
    expect(previewTabOrder(IDS, ['b', 'c'], 'c', 'before')).toEqual(IDS);
  });

  test('ignores a target that is not in the strip', () => {
    expect(previewTabOrder(IDS, ['a'], 'zzz', 'after')).toEqual(IDS);
  });

  test('moves a multi-selection together, keeping its internal order', () => {
    expect(previewTabOrder(IDS, ['a', 'c'], 'd', 'after')).toEqual(['b', 'd', 'a', 'c']);
    expect(previewTabOrder(IDS, ['b', 'd'], 'a', 'before')).toEqual(['b', 'd', 'a', 'c']);
  });

  test('never loses or duplicates a tab', () => {
    for (const target of IDS) {
      for (const side of ['before', 'after'] as const) {
        expect(previewTabOrder(IDS, ['b'], target, side).slice().sort()).toEqual(IDS);
      }
    }
  });
});
