// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { isRunnableName } from '@shared/markdown/runnable';
import {
  collectLocalImages,
  collectRemoteImages,
  collectWikiLinks,
  convertCallouts,
  decorateTags,
  enableTasks,
  findHeading,
  markExternalLinks,
  markMissingWikiLinks,
  numberHeadings,
  typesetMath,
  type OutlineEntry,
} from '../../lib/markdown/enhance';
import { REMOTE_SRC_ATTRIBUTE, renderNote } from '../../lib/markdown/renderNote';
import { UI_ATTRIBUTE } from '../../lib/markdown/textOffsets';
import { CodeBlockControls, CodeOutput, type RunState } from './CodeBlockControls';

/** Pictures already read for the current note, by what the note called them — typing a task checkbox shouldn't re-read every image. */
const imageCache = new Map<string, string>();

/** A code block of the rendered note and the two places drawn beside it: its buttons (inside it) and its output (after it). */
interface CodeHost {
  readonly index: number;
  readonly language: string;
  readonly code: string;
  readonly controls: HTMLElement;
  readonly output: HTMLElement;
}

interface MarkdownReaderProps {
  readonly source: string;
  /** Changes with each note opened, so cached pictures from the last one aren't reused. */
  readonly noteKey: string;
  /** The element that scrolls — its position is kept across a re-render. */
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  /** A heading to scroll to once the note is drawn (`[[Note#Heading]]`), or `''`. */
  readonly anchor: string;
  /** Whether a marking tool is on: links and checkboxes then belong to the tool, not to a click. */
  readonly toolActive: boolean;
  /** Called after each drawing with the note's headings. */
  readonly onRendered: (outline: readonly OutlineEntry[]) => void;
  /** A task checkbox was clicked: flip the `index`th one in the source. */
  readonly onToggleTask: (index: number) => void;
}

/**
 * Draws a note: Markdown to sanitized HTML, then the touches that need the
 * DOM — KaTeX for the math, ids for the headings, live task checkboxes,
 * callouts, tags, local pictures read through main, and dimmed links to notes
 * that don't exist yet. A click on a link goes where it names; Ctrl+click opens a note
 * in a new tab. Code blocks get Run and Copy buttons and show what they print.
 *
 * The HTML is set imperatively on one element rather than through React, so
 * a re-render can't undo the enhancements; React draws only the code-block
 * buttons and output, by portals into hosts this adds to the HTML.
 */
