// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { test, expect } from '@playwright/test';
import { previewTabOrder } from '../../src/renderer/lib/previewTabOrder';
import { tabDropTargetAt, type TabDropTarget, type TabSlot } from '../../src/renderer/lib/tabDropTarget';

const IDS = ['a', 'b', 'c', 'd'];

/** Lays tabs out side by side, each `width` wide (or as `widths` says), in the order given. */
function layOut(order: readonly string[], widths: Readonly<Record<string, number>> = {}): TabSlot[] {
  let left = 0;
  return order.map((id) => {
    const width = widths[id] ?? 100;
    const slot = { id, left, width };
    left += width;
    return slot;
  });
}

/**
 * Drags `dragged` along a path of pointer positions the way the strip does:
 * each position is read against the layout the previous preview produced.
 * @returns The order shown after each step.
 */
function drag(dragged: readonly string[], path: readonly number[], widths: Readonly<Record<string, number>> = {}): string[][] {
  let target: TabDropTarget | null = null;
  const shown: string[][] = [];
  for (const x of path) {
    const order = previewTabOrder(IDS, dragged, target?.id ?? null, target?.side ?? 'before');
    target = tabDropTargetAt(layOut(order, widths), dragged, x) ?? target;
    shown.push(previewTabOrder(IDS, dragged, target?.id ?? null, target?.side ?? 'before'));
  }
  return shown;
}

test.describe('tabDropTargetAt', () => {
  test('over the dragged tab itself, the preview stays as it is', () => {
    expect(tabDropTargetAt(layOut(IDS), ['b'], 150)).toBeNull();
  });

  test('over no tab (a gap, or past the end), the preview stays as it is', () => {
    expect(tabDropTargetAt(layOut(IDS), ['b'], 450)).toBeNull();
  });

  test('past a neighbour\'s middle the dragged tab goes to that side of it', () => {
    expect(tabDropTargetAt(layOut(IDS), ['b'], 260)).toEqual({ id: 'c', side: 'after' });
    expect(tabDropTargetAt(layOut(IDS), ['b'], 40)).toEqual({ id: 'a', side: 'before' });
  });

  test('a small wobble across the point where the tabs swapped never swaps them back', () => {
    const shown = drag(['b'], [150, 245, 255, 245, 255, 240, 260, 230]);
    expect(shown.slice(2)).toEqual(Array(6).fill(['a', 'c', 'b', 'd']));
  });

  test('going back takes crossing the neighbour\'s middle again', () => {
    const shown = drag(['b'], [150, 260, 160, 140]);
    expect(shown.map((order) => order.join(''))).toEqual(['abcd', 'acbd', 'acbd', 'abcd']);
  });

  test('a group wider than the tab it passes still sits under the pointer once past it', () => {
    const shown = drag(['a', 'b'], [50, 250, 230, 270, 210]);
    expect(shown.map((order) => order.join(''))).toEqual(['abcd', 'cabd', 'cabd', 'cabd', 'cabd']);
  });

  test('a fast drag past several tabs lands beside the one under the pointer', () => {
    expect(drag(['a'], [50, 360]).at(-1)).toEqual(['b', 'c', 'd', 'a']);
  });
});
