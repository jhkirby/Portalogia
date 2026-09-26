// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import type { IBufferRange, IDecoration } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_PREPARE_PRINT_GLOBAL } from '@shared/constants';
import type { RGB } from '@shared/color';
import { ACCENT_STORAGE_KEY } from '../../lib/accentStorage';
import { currentXtermTheme } from './xtermThemes';

/** One highlighted selection in a terminal's buffer — one `IDecoration` per row it spans (xterm's own API has no multi-row decoration), plus the original buffer range and the exact color used, both needed to correctly re-wrap the matching text in `<mark>` when preparing to print (see `TERMINAL_PREPARE_PRINT_GLOBAL` below). */
interface TerminalHighlight {
  readonly decorations: readonly IDecoration[];
  readonly range: IBufferRange;
  readonly colorHex: string;
}

function hexToRgb(hex: string): RGB {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  };
}

function channelHex(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');
}

/**
 * Blends `color` over `backgroundHex` at `alpha` into a single opaque hex —
 * xterm's `registerDecoration` only accepts `#RRGGBB`, not `rgba()` (unlike
 * the translucent tint a web tab's `<mark>` gets), so this is what stands in
 * for a "50% highlighter" look here: a solid color partway between the
 * terminal's own background and the full accent color.
 */
function blendOverBackground(color: RGB, backgroundHex: string, alpha: number): string {
  const bg = hexToRgb(backgroundHex);
  return `#${channelHex(color.r * alpha + bg.r * (1 - alpha))}${channelHex(color.g * alpha + bg.g * (1 - alpha))}${channelHex(color.b * alpha + bg.b * (1 - alpha))}`;
}

/** The column range (0-based, end-exclusive) a highlight's buffer range covers on one specific absolute row, or `null` if that row isn't part of it. */
function highlightColumnsForLine(
  range: IBufferRange,
  lineIndex0: number,
  cols: number,
): { readonly start: number; readonly end: number } | null {
  const startY0 = range.start.y - 1;
  const endY0 = range.end.y - 1;
  if (lineIndex0 < startY0 || lineIndex0 > endY0) {
    return null;
  }
  return {
    start: lineIndex0 === startY0 ? range.start.x - 1 : 0,
    end: lineIndex0 === endY0 ? range.end.x - 1 : cols,
  };
}

