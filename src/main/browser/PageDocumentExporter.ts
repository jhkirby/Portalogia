// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-01

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { WebContents } from 'electron';

/** Largest single stylesheet/script we'll save — a page can point at arbitrarily large files, and this runs unattended once the folder is picked. */
const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;

type ResourceKind = 'css' | 'js';

interface PageResource {
  readonly kind: ResourceKind;
  /** Absolute URL, already resolved against the page's own base by the browser. */
  readonly url: string;
}

/** In-page: lists every external stylesheet/script. `.href`/`.src` are already absolute. */
const COLLECT_RESOURCES_SCRIPT = `(() => {
  const out = [];
  document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((el) => out.push({ kind: 'css', url: el.href }));
  document.querySelectorAll('script[src]').forEach((el) => out.push({ kind: 'js', url: el.src }));
  return out;
})()`;

/**
 * Saves a page's own web documents — its HTML plus the external CSS and JS
 * it references — into a folder, with the HTML's references rewritten to
 * the saved copies so `index.html` opens standalone.
 *
 * Deliberately shallow: it follows `<link rel="stylesheet">` and
 * `<script src>` only. `@import`/`url()` inside a saved stylesheet, images,
 * and fonts keep pointing at their original URLs.
 */
export class PageDocumentExporter {
  /**
   * @param contents The tab's `webContents` — its session is used for the
   *   downloads, so cookies/auth match what the page itself loaded with.
   * @param directory Folder to write into; created if missing.
   * @returns Counts of what was saved and what couldn't be fetched.
   */
  public async export(contents: WebContents, directory: string): Promise<{ saved: number; failed: number }> {
    const found = (await contents.executeJavaScript(COLLECT_RESOURCES_SCRIPT)) as PageResource[];
    const unique = [...new Map(found.map((resource) => [resource.url, resource])).values()];

    await mkdir(join(directory, 'css'), { recursive: true });
    await mkdir(join(directory, 'js'), { recursive: true });

    // Maps absolute URL -> value to put in the HTML. A failed download maps
    // to itself, so the saved page still works online rather than pointing
    // at a file that doesn't exist.
    const rewrites: Record<string, string> = {};
    const usedNames = new Set<string>();
    let saved = 0;
    let failed = 0;

    for (const resource of unique) {
      rewrites[resource.url] = resource.url;
      const body = await this.download(contents, resource.url);
      if (body === null) {
        failed += 1;
        continue;
      }
      const relativePath = `${resource.kind}/${this.uniqueName(resource, usedNames)}`;
      await writeFile(join(directory, relativePath), body);
      rewrites[resource.url] = relativePath;
      saved += 1;
    }

    const html = (await contents.executeJavaScript(this.buildSerializeScript(rewrites))) as string;
    await writeFile(join(directory, 'index.html'), html, 'utf8');
    return { saved: saved + 1, failed };
  }

  /**
   * @returns The response bytes, or `null` for a non-http(s) URL (data:,
   *   blob:, extension schemes), a failed request, or an oversized file.
   */
  private async download(contents: WebContents, url: string): Promise<Buffer | null> {
    if (!/^https?:/i.test(url)) {
      return null;
    }
    try {
      const response = await contents.session.fetch(url);
      if (!response.ok) {
        return null;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.length <= MAX_RESOURCE_BYTES ? bytes : null;
    } catch {
      return null;
    }
  }

  /** Filename from the URL's path, stripped to safe characters, with a numeric suffix on collision (two CDNs both serving `main.js`). */
  private uniqueName(resource: PageResource, used: Set<string>): string {
    const extension = resource.kind === 'css' ? '.css' : '.js';
    let stem = 'file';
    try {
      stem = basename(new URL(resource.url).pathname).replace(/\.(css|m?js)$/i, '');
    } catch {
      // Keep the fallback — the URL already fetched fine, only naming failed.
    }
    stem = stem.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'file';

    let name = `${stem}${extension}`;
    for (let n = 2; used.has(`${resource.kind}/${name}`); n += 1) {
      name = `${stem}-${n}${extension}`;
    }
    used.add(`${resource.kind}/${name}`);
    return name;
  }

  /** In-page: serializes a clone of the live DOM with stylesheet/script references swapped per `rewrites` — a clone so the visible page is never touched. */
  private buildSerializeScript(rewrites: Record<string, string>): string {
    return `((rewrites) => {
  const root = document.documentElement.cloneNode(true);
  const swap = (selector, attribute) => {
    root.querySelectorAll(selector).forEach((el) => {
      const absolute = new URL(el.getAttribute(attribute), document.baseURI).href;
      if (absolute in rewrites) {
        el.setAttribute(attribute, rewrites[absolute]);
        // The saved copy is byte-identical, but file:// origins fail CORS/SRI checks.
        el.removeAttribute('integrity');
        el.removeAttribute('crossorigin');
      }
    });
  };
  swap('link[rel~="stylesheet"][href]', 'href');
  swap('script[src]', 'src');
  const doctype = document.doctype ? new XMLSerializer().serializeToString(document.doctype) : '<!DOCTYPE html>';
  return doctype + '\\n' + root.outerHTML;
})(${JSON.stringify(rewrites)})`;
  }
}
