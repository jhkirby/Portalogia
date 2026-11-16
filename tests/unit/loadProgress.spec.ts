// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { test, expect } from '@playwright/test';
import {
  beginLoad,
  endLoad,
  requestFinished,
  requestStarted,
  responseStarted,
  type LoadBytes,
} from '../../src/main/browser/loadProgress';

/** Each test's page: the tracker is module-wide, so no two tests share one. */
let nextPage = 1000;

/** A page under load, with every report it made. */
function startPage(): { page: number; reports: { percent: number; bytes: LoadBytes }[] } {
  const page = nextPage++;
  const reports: { percent: number; bytes: LoadBytes }[] = [];
  beginLoad(page, (percent, bytes) => reports.push({ percent, bytes }));
  return { page, reports };
}

test.describe('a page load’s bytes', () => {
  test('a response’s size joins the total as it starts, and the loaded bytes as it finishes', () => {
    const { page, reports } = startPage();
    requestStarted(page, 0);
    responseStarted(page, 1, 4000, 100);
    expect(reports.at(-1)?.bytes).toEqual({ loaded: 0, total: 4000 });
    requestFinished(page, 1, false, 200);
    expect(reports.at(-1)?.bytes).toEqual({ loaded: 4000, total: 4000 });
    endLoad(page);
  });

  test('a failed response comes off the total, as it won’t arrive', () => {
    const { page, reports } = startPage();
    requestStarted(page, 0);
    requestStarted(page, 0);
    responseStarted(page, 1, 1000, 100);
    responseStarted(page, 2, 3000, 200);
    requestFinished(page, 2, true, 300);
    expect(reports.at(-1)?.bytes).toEqual({ loaded: 0, total: 1000 });
    endLoad(page);
  });

  test('a response with no size, or one counted already, adds nothing', () => {
    const { page, reports } = startPage();
    responseStarted(page, 1, null, 100);
    responseStarted(page, 2, 0, 200);
    responseStarted(page, 3, 500, 300);
    responseStarted(page, 3, 500, 400);
    expect(reports.at(-1)?.bytes).toEqual({ loaded: 0, total: 500 });
    endLoad(page);
  });

  test('reports come no closer together than the interval, however many bytes arrive', () => {
    const { page, reports } = startPage();
    const before = reports.length;
    responseStarted(page, 1, 100, 1000);
    responseStarted(page, 2, 100, 1010);
    responseStarted(page, 3, 100, 1020);
    expect(reports.length - before).toBe(1);
    endLoad(page);
  });

  test('the load’s last count is what it loaded, over itself', () => {
    const { page } = startPage();
    requestStarted(page, 0);
    requestStarted(page, 0);
    responseStarted(page, 1, 2000, 100);
    responseStarted(page, 2, 9000, 200);
    requestFinished(page, 1, false, 300);
    // The second is still on its way when the page says it's done (a request it keeps open).
    expect(endLoad(page)).toEqual({ loaded: 2000, total: 2000 });
    expect(endLoad(page)).toBeNull();
  });

  test('a request of another page, or of none, is left alone', () => {
    const { page, reports } = startPage();
    responseStarted(undefined, 1, 1000, 100);
    responseStarted(page + 999_999, 1, 1000, 100);
    expect(reports.at(-1)?.bytes).toEqual({ loaded: 0, total: 0 });
    endLoad(page);
  });
});