export function MarkdownReader({ source, noteKey, scrollRef, anchor, toolActive, onRendered, onToggleTask }: MarkdownReaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastNoteKeyRef = useRef(noteKey);
  const [hosts, setHosts] = useState<readonly CodeHost[]>([]);
  const [runs, setRuns] = useState<Readonly<Record<number, RunState>>>({});
  const html = useMemo(() => renderNote(source), [source]);

  // What a block printed belongs to the code as it was; editing the note makes it stale.
  useLayoutEffect(() => {
    setRuns({});
  }, [source]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }
    // The same note redrawn (a checkbox ticked) keeps its place; a different one starts at the top.
    const scrollTop = lastNoteKeyRef.current === noteKey ? (scrollRef.current?.scrollTop ?? 0) : 0;
    lastNoteKeyRef.current = noteKey;
    root.innerHTML = html;
    convertCallouts(root);
    typesetMath(root);
    const outline = numberHeadings(root);
    enableTasks(root);
    decorateTags(root);
    markExternalLinks(root);

    const nextHosts: CodeHost[] = [];
    root.querySelectorAll<HTMLElement>('pre.md-code').forEach((pre) => {
      const controls = document.createElement('div');
      controls.setAttribute(UI_ATTRIBUTE, '');
      pre.appendChild(controls);
      const output = document.createElement('div');
      output.setAttribute(UI_ATTRIBUTE, '');
      pre.after(output);
      nextHosts.push({
        index: Number(pre.dataset['codeIndex']),
        language: pre.dataset['lang'] ?? '',
        code: pre.querySelector('code')?.textContent ?? '',
        controls,
        output,
      });
    });
    setHosts(nextHosts);

    let current = true;
    for (const { image, src } of collectLocalImages(root)) {
      const key = `${noteKey}\n${src}`;
      const cached = imageCache.get(key);
      const show = (url: string | null): void => {
        if (!current || !image.isConnected) {
          return;
        }
        image.classList.remove('md-image--loading');
        if (url) {
          image.src = url;
        } else {
          image.classList.add('md-image--broken');
        }
      };
      if (cached !== undefined) {
        show(cached);
      } else {
        void window.northstarMarkdown.readImage(src).then((url) => {
          if (url) {
            imageCache.set(key, url);
          }
          show(url);
        });
      }
    }
    // Web pictures wait for a click (see `loadRemoteImage`), except ones already loaded for this note.
    for (const { image, url } of collectRemoteImages(root)) {
      const cached = imageCache.get(remoteImageKey(noteKey, url));
      if (cached !== undefined) {
        showRemoteImage(image, cached);
      }
    }
    const names = collectWikiLinks(root);
    if (names.length > 0) {
      void window.northstarMarkdown.resolveLinks(names).then((resolved) => {
        if (current && root.isConnected) {
          markMissingWikiLinks(root, resolved);
        }
      });
    }

    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollTop;
    }
    onRendered(outline);
    return () => {
      current = false;
    };
    // `onRendered` and `scrollRef` are stable by contract; re-drawing the note when they change would cost a full re-render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, noteKey]);

  // A link into a heading of this note scrolls there once it's drawn.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (anchor === '' || !root) {
      return;
    }
    findHeading(root, anchor)?.scrollIntoView({ block: 'start' });
  }, [anchor, html]);

  const run = useCallback((index: number) => {
    setRuns((previous) => ({ ...previous, [index]: { status: 'running' } }));
    void window.northstarMarkdown.runCode(index).then((result) => {
      setRuns((previous) => ({ ...previous, [index]: { status: 'done', result } }));
    });
  }, []);

  const clearRun = useCallback((index: number) => {
    setRuns((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => Number(key) !== index)));
  }, []);

  /** Fetches a web picture the user clicked, through main — the page itself loads nothing from the web. */
  const loadRemoteImage = (image: HTMLImageElement): void => {
    const url = image.getAttribute(REMOTE_SRC_ATTRIBUTE) ?? '';
    image.classList.add('md-image--loading');
    void window.northstarMarkdown.readRemoteImage(url).then((dataUrl) => {
      if (!image.isConnected) {
        return;
      }
      image.classList.remove('md-image--loading');
      if (dataUrl) {
        imageCache.set(remoteImageKey(noteKey, url), dataUrl);
        showRemoteImage(image, dataUrl);
      } else {
        image.classList.add('md-image--broken');
      }
    });
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target : null;
    const remoteImage = target?.closest<HTMLImageElement>('img.md-image--remote');
    if (remoteImage) {
      event.preventDefault();
      if (!toolActive) {
        loadRemoteImage(remoteImage);
      }
      return;
    }
    const task = target?.closest<HTMLInputElement>('input.md-task');
    if (task) {
      // The re-render from the changed source redraws the box, so the click's own toggle is cancelled.
      event.preventDefault();
      if (!toolActive) {
        onToggleTask(Number(task.dataset['taskIndex']));
      }
      return;
    }
    const link = target?.closest<HTMLAnchorElement>('a');
    if (!link || !rootRef.current?.contains(link)) {
      return;
    }
    event.preventDefault();
    if (toolActive) {
      return;
    }
    const inNewTab = event.ctrlKey || event.metaKey;
    const wiki = link.dataset['wikilink'];
    if (wiki !== undefined) {
      // `[[#Heading]]` and a link to this very note's own heading stay on the page.
      if (wiki.startsWith('#') && rootRef.current) {
        findHeading(rootRef.current, wiki.slice(1))?.scrollIntoView({ block: 'start' });
        return;
      }
      void window.northstarMarkdown.openLink('wiki', wiki, inNewTab);
      return;
    }
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      if (rootRef.current) {
        findHeading(rootRef.current, decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
      }
    } else if (href !== '') {
      void window.northstarMarkdown.openLink('link', href, inNewTab);
    }
  };

  return (
    <>
      {/* The rendered HTML is sanitized (see `renderNote`) and written by the layout effect above. */}
      <div ref={rootRef} className="md-reader" onClick={handleClick} />
      {hosts.map((host) => (
        <CodeHostPortals key={`${host.index}-${host.code.length}`} host={host} state={runs[host.index]} onRun={run} onClear={() => clearRun(host.index)} />
      ))}
    </>
  );
}

/** `imageCache`'s key for a web picture — kept apart from a local picture that happens to have the same name. */
function remoteImageKey(noteKey: string, url: string): string {
  return `${noteKey}\nremote:${url}`;
}

/** Shows a loaded web picture in place of its click-to-load stand-in. */
function showRemoteImage(image: HTMLImageElement, dataUrl: string): void {
  image.classList.remove('md-image--remote', 'md-image--broken');
  image.removeAttribute('title');
  image.src = dataUrl;
}

interface CodeHostPortalsProps {
  readonly host: CodeHost;
  readonly state: RunState | undefined;
  readonly onRun: (index: number) => void;
  readonly onClear: () => void;
}

/** Draws one code block's buttons and output into the hosts the reader put beside it. */
function CodeHostPortals({ host, state, onRun, onClear }: CodeHostPortalsProps) {
  return (
    <>
      {createPortal(
        <CodeBlockControls
          language={host.language}
          code={host.code}
          runnable={isRunnableName(host.language)}
          running={state?.status === 'running'}
          onRun={() => onRun(host.index)}
        />,
        host.controls,
      )}
      {state && createPortal(<CodeOutput state={state} onClear={onClear} />, host.output)}
    </>
  );
}
