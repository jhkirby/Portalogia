// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { CursorWarper } from '../../src/main/platform/CursorWarper';

/** A stand-in for the PowerShell helper: records what it's sent, and can be made to exit. */
class FakeHelper extends EventEmitter {
  public readonly written: string[] = [];
  public exitCode: number | null = null;
  public killed = false;
  public readonly stdin = Object.assign(new EventEmitter(), {
    write: (chunk: string): boolean => {
      this.written.push(chunk);
      return true;
    },
  });

  public kill(): boolean {
    this.killed = true;
    return true;
  }

  public exit(): void {
    this.exitCode = 1;
    this.emit('exit', 1);
  }
}

/** A warper whose helpers are fakes, with the list of every one it started. */
function warperOn(platform: NodeJS.Platform): { warper: CursorWarper; helpers: FakeHelper[] } {
  const helpers: FakeHelper[] = [];
  const warper = new CursorWarper(() => {
    const helper = new FakeHelper();
    helpers.push(helper);
    return helper as unknown as ChildProcess;
  }, platform);
  return { warper, helpers };
}

test.describe('CursorWarper', () => {
  test('sends whole-pixel "x y" lines to one long-lived helper', () => {
    const { warper, helpers } = warperOn('win32');
    warper.moveTo(10.4, 20.6);
    warper.moveTo(-5, 7);
    expect(helpers).toHaveLength(1);
    expect(helpers[0]!.written).toEqual(['10 21\n', '-5 7\n']);
  });

  test('prepare starts the helper ahead of the first move', () => {
    const { warper, helpers } = warperOn('win32');
    warper.prepare();
    expect(helpers).toHaveLength(1);
    warper.moveTo(1, 2);
    expect(helpers).toHaveLength(1);
  });

  test('does nothing off Windows', () => {
    const { warper, helpers } = warperOn('linux');
    warper.prepare();
    warper.moveTo(1, 2);
    expect(helpers).toHaveLength(0);
  });

  test('a point that is not a finite number is never sent', () => {
    const { warper, helpers } = warperOn('win32');
    warper.moveTo(Number.NaN, 2);
    warper.moveTo(1, Number.POSITIVE_INFINITY);
    expect(helpers.flatMap((helper) => helper.written)).toEqual([]);
  });

  test('a helper that exits is replaced on the next move', () => {
    const { warper, helpers } = warperOn('win32');
    warper.moveTo(1, 1);
    helpers[0]!.exit();
    warper.moveTo(2, 2);
    expect(helpers).toHaveLength(2);
    expect(helpers[1]!.written).toEqual(['2 2\n']);
  });

  test('a helper that cannot start leaves the pointer alone instead of throwing', () => {
    const warper = new CursorWarper(() => {
      throw new Error('blocked');
    }, 'win32');
    expect(() => warper.moveTo(1, 1)).not.toThrow();
  });

  test('dispose ends the helper', () => {
    const { warper, helpers } = warperOn('win32');
    warper.prepare();
    warper.dispose();
    expect(helpers[0]!.killed).toBe(true);
  });
});
