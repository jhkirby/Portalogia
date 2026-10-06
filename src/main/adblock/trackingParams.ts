// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/** Query parameters that only exist to follow a person from one site to another; no page needs them to work. */
const TRACKING_PARAM_PATTERNS: readonly RegExp[] = [
  /^utm_/i,
  /^(fbclid|gclid|gclsrc|dclid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|mc_eid|mc_cid|_hsenc|_hsmi|__hstc|__hsfp|hsctatracking|vero_id|oly_enc_id|oly_anon_id|wickedid|spm|ref_src|ref_url|s_cid)$/i,
];

/**
 * Removes tracking parameters from a URL.
 * @param rawUrl The URL a page is about to navigate to.
 * @returns The cleaned URL, or `null` if it had nothing to strip (or isn't http(s)).
 */
export function stripTrackingParams(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  const doomed = [...url.searchParams.keys()].filter((key) => TRACKING_PARAM_PATTERNS.some((p) => p.test(key)));
  if (doomed.length === 0) {
    return null;
  }
  for (const key of doomed) {
    url.searchParams.delete(key);
  }
  return url.toString();
}