/** Appends one print-view line's worth of content to `container`, wrapping whichever column ranges are highlighted in `<mark>` — built from DOM nodes rather than an HTML string, so the terminal's own (arbitrary) text content never needs escaping. */
function appendPrintLine(
  container: Node,
  lineText: string,
  ranges: ReadonlyArray<{ readonly start: number; readonly end: number; readonly colorHex: string }>,
): void {
  if (ranges.length === 0) {
    container.appendChild(document.createTextNode(lineText));
    return;
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const { start: rawStart, end: rawEnd, colorHex } of sorted) {
    const start = Math.max(cursor, Math.min(rawStart, lineText.length));
    const end = Math.max(start, Math.min(rawEnd, lineText.length));
    if (start > cursor) {
      container.appendChild(document.createTextNode(lineText.slice(cursor, start)));
    }
    if (end > start) {
      const mark = document.createElement('mark');
      mark.style.backgroundColor = colorHex;
      mark.textContent = lineText.slice(start, end);
      container.appendChild(mark);
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < lineText.length) {
    container.appendChild(document.createTextNode(lineText.slice(cursor)));
  }
}

interface TerminalProps {
  readonly id: string;
}

/**
 * A no-op stand-in for the real `IntersectionObserver`. xterm.js's own
 * `RenderService` creates one of these to track whether its element is
 * actually on screen, and pauses its render scheduling — permanently, with
 * no public API to un-stick it — the moment that observer reports (even
 * momentarily or incorrectly) that it isn't. Standing in for the observer
 * for as long as this `XTerm` instance exists (see the
 * `window.IntersectionObserver` swap around `new XTerm()`/`term.open()`
 * below, restored on unmount) means that pause condition can never trigger.
 * This view is its own dedicated `WebContentsView` (see `TabManager`), so
 * it no longer gets hidden/shown via CSS the way the old chrome-hosted
 * version did — but Electron detaching/reattaching that view from the
 * window still risks the same underlying occlusion signal, so this stays
 * as cheap insurance.
 */
class NoopIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/**
 * One tab's real bash session: an `xterm.js` instance wired to the main
 * process's `node-pty`-backed shell over IPC. Fills its own dedicated
 * `WebContentsView` (`terminal.html`, one per terminal tab) — see
 * `TabManager.createTerminalTab` for why that's the right split (the same
 * native-focus and mount/unmount handling every browser tab already gets
 * for free, instead of re-implementing it for a chrome-hosted DOM node).
 * That view is only ever mounted into the window while its tab is the
 * active one, but Electron keeps its process (and this pty) alive
 * regardless, so switching away and back preserves scrollback exactly like
 * a background browser tab preserves its page state.
 *
 * Also renders the highlighter tool's terminal-side half (see
 * `HighlighterController` for the browser-tab half): releasing a selection
 * while the tool is active wraps it in an xterm decoration instead of a real
 * `<mark>` (there's no DOM text to wrap — xterm paints its own canvas), and
 * hovering one with 'd'/Delete removes it. Deliberately much simpler than
 * the browser-tab path: no undo/redo (Ctrl+Z suspends a Unix shell's
 * foreground process — a binding this app must never shadow, same reasoning
 * `TabManager.wireSharedInputHandling` already documents for every other
 * shortcut on a terminal tab) and no persistence (a pty has no stable
 * content to re-anchor a highlight against after a restart, and no
 * meaningful "reload" the way a page does), so a terminal's highlights are
 * purely in-memory and scoped to this component's own lifetime.
 */
export function Terminal({ id }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const printViewRef = useRef<HTMLPreElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Highlighter tool state (see this component's own doc comment) — plain
    // closure-local variables rather than `useRef`s, since this effect runs
    // exactly once per `id` and every reader/writer below is itself defined
    // inside this same closure; nothing outside it (render included) ever
    // needs to see these.
    let highlighterActive = false;
    let highlighterColor: RGB = { r: 26, g: 115, b: 232 };
    let hoveredHighlightId: string | null = null;
    const highlights = new Map<string, TerminalHighlight>();

    // See `NoopIntersectionObserver`'s own doc comment.
    const RealIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = NoopIntersectionObserver;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, "Cascadia Code", monospace',
      theme: currentXtermTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    term.focus();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const dataDisposable = term.onData((data) => window.northstarTerminal.sendTerminalInput(id, data));
    const resizeDisposable = term.onResize(({ cols, rows }) => window.northstarTerminal.resizeTerminal(id, cols, rows));
    const unsubscribeData = window.northstarTerminal.onTerminalData((dataId, data) => {
      if (dataId === id) {
        // Cheap belt-and-suspenders alongside the `IntersectionObserver`
        // stand-in above: forces the just-written rows to actually paint
        // rather than trusting xterm's own scheduling to complete on its
        // own, in case anything else ever manages to pause it.
        term.write(data, () => term.refresh(0, term.rows - 1));
      }
    });
    const unsubscribeExited = window.northstarTerminal.onTerminalExited((exitedId) => {
      if (exitedId === id) {
        setExited(true);
      }
    });

    // ── Highlighter tool (see this component's own doc comment) ────────
    const removeHighlight = (highlightId: string): void => {
      const highlight = highlights.get(highlightId);
      if (!highlight) {
        return;
      }
      highlight.decorations.forEach((decoration) => decoration.dispose());
      highlights.delete(highlightId);
      if (hoveredHighlightId === highlightId) {
        hoveredHighlightId = null;
      }
    };

    // Lightens every decoration element sharing `id` (or clears it, for
    // `null`) — the visual cue that hovering it, then pressing D/Delete,
    // would remove it. Same technique `tabHighlighter.ts` uses for a
    // browser tab's `<mark>` elements; a highlight here can likewise be
    // several decorations (one per row it spans — see `handleHighlighterMouseUp`).
    const setHoveredHighlight = (id: string | null): void => {
      if (id === hoveredHighlightId) {
        return;
      }
      if (hoveredHighlightId) {
        document
          .querySelectorAll(`.terminal-highlight[data-nsh-id="${CSS.escape(hoveredHighlightId)}"]`)
          .forEach((el) => el.classList.remove('terminal-highlight--hovered'));
      }
      hoveredHighlightId = id;
      if (hoveredHighlightId) {
        document
          .querySelectorAll(`.terminal-highlight[data-nsh-id="${CSS.escape(hoveredHighlightId)}"]`)
          .forEach((el) => el.classList.add('terminal-highlight--hovered'));
      }
    };

    const unsubscribeHighlighterState = window.northstarTerminal.onHighlighterState((active, color) => {
      highlighterActive = active;
      highlighterColor = color;
      container.classList.toggle('terminal__surface--highlighter-active', active);
      if (!active) {
        setHoveredHighlight(null);
      }
    });

    const handleHighlighterMouseUp = (): void => {
      if (!highlighterActive || !term.hasSelection()) {
        return;
      }
      const range = term.getSelectionPosition();
      const text = term.getSelection();
      if (!range || !text.trim()) {
        return;
      }
      const buffer = term.buffer.active;
      const cursorAbsoluteY = buffer.baseY + buffer.cursorY;
      const backgroundHex = (term.options.theme?.background as string | undefined) ?? '#1e1e1e';
      const colorHex = blendOverBackground(highlighterColor, backgroundHex, 0.45);
      const decorations: IDecoration[] = [];
      for (let y = range.start.y; y <= range.end.y; y++) {
        const rowIndex0 = y - 1;
        const columns = highlightColumnsForLine(range, rowIndex0, term.cols);
        const marker = columns ? term.registerMarker(rowIndex0 - cursorAbsoluteY) : undefined;
        if (!columns || !marker) {
          continue;
        }
        const decoration = term.registerDecoration({
          marker,
          x: columns.start,
          width: Math.max(1, columns.end - columns.start),
          backgroundColor: colorHex,
        });
        if (decoration) {
          decorations.push(decoration);
        } else {
          marker.dispose();
        }
      }
      if (decorations.length === 0) {
        return;
      }
      const highlightId = crypto.randomUUID();
      decorations.forEach((decoration) => {
        decoration.onRender((el) => {
          el.classList.add('terminal-highlight');
          el.dataset['nshId'] = highlightId;
        });
      });
      highlights.set(highlightId, { decorations, range, colorHex });
      term.clearSelection();
    };
    container.addEventListener('mouseup', handleHighlighterMouseUp);

    const handleHighlighterMouseMove = (event: MouseEvent): void => {
      if (!highlighterActive) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const mark = target?.closest('.terminal-highlight');
      setHoveredHighlight((mark as HTMLElement | null)?.dataset['nshId'] ?? null);
    };
    document.addEventListener('mousemove', handleHighlighterMouseMove);

    // Capture phase, same reasoning as `tabHighlighter.ts`'s own keydown
    // listener: this has to win the race against xterm's own keydown
    // handling on its hidden input, which only ever runs in the bubble
    // phase on a descendant of `container`.
    const handleHighlighterKeyDown = (event: KeyboardEvent): void => {
      if (!highlighterActive || !hoveredHighlightId) {
        return;
      }
      if (event.key === 'd' || event.key === 'D' || event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        removeHighlight(hoveredHighlightId);
      }
    };
    document.addEventListener('keydown', handleHighlighterKeyDown, true);

    // Toggling the chrome's theme (toolbar button or Ctrl+D) changes
    // `nativeTheme.themeSource`, which flips `prefers-color-scheme` here
    // too (see `currentXtermTheme`'s doc comment) — this keeps an
    // already-open terminal in step with that instead of only picking up
    // the theme it happened to be created under.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (): void => {
      term.options.theme = currentXtermTheme();
    };
    media.addEventListener('change', handleThemeChange);

    // Same idea, for `ColorPicker`'s own accent instead of light/dark —
    // `currentXtermTheme` already recomputes the light theme's
    // `selectionBackground` from whatever's in storage, so re-calling it
    // here (rather than only ever at `new XTerm()` above) is what keeps an
    // already-open terminal's selection highlight in step with a color
    // picked after it was created, the same live-update `watchAccentColor`
    // gives every other page.
    const handleAccentChange = (event: StorageEvent): void => {
      if (event.key === ACCENT_STORAGE_KEY) {
        term.options.theme = currentXtermTheme();
      }
    };
    window.addEventListener('storage', handleAccentChange);

    // This page's own top-level `focus` fires when its `WebContentsView`
    // regains native OS focus — e.g. `TabManager.activateTab` switching
    // back to this tab after another was active. A plain DOM `.focus()`
    // call on the hidden textarea isn't enough on its own for keystrokes to
    // actually land here; this is what makes them.
    const handleWindowFocus = (): void => term.focus();
    window.addEventListener('focus', handleWindowFocus);

    // Catches every layout change that could resize this view (window
    // resize, sidebar toggle, Focus Mode) — the container fills the whole
    // page, so this is equivalent to a window 'resize' listener but also
    // catches the DPI/zoom-driven resizes that don't fire one.
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(container);

    // Fills `.terminal__print-view` (see terminal.css's `@media print`
    // rule) with every row `term`'s buffer currently holds — scrollback
    // plus the visible viewport, in on-screen order — right before
    // `TabManager.exportToPdf` calls `printToPDF()`. This, not the live
    // canvas, is what actually ends up in the PDF: xterm only ever paints
    // the rows that fit its own fixed-size viewport, so printing the
    // canvas directly could show nothing but whatever page of scrollback
    // happened to be scrolled to. A row that's scrolled fully off used to
    // stop existing in the buffer at all once `clear()`'s "erase
    // scrollback" sequence ran — so this naturally never reaches further
    // back than the terminal's last clear, without needing to track that
    // separately.
    //
    // A plain `window` global, not a proper `NorthstarTerminalApi` IPC
    // channel, is the right tool for main to reach this: `executeJavaScript`
    // (what `exportToPdf` actually calls) runs in this page's own main
    // world regardless of `contextIsolation`/`sandbox`, so main can call
    // straight into it without a round trip through a preload bridge and an
    // `ipcMain`/`ipcRenderer` reply pair neither side otherwise needs.
    // Rebuilt from DOM nodes (`document.createTextNode`/`createElement`)
    // rather than a joined string assigned to `textContent`/`innerHTML` —
    // this is what lets a highlighted range be wrapped in a real `<mark>`
    // (matching color included) without ever needing to HTML-escape the
    // terminal's own, arbitrary text content.
    (window as unknown as Record<string, () => void>)[TERMINAL_PREPARE_PRINT_GLOBAL] = () => {
      const printView = printViewRef.current;
      if (!printView) {
        return;
      }
      const buffer = term.buffer.active;
      const activeHighlights = Array.from(highlights.values());
      printView.replaceChildren();
      for (let i = 0; i < buffer.length; i++) {
        const lineText = buffer.getLine(i)?.translateToString(true) ?? '';
        const ranges = activeHighlights
          .map((highlight) => {
            const columns = highlightColumnsForLine(highlight.range, i, term.cols);
            return columns ? { ...columns, colorHex: highlight.colorHex } : null;
          })
          .filter((value): value is { start: number; end: number; colorHex: string } => value !== null);
        appendPrintLine(printView, lineText, ranges);
        if (i < buffer.length - 1) {
          printView.appendChild(document.createTextNode('\n'));
        }
      }
    };

    return () => {
      window.IntersectionObserver = RealIntersectionObserver;
      media.removeEventListener('change', handleThemeChange);
      window.removeEventListener('storage', handleAccentChange);
      window.removeEventListener('focus', handleWindowFocus);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unsubscribeData();
      unsubscribeExited();
      unsubscribeHighlighterState();
      container.removeEventListener('mouseup', handleHighlighterMouseUp);
      document.removeEventListener('mousemove', handleHighlighterMouseMove);
      document.removeEventListener('keydown', handleHighlighterKeyDown, true);
      highlights.forEach((highlight) => highlight.decorations.forEach((decoration) => decoration.dispose()));
      highlights.clear();
      resizeObserver.disconnect();
      delete (window as unknown as Record<string, unknown>)[TERMINAL_PREPARE_PRINT_GLOBAL];
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once; `id` is this page's own, fixed at load.
  }, [id]);

  return (
    <div className="terminal">
      <div ref={containerRef} className="terminal__surface" />
      {exited && (
        <div className="terminal__exited-banner" role="status">
          Process exited
        </div>
      )}
      {/* Hidden on screen; only shown (and filled — see the `PREPARE_PRINT_GLOBAL`
          effect above) for `printToPDF()`'s own `print` media pass. See
          terminal.css's `@media print` rule for the swap. */}
      <pre ref={printViewRef} className="terminal__print-view" />
    </div>
  );
}
