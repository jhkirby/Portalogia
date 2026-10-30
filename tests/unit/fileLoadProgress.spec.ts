// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { FileLoadProgress, type ProgressTimers } from '../../src/main/browser/FileLoadProgress';
import { readFileCapped } from '../../src/main/platform/readFileCapped';

const HOLD_MS = 1000;

/** A clock the test moves by hand, so no test waits on real time. */
function fakeTimers(): ProgressTimers & { advance: (ms: number) => void } {
  let now = 0;
  let nextId = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout: (callback, ms) => {
      nextId += 1;
      pending.set(nextId, { at: now + ms, callback });
      return nextId;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function newLoad(): { load: FileLoadProgress; reports: (number | null)[]; clock: ReturnType<typeof fakeTimers> } {
  const reports: (number | null)[] = [];
  const clock = fakeTimers();
  return { load: new FileLoadProgress((percent) => reports.push(percent), HOLD_MS, clock), reports, clock };
}

test.describe('FileLoadProgress', () => {
  test('a load that finishes at once never shows: no flash of 100%', () => {
    const { load, reports, clock } = newLoad();
    load.begin();
    load.update(60);
    load.finish();
    clock.advance(5000);
    expect(reports).toEqual([]);
  });

  test('a slow load shows from where it has got, rises, holds 100% and then goes', () => {
    const { load, reports, clock } = newLoad();
    load.begin();
    load.update(20);
    clock.advance(200);
    expect(reports).toEqual([20]);
    load.update(45.9);
    load.update(45.2); // the same whole percent: nothing new to say
    load.update(30); // never backwards
    load.finish();
    expect(reports).toEqual([20, 45, 100]);
    clock.advance(HOLD_MS - 1);
    expect(reports.at(-1)).toBe(100);
    clock.advance(1);
    expect(reports).toEqual([20, 45, 100, null]);
  });

  test('a failed load goes at once, without reaching 100%', () => {
    const { load, reports, clock } = newLoad();
    load.begin();
    clock.advance(200);
    load.update(30);
    load.cancel();
    clock.advance(5000);
    expect(reports).toEqual([0, 30, null]);
  });

  test('percentages outside 0-100 are held to it', () => {
    const { load, reports, clock } = newLoad();
    load.begin();
    clock.advance(200);
    load.update(250);
    load.update(-5);
    expect(reports).toEqual([0, 100]);
  });

  test('updates and finishes after the load ended are ignored', () => {
    const { load, reports, clock } = newLoad();
    load.begin();
    clock.advance(200);
    load.cancel();
    load.update(80);
    load.finish();
    clock.advance(5000);
    expect(reports).toEqual([0, null]);
  });

  test('a new load replaces one still holding at 100%: the old hold no longer clears the new progress', () => {
    const { load, reports, clock } = newLoad();
    load.begin();
    clock.advance(200);
    load.finish();
    expect(reports).toEqual([0, 100]);
    load.begin();
    expect(reports).toEqual([0, 100, null]);
    clock.advance(200);
    load.update(10);
    clock.advance(HOLD_MS);
    // Still showing the new load: the first one's hold timer was stopped.
    expect(reports).toEqual([0, 100, null, 0, 10]);
  });
});

test.describe('readFileCapped progress', () => {
  test('reports each chunk read against the file size, ending at the whole file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ns-read-'));
    try {
      const file = join(dir, 'big.bin');
      // Just over two 1 MB chunks.
      writeFileSync(file, Buffer.alloc(2 * 1024 * 1024 + 10, 7));
      const seen: [number, number][] = [];
      const read = await readFileCapped(file, 10 * 1024 * 1024, (bytesRead, totalBytes) => seen.push([bytesRead, totalBytes]));
      expect(read.kind).toBe('ok');
      expect(seen.length).toBe(3);
      expect(seen.at(-1)).toEqual([2 * 1024 * 1024 + 10, 2 * 1024 * 1024 + 10]);
      expect(seen.map(([bytesRead]) => bytesRead)).toEqual([...seen.map(([bytesRead]) => bytesRead)].sort((a, b) => a - b));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a file over the cap is refused, and progress stops there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ns-read-'));
    try {
      const file = join(dir, 'big.bin');
      writeFileSync(file, Buffer.alloc(4096, 1));
      const seen: number[] = [];
      const read = await readFileCapped(file, 1024, (bytesRead) => seen.push(bytesRead));
      expect(read.kind).toBe('too-large');
      expect(seen).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
