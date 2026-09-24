// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-24

import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { currentXtermTheme, XTERM_DARK_THEME, XTERM_LIGHT_THEME } from './xtermThemes';

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
 */
export function Terminal({ id }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

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

    // Toggling the chrome's theme (toolbar button or Ctrl+D) changes
    // `nativeTheme.themeSource`, which flips `prefers-color-scheme` here
    // too (see `currentXtermTheme`'s doc comment) — this keeps an
    // already-open terminal in step with that instead of only picking up
    // the theme it happened to be created under.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (event: MediaQueryListEvent): void => {
      term.options.theme = event.matches ? XTERM_DARK_THEME : XTERM_LIGHT_THEME;
    };
    media.addEventListener('change', handleThemeChange);

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

    return () => {
      window.IntersectionObserver = RealIntersectionObserver;
      media.removeEventListener('change', handleThemeChange);
      window.removeEventListener('focus', handleWindowFocus);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unsubscribeData();
      unsubscribeExited();
      resizeObserver.disconnect();
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
    </div>
  );
}
