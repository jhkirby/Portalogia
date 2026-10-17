// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createMarkdownEngine, escapeHtml } from '@shared/markdown/parser';

// Only the languages notes commonly hold: the full highlight.js bundle is several times the size for names nobody types.
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

/** Other names a fence is written with, for the languages registered above. */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  node: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  html: 'xml',
  svg: 'xml',
  yml: 'yaml',
  'c++': 'cpp',
  md: 'markdown',
};

/** Colors a code block as highlight.js would, or leaves it plain if its language isn't one of the registered few. */
function highlightCode(code: string, language: string): string {
  const name = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  if (name === '' || !hljs.getLanguage(name)) {
    return escapeHtml(code);
  }
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

const engine = createMarkdownEngine({ highlight: highlightCode });

// A note is untrusted text: raw HTML in it must not be able to run script or phone home. `FORBID_*` removes
// what the page never needs; the hook keeps `<input>` to the task-list checkboxes Markdown itself produces.
const PURIFY_CONFIG = {
  FORBID_TAGS: ['style', 'form', 'select', 'option', 'textarea', 'button', 'link', 'meta', 'base', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['srcset', 'formaction', 'action'],
  // KaTeX and the page's own `data-*` hooks are produced after sanitizing, from the sanitized markup's `data-*` attributes.
  ALLOW_DATA_ATTR: true,
};

DOMPurify.addHook('uponSanitizeElement', (node) => {
  if (node instanceof HTMLInputElement && node.type !== 'checkbox') {
    node.remove();
  }
});

/** Where a web picture's address is kept instead of `src`, until the user clicks to load it — see `collectRemoteImages`. */
export const REMOTE_SRC_ATTRIBUTE = 'data-md-remote-src';

// A web picture would load the moment the HTML is put on the page — telling its server the note was opened.
// Its address is set aside here, before the markup ever reaches a live document (the page's CSP blocks it anyway).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLImageElement) {
    const src = node.getAttribute('src') ?? '';
    if (/^https?:\/\//i.test(src)) {
      node.removeAttribute('src');
      node.setAttribute(REMOTE_SRC_ATTRIBUTE, src);
    }
  }
});

/**
 * A note as HTML that is safe to put on the page: Markdown (with wikilinks,
 * math placeholders, highlights and highlighted code blocks) parsed, then
 * sanitized. Math is left as placeholders carrying its TeX; the page typesets
 * them afterwards with KaTeX, which is trusted not to produce script.
 * @param source The note's source text.
 */
export function renderNote(source: string): string {
  return DOMPurify.sanitize(engine.render(source), PURIFY_CONFIG);
}
