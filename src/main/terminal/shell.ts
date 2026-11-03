// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-16

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';

/** A shell to spawn: its executable, the args that make it interactive, and where it should start. */
export interface ResolvedShell {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** Common install locations for Git for Windows' bash, checked in order. */
const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];

const WSL_PATH = 'C:\\Windows\\System32\\wsl.exe';

/**
 * Picks the shell a new terminal tab should run: real bash wherever one is
 * reachable, so the same "bash terminal" request behaves consistently
 * across a developer's machines rather than meaning something different on
 * each OS.
 *
 * macOS/Linux ship bash (or another POSIX shell via `$SHELL`) natively, so
 * that's just run directly. Windows has no native bash — prefer Git Bash
 * (ubiquitous on dev machines that have Git installed, lightweight, and
 * shares the rest of the app's Windows-path view of the filesystem) over
 * WSL (a real bash, but a separate Linux filesystem/path space that would
 * make "open a terminal here" mean something different from every other
 * path in the app). Falls back to PowerShell only if neither is present,
 * so the feature still works — just not as "bash" — on a bare Windows box.
 * @returns The shell to spawn, its startup args, and its starting directory.
 */
export function resolveDefaultShell(): ResolvedShell {
  const home = homedir();

  if (platform() === 'win32') {
    const gitBash = GIT_BASH_CANDIDATES.find((candidate) => existsSync(candidate));
    if (gitBash) {
      return { file: gitBash, args: ['--login', '-i'], cwd: home };
    }
    if (existsSync(WSL_PATH)) {
      // `cwd` here only sets the `wsl.exe` wrapper process's own working
      // directory, not the Linux shell's — that one starts at its own
      // (Linux-side) home regardless, since a Windows path can't address it.
      return { file: WSL_PATH, args: [], cwd: home };
    }
    return { file: process.env['COMSPEC'] ?? 'powershell.exe', args: [], cwd: home };
  }

  return { file: process.env['SHELL'] ?? '/bin/bash', args: ['-i', '-l'], cwd: home };
}
