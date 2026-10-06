// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MarkdownRunResult } from '@shared/ipc-contract';

/** How long a block may run before it is stopped. */
const RUN_TIMEOUT_MS = 30_000;

/** The most output of each stream kept; the rest is dropped (and the result says so). */
const MAX_OUTPUT_CHARS = 200_000;

/** One way of starting a language's program on a script file; the first that exists on this machine is used. */
interface Launcher {
  readonly command: string;
  readonly args: (file: string) => readonly string[];
  /** Extra environment for the process, over this app's own. */
  readonly env?: Readonly<Record<string, string>>;
}

/** A language a code block can be run in. */
interface Language {
  /** The names a fence may use for it (`python`, `py`, …), lower-case. */
  readonly names: readonly string[];
  /** What to call the script file's extension; may depend on the code (JavaScript modules vs scripts). */
  readonly extension: (code: string) => string;
  readonly launchers: readonly Launcher[];
  /** The script's text as written to disk — PowerShell 5.1 needs a byte-order mark to read UTF-8. */
  readonly prepare?: (code: string) => string;
}

const IS_WINDOWS = process.platform === 'win32';

/** Git for Windows' own bash, preferred over the `bash` on the path, which on Windows is often WSL (it can't see Windows paths). */
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

const shellLaunchers = (name: 'bash' | 'sh'): readonly Launcher[] =>
  IS_WINDOWS
    ? [
        ...(existsSync(GIT_BASH) ? [{ command: GIT_BASH, args: (file: string) => [file] }] : []),
        { command: name, args: (file) => [file] },
      ]
    : [{ command: name, args: (file) => [file] }];

/** The languages that can be run. Interpreters are the ones already on the machine; nothing is downloaded or installed. */
const LANGUAGES: readonly Language[] = [
  {
    names: ['js', 'javascript', 'node', 'mjs', 'cjs'],
    // `import`/`export` need a module; everything else runs as a CommonJS script, so `require` works.
    extension: (code) => (/^\s*(?:import\s|export\s)/m.test(code) ? '.mjs' : '.cjs'),
    // This app's own Electron binary running as plain Node — so JavaScript runs even where Node isn't installed.
    launchers: [{ command: process.execPath, args: (file) => [file], env: { ELECTRON_RUN_AS_NODE: '1' } }],
  },
  {
    names: ['python', 'py', 'python3'],
    extension: () => '.py',
    launchers: IS_WINDOWS
      ? [
          { command: 'python', args: (file) => ['-u', file] },
          { command: 'py', args: (file) => ['-3', '-u', file] },
        ]
      : [
          { command: 'python3', args: (file) => ['-u', file] },
          { command: 'python', args: (file) => ['-u', file] },
        ],
  },
  { names: ['bash', 'shell', 'zsh'], extension: () => '.sh', launchers: shellLaunchers('bash') },
  { names: ['sh'], extension: () => '.sh', launchers: shellLaunchers('sh') },
  {
    names: ['powershell', 'pwsh', 'ps1'],
    extension: () => '.ps1',
    launchers: [
      ...(IS_WINDOWS
        ? [
            {
              command: 'powershell.exe',
              args: (file: string) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
            },
          ]
        : []),
      { command: 'pwsh', args: (file) => ['-NoProfile', '-NonInteractive', '-File', file] },
    ],
    prepare: (code) => `\ufeff${code}`,
  },
  {
    names: ['cmd', 'bat', 'batch'],
    extension: () => '.bat',
    launchers: IS_WINDOWS ? [{ command: 'cmd.exe', args: (file) => ['/d', '/c', file] }] : [],
  },
  { names: ['ruby', 'rb'], extension: () => '.rb', launchers: [{ command: 'ruby', args: (file) => [file] }] },
  { names: ['perl', 'pl'], extension: () => '.pl', launchers: [{ command: 'perl', args: (file) => [file] }] },
  { names: ['php'], extension: () => '.php', launchers: [{ command: 'php', args: (file) => [file] }] },
  { names: ['lua'], extension: () => '.lua', launchers: [{ command: 'lua', args: (file) => [file] }] },
  { names: ['go', 'golang'], extension: () => '.go', launchers: [{ command: 'go', args: (file) => ['run', file] }] },
];

