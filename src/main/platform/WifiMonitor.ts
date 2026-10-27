// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { WifiStatus } from '@shared/ipc-contract';

/** How often, in ms, the Wi-Fi state is read: often enough to look live, and `netsh` is cheap. */
const POLL_MS = 3000;

/** Runs `netsh wlan show interfaces` and resolves with its output; injectable so the monitor can be tested without it. */
export type InterfacesReader = () => Promise<string>;

/** Reads the interfaces by `netsh`'s full path (not whatever the PATH finds first), with no console window. */
function readWithNetsh(): Promise<string> {
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const netsh = join(systemRoot, 'System32', 'netsh.exe');
  return new Promise((resolve, reject) => {
    execFile(netsh, ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * The Wi-Fi state in `netsh wlan show interfaces` output. Reads the first
 * interface: a laptop has one. `netsh` labels its fields in the system's own
 * language, so a non-English Windows reads as `unavailable` and the icon hides.
 * @param output What `netsh wlan show interfaces` printed.
 * @returns The state, and the signal (0-100) and network name while connected.
 */
export function parseWlanInterfaces(output: string): WifiStatus {
  // Anchored at the line's start, so `SSID` doesn't also match the `AP BSSID` line below it, and kept to one line, so an
  // empty field (a hidden network's name) doesn't read on into the next one.
  const field = (name: string): string | null => {
    const match = new RegExp(`^[ \\t]*${name}[ \\t]*:[ \\t]*(.*?)[ \\t]*\\r?$`, 'mi').exec(output);
    return match ? match[1]! : null;
  };
  const state = field('State');
  if (state === null) {
    return { state: 'unavailable', signal: 0, ssid: null };
  }
  if (state.toLowerCase() !== 'connected') {
    return { state: 'disconnected', signal: 0, ssid: null };
  }
  const signal = Number.parseInt(field('Signal') ?? '', 10);
  return {
    state: 'connected',
    signal: Number.isFinite(signal) ? Math.min(100, Math.max(0, signal)) : 0,
    // A hidden network reports an empty name.
    ssid: field('SSID') || null,
  };
}

/**
 * Follows the computer's Wi-Fi connection, for the titlebar's status icon
 * (Northstar may cover the whole screen, taskbar included). Windows offers no
 * change event to Node, so it reads `netsh` every `POLL_MS` and reports only
 * when what it read differs from last time.
 */
export class WifiMonitor {
  private status: WifiStatus = { state: 'unavailable', signal: 0, ssid: null };
  private timer: NodeJS.Timeout | null = null;
  private reading = false;

  /**
   * @param onChange Called with the new state whenever it changes.
   * @param read Reads the interfaces' state; `netsh` unless a test supplies one.
   */
  public constructor(
    private readonly onChange: (status: WifiStatus) => void,
    private readonly read: InterfacesReader = readWithNetsh,
  ) {}

  /** The state as last read. */
  public get current(): WifiStatus {
    return this.status;
  }

  /** Reads the state now, then every `POLL_MS` until `stop`. */
  public start(): void {
    if (this.timer) {
      return;
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  /** Stops reading. */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Reads the state once, unless the last read is still running, and reports a change. */
  public async poll(): Promise<void> {
    if (this.reading) {
      return;
    }
    this.reading = true;
    let next: WifiStatus;
    try {
      next = parseWlanInterfaces(await this.read());
    } catch {
      // `netsh` exits non-zero with no wireless adapter (or with the WLAN service stopped).
      next = { state: 'unavailable', signal: 0, ssid: null };
    } finally {
      this.reading = false;
    }
    if (next.state !== this.status.state || next.signal !== this.status.signal || next.ssid !== this.status.ssid) {
      this.status = next;
      this.onChange(next);
    }
  }
}
