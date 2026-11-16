// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-16

import * as pty from 'node-pty';
import { resolveDefaultShell } from './shell';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Owns one real `node-pty` process per terminal tab — the main-process half
 * of a terminal tab. `TabManager` separately owns that tab's own
 * `WebContentsView` (`terminal.html`, see `createTerminalTab`), which
 * reaches this class purely over IPC (`registerTabIpc`) for input, resize,
 * and output.
 */
export class TerminalManager {
  private readonly sessions = new Map<string, pty.IPty>();

  /**
   * @param onData Called with every chunk of output a tab's shell produces,
   *   for forwarding to that tab's xterm instance over IPC.
   * @param onExit Called once when a tab's shell process itself exits (e.g.
   *   the user typed `exit`) — distinct from the tab being closed, which
   *   goes the other direction via `dispose`.
   */
  public constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string) => void,
  ) {}

  /** Spawns a new shell for tab `id`, using the platform's resolved default shell. */
  public create(id: string): void {
    const shell = resolveDefaultShell();
    const session = pty.spawn(shell.file, [...shell.args], {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: shell.cwd,
      env: process.env as Record<string, string>,
    });

    session.onData((data) => this.onData(id, data));
    session.onExit(() => {
      this.sessions.delete(id);
      this.onExit(id);
    });

    this.sessions.set(id, session);
  }

  /** Forwards keystroke/paste bytes from xterm.js to tab `id`'s shell. A no-op if that tab's shell has already exited. */
  public write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  /** Resizes tab `id`'s pty to match its xterm instance's current grid. A no-op if that tab's shell has already exited. */
  public resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  /** Kills tab `id`'s shell process, e.g. because the tab itself was closed. A no-op if it already exited on its own. */
  public dispose(id: string): void {
    this.sessions.get(id)?.kill();
    this.sessions.delete(id);
  }

  /** Kills every remaining shell process — call this when the owning window closes. */
  public disposeAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.dispose(id);
    }
  }
}
