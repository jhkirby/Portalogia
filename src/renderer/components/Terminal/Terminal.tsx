// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import type { IBufferRange, IDecoration } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_PREPARE_PRINT_GLOBAL } from '@shared/constants';
import type { RGB } from '@shared/color';
import { ACCENT_STORAGE_KEY } from '../../lib/accentStorage';
import { createTerminalFind } from './terminalFind';
import { TerminalStatusBar, type TerminalStats } from './TerminalStatusBar';
import { currentXtermTheme } from './xtermThemes';

/**
 * The terminal's text size at 100% zoom. Set so that 100% is the size the text
 * used to have at 160% (13px then, so about 21px now), which reads comfortably
 * next to the rest of the app; zooming scales from here like any other tab.
 */
const TERMINAL_FONT_SIZE = Math.round(13 * 1.6);

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

/** A finished highlight decoration's own blend strength — see `blendOverBackground`. */
const HIGHLIGHT_ALPHA = 0.45;
/** How much a highlight lightens on hover (`.terminal-highlight--hovered` in terminal.css) — reused for the drag-selection preview below, since both are "a lighter version of what this highlight would look like." */
const HOVER_OPACITY = 0.5;

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

/**
 * A light preview of `color`, shown as xterm's own native selection paint
 * while dragging to select — the same lightened look a finished highlight
 * gets on hover, live during the drag itself, instead of the theme's
 * ordinary neutral selection color or nothing at all. Unlike a decoration's
 * `backgroundColor`, `ITheme.selectionBackground` does accept `rgba()`
 * (xterm's own dark theme already uses one — see `xtermThemes.ts`), so this
 * doesn't need `blendOverBackground`'s opaque-hex workaround.
 */