/** @returns Every name a fence may use for a runnable language — what `RUNNABLE_LANGUAGE_NAMES` (shared with the page) must list. */
export function allRunnableNames(): string[] {
  return LANGUAGES.flatMap((language) => [...language.names]);
}

/** @returns The names code blocks can be run under, for telling a person what is supported. */
export function runnableLanguageNames(): string[] {
  return LANGUAGES.map((language) => language.names[0] as string);
}

/** @returns Whether a fence's language word names one that can be run. */
export function isRunnableLanguage(name: string): boolean {
  return findLanguage(name) !== undefined;
}

function findLanguage(name: string): Language | undefined {
  const wanted = name.trim().toLowerCase();
  return LANGUAGES.find((language) => language.names.includes(wanted));
}

/** The result for a run that never started. */
function notRun(error: string): MarkdownRunResult {
  return { ran: false, error, stdout: '', stderr: '', exitCode: null, timedOut: false, truncated: false, durationMs: 0 };
}

/** Stops a process and everything it started — a script's own children would otherwise outlive a timeout. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  if (IS_WINDOWS) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * Starts one launcher on a script and collects what it prints.
 * @returns The result, or `'missing'` if the program isn't installed (so the next launcher can be tried).
 */
function runLauncher(
  launcher: Launcher,
  file: string,
  cwd: string,
  timeoutMs: number,
): Promise<MarkdownRunResult | 'missing'> {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(launcher.command, [...launcher.args(file)], {
      cwd,
      env: { ...process.env, ...launcher.env },
      windowsHide: true,
      // Nothing is typed to a block: a script that reads input gets the end of it at once instead of hanging.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const settle = (result: MarkdownRunResult | 'missing'): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolveRun(result);
      }
    };
    const take = (current: string, chunk: Buffer): string => {
      const room = MAX_OUTPUT_CHARS - current.length;
      if (room <= 0) {
        truncated = true;
        return current;
      }
      const text = chunk.toString('utf-8');
      if (text.length > room) {
        truncated = true;
        return current + text.slice(0, room);
      }
      return current + text;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = take(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = take(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on('error', (error: NodeJS.ErrnoException) => {
      settle(error.code === 'ENOENT' ? 'missing' : notRun(`Could not start ${launcher.command}: ${error.message}`));
    });
    child.on('close', (exitCode) => {
      settle({
        ran: true,
        error: null,
        stdout,
        stderr,
        exitCode,
        timedOut,
        truncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

/**
 * Runs a code block in its language's interpreter on this machine, with the
 * note's folder as the working directory, and returns what it printed. Stops
 * it after `RUN_TIMEOUT_MS` and keeps at most `MAX_OUTPUT_CHARS` of each stream.
 * The code runs with the user's own permissions — callers get consent first.
 * @param languageName The word after the block's opening fence.
 * @param code The block's source.
 * @param cwd The folder to run in.
 * @param timeoutMs Override of the time limit, for tests.
 */
export async function runCodeBlock(
  languageName: string,
  code: string,
  cwd: string,
  timeoutMs: number = RUN_TIMEOUT_MS,
): Promise<MarkdownRunResult> {
  const language = findLanguage(languageName);
  if (!language) {
    const shown = languageName.trim() === '' ? 'This block has no language, so it' : `"${languageName}" code`;
    return notRun(`${shown} can't be run. Runnable languages: ${runnableLanguageNames().join(', ')}.`);
  }
  if (language.launchers.length === 0) {
    return notRun(`${language.names[0]} code can't be run on this system.`);
  }
  const directory = join(tmpdir(), `northstar-run-${randomUUID()}`);
  try {
    await mkdir(directory, { recursive: true });
    const file = join(directory, `snippet${language.extension(code)}`);
    await writeFile(file, language.prepare ? language.prepare(code) : code, 'utf-8');
    for (const launcher of language.launchers) {
      const result = await runLauncher(launcher, file, cwd, timeoutMs);
      if (result !== 'missing') {
        return result;
      }
    }
    return notRun(`${language.names[0]} isn't installed (looked for ${language.launchers.map((l) => l.command).join(', ')}).`);
  } catch (error) {
    return notRun(error instanceof Error ? error.message : String(error));
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
