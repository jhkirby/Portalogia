// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-16

import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  readonly id: string;
  /** Whether this is the tab currently on screen — hidden (but still mounted) terminals keep their pty and scrollback alive underneath. */
  readonly isActive: boolean;
  /** Whether the shell process itself has already exited (e.g. the user typed `exit`). */
  readonly exited: boolean;
}

/**
 * One tab's real bash session: an `xterm.js` instance wired to the main
 * process's `node-pty`-backed shell over IPC. Kept mounted for as long as
 * its tab exists — `App` renders one of these per terminal tab and toggles
 * `isActive` rather than mounting/unmounting on tab switches, so scrollback
 * and the shell's own process both survive switching away and back, the
 * same way a browser tab's `WebContentsView` does.
 *
 * Unlike a browser tab, this renders directly in the chrome's own DOM
 * rather than a separate `WebContentsView` — see `TabManager.activateTab`
 * for why that's the right split for something this app itself owns.
 */
export function Terminal({ id, isActive, exited }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Create the xterm instance and wire it to this tab's pty exactly once —
  // never on `isActive`/`exited` changes, which would tear down a live
  // session just for switching tabs.
  useEffect(() => {
    console.log('[DEBUG] Terminal effect MOUNT', id);
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, "Cascadia Code", monospace',
      theme: { background: '#1e1e1e' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    term.write('\r\nSECOND_LINE_TEXT\r\n', () => {
      term.refresh(0, term.rows - 1);
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const dataDisposable = term.onData((data) => window.northstar.sendTerminalInput(id, data));
    const resizeDisposable = term.onResize(({ cols, rows }) => window.northstar.resizeTerminal(id, cols, rows));
    const unsubscribeData = window.northstar.onTerminalData((dataId, data) => {
      console.log('[DEBUG] renderer got terminal data', dataId, 'mine=', id, 'match=', dataId === id, data.length);
      if (dataId === id) {
        term.write(data);
      }
    });

    // Catches every layout change that could resize this terminal's own
    // container while it's visible (window resize, sidebar toggle, Focus
    // Mode) — a plain window 'resize' listener would miss the latter two,
    // neither of which resizes the window itself.
    const resizeObserver = new ResizeObserver(() => {
      console.log('[DEBUG] resizeObserver fired, offsetParent=', containerRef.current?.offsetParent, 'proposed=', JSON.stringify(fitAddon.proposeDimensions()));
      if (containerRef.current?.offsetParent !== null) {
        fitAddon.fit();
        console.log('[DEBUG] after fit, term.cols/rows=', term.cols, term.rows);
      }
    });
    resizeObserver.observe(container);

    return () => {
      console.log('[DEBUG] Terminal effect CLEANUP', id);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unsubscribeData();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once; see comment above.
  }, [id]);

  // Becoming the active tab can follow a resize that happened while this
  // terminal was `display: none` (and thus un-measurable), so re-fit before
  // focusing rather than trusting whatever size it last fit to.
  useEffect(() => {
    if (isActive) {
      fitAddonRef.current?.fit();
      termRef.current?.focus();
    }
  }, [isActive]);

  return (
    <div className={`terminal${isActive ? ' terminal--active' : ''}`}>
      <div ref={containerRef} className="terminal__surface" />
      {exited && (
        <div className="terminal__exited-banner" role="status">
          Process exited
        </div>
      )}
    </div>
  );
}
