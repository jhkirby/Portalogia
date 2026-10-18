// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/**
 * The helper's whole program: per-monitor DPI aware (so the coordinates are
 * physical screen pixels, as `screen.dipToScreenPoint` gives them), then one
 * `SetCursorPos` per line of "x y" read from stdin, until stdin closes — which
 * it does when the app exits, ending the helper with it.
 */
const HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Northstar -Name Cursor -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
'@
[void][Northstar.Cursor]::SetProcessDpiAwarenessContext([System.IntPtr]::new(-4))
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Split(' ')
  if ($parts.Length -eq 2) { [void][Northstar.Cursor]::SetCursorPos([int]$parts[0], [int]$parts[1]) }
}
`;

/** Starts the helper process; injectable so the warper can be tested without one. */
export type HelperLauncher = () => ChildProcess;

/** Runs `HELPER_SCRIPT` in Windows PowerShell, by its full path (not whatever `powershell` the PATH finds first). */
function launchPowerShellHelper(): ChildProcess {
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // -EncodedCommand takes UTF-16LE base64, which sidesteps every quoting rule between here and the script.
  const encoded = Buffer.from(HELPER_SCRIPT, 'utf16le').toString('base64');
  return spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

/**
 * Moves the operating system's pointer to a point on the screen — the one
 * thing neither Chromium nor Electron can do. The PDF viewer's grab tool
 * needs it: as in Okular, a drag that reaches one edge of the view carries on
 * from the opposite edge, so a pan never runs out of room. The real pointer
 * itself moves there (no stand-in for it), so it is always under the hand,
 * and letting go leaves it exactly where it is.
 *
 * Windows only, through a small long-lived PowerShell helper (no native
 * module to build or ship); elsewhere `moveTo` does nothing and the pointer
 * stops at the screen's edges as in an ordinary drag. The helper takes about a second to start,
 * so `prepare` starts it early, when a PDF is first opened.
 */
export class CursorWarper {
  private helper: ChildProcess | null = null;

  /**
   * @param launch Starts the helper process.
   * @param platform The OS this runs on (`process.platform`); the helper exists only on `'win32'`.
   */
  public constructor(
    private readonly launch: HelperLauncher = launchPowerShellHelper,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** Starts the helper now, if it isn't running, so the first `moveTo` doesn't wait for it. */
  public prepare(): void {
    this.ensureHelper();
  }

  /**
   * Puts the pointer at a point on the screen. Best effort: if the helper
   * can't run, the pointer simply stays where it is.
   * @param x The point's x, in physical screen pixels.
   * @param y The point's y, in physical screen pixels.
   */
  public moveTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    const helper = this.ensureHelper();
    helper?.stdin?.write(`${Math.round(x)} ${Math.round(y)}\n`);
  }

  /** Ends the helper, if it's running. */
  public dispose(): void {
    this.helper?.kill();
    this.helper = null;
  }

  /** @returns The running helper, started if need be, or `null` where there is none. */
  private ensureHelper(): ChildProcess | null {
    if (this.platform !== 'win32') {
      return null;
    }
    if (this.helper && this.helper.exitCode === null && !this.helper.killed) {
      return this.helper;
    }
    try {
      const helper = this.launch();
      // A helper that fails (PowerShell missing or blocked) is dropped; the next request tries a fresh one.
      helper.on('error', () => {
        if (this.helper === helper) {
          this.helper = null;
        }
      });
      helper.on('exit', () => {
        if (this.helper === helper) {
          this.helper = null;
        }
      });
      helper.stdin?.on('error', () => undefined);
      this.helper = helper;
      return helper;
    } catch {
      return null;
    }
  }
}

/** The app's one warper: there is one pointer. */
export const cursorWarper = new CursorWarper();