function selectionPreviewColor(color: RGB): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${HIGHLIGHT_ALPHA * HOVER_OPACITY})`;
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

/** Whether two buffer ranges share any row/column position at all — checked before creating a new highlight so highlights can never nest or overlap, same rule `tabHighlighter.ts` enforces for a browser tab's `<mark>` elements. Compares `(y, x)` pairs as a single ordered position, since a buffer position is naturally ordered by row first, then column within it. */
function bufferRangesOverlap(a: IBufferRange, b: IBufferRange): boolean {
  const toKey = (pos: { readonly x: number; readonly y: number }): number => pos.y * 1_000_000 + pos.x;
  return toKey(a.start) <= toKey(b.end) && toKey(b.start) <= toKey(a.end);
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
  const [stats, setStats] = useState<TerminalStats>({ line: 1, words: 0, characters: 0, commands: 0, selection: null });
  /** The window's Focus Mode: the stat bar hides with the chrome. */
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => window.northstarTerminal.onFocusMode(setFocusMode), []);

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
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: 'Menlo, Consolas, "Cascadia Code", monospace',
      theme: currentXtermTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    term.focus();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fits the terminal to its area, whole rows only. The fit add-on divides the height by the cell's exact height,
    // but xterm draws each row at a whole-pixel height, slightly taller, so at some sizes it fitted a row too many
    // and the last one ran past the bottom, under the stat bar. So the rows as drawn are measured, and any that
    // don't wholly fit are dropped.
    const fitTerminal = (): void => {
      fitAddon.fit();
      const row = container.querySelector<HTMLElement>('.xterm-rows > div');
      const rowHeight = row?.getBoundingClientRect().height ?? 0;
      if (rowHeight <= 0) {
        return;
      }
      const style = getComputedStyle(container);
      const available = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const rows = Math.max(1, Math.floor(available / rowHeight));
      if (rows < term.rows) {
        term.resize(term.cols, rows);
      }
    };

    // ── Stat bar ──
    // Commands entered: Enter on a line where something was typed (an Enter on an empty prompt runs nothing). Counted
    // from the keys sent, so a pasted block of several lines counts each of them.
    let commands = 0;
    let lineHasInput = false;
    const countCommands = (data: string): void => {
      for (const character of data) {
        if (character === '\r') {
          if (lineHasInput) {
            commands += 1;
          }
          lineHasInput = false;
        } else if (character === '\u0003' || character === '\u0015') {
          // Ctrl+C abandons the line; Ctrl+U clears it.
          lineHasInput = false;
        } else if (character >= ' ' && character !== '\u007f') {
          lineHasInput = true;
        }
      }
    };
    // The shell's prompt isn't content: Git Bash's `user@host MINGW64 ~/path` line, and the `$ ` (or PowerShell's
    // `PS C:\path> `) a command is typed after. Left out of the on-screen counts; the command typed after it stays.
    const PROMPT_LINE = /^\S+@\S+ (?:MINGW64|MINGW32|MSYS|UCRT64|CLANG64|CLANGARM64)(?: .*)?$/;
    const PROMPT_MARK = /^(?:[$#] |[$#]$|PS [^>]*> ?)/;
    const withoutPrompt = (row: string): string => (PROMPT_LINE.test(row) ? '' : row.replace(PROMPT_MARK, ''));
    const measure = (text: string): { words: number; characters: number } => ({
      words: text.match(/\S+/g)?.length ?? 0,
      characters: text.replace(/\n/g, '').length,
    });
    // Recounted at most once a frame from whatever moved: output, scrolling, the cursor, the selection, the keys.
    let statsFrame = 0;
    const updateStats = (): void => {
      if (statsFrame) {
        return;
      }
      statsFrame = requestAnimationFrame(() => {
        statsFrame = 0;
        const buffer = term.buffer.active;
        const rows: string[] = [];
        for (let row = 0; row < term.rows; row += 1) {
          rows.push(withoutPrompt(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''));
        }
        const onScreen = measure(rows.join('\n'));
        const selected = term.getSelection();
        setStats({
          line: buffer.baseY + buffer.cursorY + 1,
          words: onScreen.words,
          characters: onScreen.characters,
          commands,
          selection: selected.trim() === '' ? null : measure(selected),
        });
      });
    };
    // Zoom sizes the terminal's text (Chromium's levels: each step is ×1.2), then refits its rows and columns; the
    // page around it, stat bar included, keeps its size.
    // The refit waits for xterm's next draw, which comes after it has measured the new font's cell size: a fit before
    // that still used the old size and left rows running past the bottom, under the stat bar. Fitted once more a
    // moment later in case that draw came before the measurement settled.
    const unsubscribeZoom = window.northstarTerminal.onZoom((level) => {
      // Whole pixels: a fractional size gives fractional rows, which xterm rounds up as it draws but not as it fits,
      // so over a screen of rows the text ran several pixels past the bottom.
      term.options.fontSize = Math.round(TERMINAL_FONT_SIZE * Math.pow(1.2, level));
      const afterDraw = term.onRender(() => {
        afterDraw.dispose();
        fitTerminal();
        window.setTimeout(fitTerminal, 50);
      });
      term.refresh(0, term.rows - 1);
    });

    const statsDisposables = [
      term.onRender(updateStats),
      term.onScroll(updateStats),
      term.onCursorMove(updateStats),
      term.onSelectionChange(updateStats),
    ];

    const dataDisposable = term.onData((data) => {
      countCommands(data);
      updateStats();
      window.northstarTerminal.sendTerminalInput(id, data);
    });
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

    // One `IDecoration` per row `range` spans (xterm's own API has no
    // multi-row decoration — see `TerminalHighlight`'s own doc comment),
    // each colored `colorHex`. Shared by `handleHighlighterMouseUp` (a fresh
    // highlight) and `repaintHighlights` (re-coloring an existing one) —
    // `IDecoration` has no way to change its own `backgroundColor` after
    // creation (`options` only exposes `overviewRulerOptions` as mutable),
    // so re-coloring means disposing the old decorations and creating new
    // ones at the same buffer positions instead.
    const createDecorationsForRange = (range: IBufferRange, colorHex: string): IDecoration[] => {
      const buffer = term.buffer.active;
      const cursorAbsoluteY = buffer.baseY + buffer.cursorY;
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
      return decorations;
    };

    const currentHighlightColorHex = (): string => {
      const backgroundHex = (term.options.theme?.background as string | undefined) ?? '#1e1e1e';
      return blendOverBackground(highlighterColor, backgroundHex, HIGHLIGHT_ALPHA);
    };

    /** Re-colors every existing highlight to the current accent — call whenever it changes, so a highlight's color is never frozen at the moment it was created, same as a browser tab's `<mark>` (`tabHighlighter.ts`'s `repaintAllHighlights`). */
    const repaintHighlights = (): void => {
      const colorHex = currentHighlightColorHex();
      for (const [id, highlight] of highlights) {
        if (highlight.colorHex === colorHex) {
          continue;
        }
        highlight.decorations.forEach((decoration) => decoration.dispose());
        const decorations = createDecorationsForRange(highlight.range, colorHex);
        decorations.forEach((decoration) => {
          decoration.onRender((el) => {
            el.classList.add('terminal-highlight');
            el.dataset['nshId'] = id;
            el.classList.toggle('terminal-highlight--hovered', id === hoveredHighlightId);
          });
        });
        highlights.set(id, { decorations, range: highlight.range, colorHex });
      }
    };

    const unsubscribeHighlighterState = window.northstarTerminal.onHighlighterState((active, color) => {
      highlighterActive = active;
      highlighterColor = color;
      container.classList.toggle('terminal__surface--highlighter-active', active);
      applyTheme();
      if (!active) {
        setHoveredHighlight(null);
      }
      repaintHighlights();
    });

    // The find bar's search of this terminal's buffer (see `terminalFind.ts`).
    const find = createTerminalFind(term, (result) => window.northstarTerminal.reportFind(result));
    const unsubscribeFind = window.northstarTerminal.onFind((command) => find.handle(command));

    const handleHighlighterMouseUp = (): void => {
      if (!highlighterActive || !term.hasSelection()) {
        return;
      }
      const range = term.getSelectionPosition();
      const text = term.getSelection();
      if (!range || !text.trim()) {
        return;
      }
      if (Array.from(highlights.values()).some((highlight) => bufferRangesOverlap(highlight.range, range))) {
        // Left as an ordinary native selection rather than cleared — same
        // silent rejection `tabHighlighter.ts` uses for a browser tab.
        return;
      }
      const colorHex = currentHighlightColorHex();
      const decorations = createDecorationsForRange(range, colorHex);
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

    // Clicking directly on an existing highlight removes it — the same
    // action as hovering it and pressing D/Delete, reachable without
    // leaving the mouse. Same idea as `tabHighlighter.ts`'s own click
    // handler; unlike that one, nothing else about a terminal's own click
    // behavior needs suppressing, so this only ever acts when the click
    // actually landed on a highlight.
    const handleHighlighterClick = (event: MouseEvent): void => {
      if (!highlighterActive) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const id = (target?.closest('.terminal-highlight') as HTMLElement | null)?.dataset['nshId'];
      if (id) {
        event.preventDefault();
        event.stopPropagation();
        removeHighlight(id);
      }
    };
    container.addEventListener('click', handleHighlighterClick);

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

    // Applies the current light/dark + accent theme, except while the
    // highlighter tool is on — same reasoning as `tabHighlighter.ts`'s own
    // `::selection` override: xterm's native selection paint would
    // otherwise compete with the highlighter's own decoration, showing a
    // highlight during the drag that then gets replaced by a different-
    // looking one on release. `onHighlighterState` below re-calls this on
    // every toggle so the override is applied/lifted immediately rather
    // than waiting for the theme or accent to also happen to change.
    const applyTheme = (): void => {
      const theme = currentXtermTheme();
      term.options.theme = highlighterActive
        ? { ...theme, selectionBackground: selectionPreviewColor(highlighterColor) }
        : theme;
    };

    // Toggling the chrome's theme (toolbar button or Ctrl+D) changes
    // `nativeTheme.themeSource`, which flips `prefers-color-scheme` here
    // too (see `currentXtermTheme`'s doc comment) — this keeps an
    // already-open terminal in step with that instead of only picking up
    // the theme it happened to be created under.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (): void => applyTheme();
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
        applyTheme();
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
    const resizeObserver = new ResizeObserver(fitTerminal);
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
      unsubscribeFind();
      find.dispose();
      container.removeEventListener('mouseup', handleHighlighterMouseUp);
      container.removeEventListener('click', handleHighlighterClick);
      document.removeEventListener('mousemove', handleHighlighterMouseMove);
      document.removeEventListener('keydown', handleHighlighterKeyDown, true);
      highlights.forEach((highlight) => highlight.decorations.forEach((decoration) => decoration.dispose()));
      highlights.clear();
      resizeObserver.disconnect();
      cancelAnimationFrame(statsFrame);
      unsubscribeZoom();
      statsDisposables.forEach((disposable) => disposable.dispose());
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
      {!focusMode && <TerminalStatusBar stats={stats} />}
    </div>
  );
}
