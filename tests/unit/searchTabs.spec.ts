// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-15

import { test, expect } from '@playwright/test';
import { searchTabs } from '../../src/renderer/lib/searchTabs';
import type { TabState } from '../../src/shared/tab-state';

function makeTab(overrides: Partial<TabState> & Pick<TabState, 'id'>): TabState {
  return {
    kind: 'browser',
    title: 'New Tab',
    url: 'northstar://home/',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    workspaceId: 'default',
    ...overrides,
  };
}

const TABS: readonly TabState[] = [
  makeTab({ id: '1', title: '10 Best Hiking Trails Near You', url: 'https://example.com/hiking' }),
  makeTab({ id: '2', title: 'Purdue University - Google Search', url: 'https://www.google.com/search?q=purdue' }),
  makeTab({ id: '3', title: 'New Tab', url: 'northstar://home/' }),
];

test.describe('searchTabs', () => {
  test('returns every tab, in order, for a blank query', () => {
    expect(searchTabs(TABS, '')).toEqual(TABS);
  });

  test('matches a naturally phrased query after dropping stopwords', () => {
    const results = searchTabs(TABS, 'that page about hiking');
    expect(results.map((tab) => tab.id)).toEqual(['1']);
  });

  test('ranks a title match above a URL-only match', () => {
    const results = searchTabs(
      [
        makeTab({ id: 'title-match', title: 'Purdue', url: 'https://example.com/' }),
        makeTab({ id: 'url-match', title: 'Unrelated', url: 'https://purdue.edu/' }),
      ],
      'purdue',
    );
    expect(results.map((tab) => tab.id)).toEqual(['title-match', 'url-match']);
  });

  test('returns nothing for a query matching no tab', () => {
    expect(searchTabs(TABS, 'gadgets')).toEqual([]);
  });

  test('is case-insensitive', () => {
    expect(searchTabs(TABS, 'PURDUE').map((tab) => tab.id)).toEqual(['2']);
  });
});
