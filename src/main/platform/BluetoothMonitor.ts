// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { BluetoothStatus } from '@shared/ipc-contract';

/** How often, in ms, the devices are read: `pnputil` takes a few hundred ms, so less often than Wi-Fi's `netsh`. */
const POLL_MS = 5000;

/** Runs `pnputil` over the Bluetooth class and resolves with its output; injectable so the monitor can be tested without it. */
export type BluetoothDevicesReader = () => Promise<string>;

/**
 * The device property Windows sets on a paired Bluetooth device while it is
 * connected (the one Settings' "Connected" reads). `pnputil` prints it by its
 * key, since it has no name, and keys aren't translated.
 */
const CONNECTED_KEY = '{83da6326-97a6-4088-9453-a1923f573b29}[15]';

/** A paired device's own node (`BTHENUM\Dev_<address>`, `BTHLE\Dev_<address>`), not one of its services or the adapter. */
const DEVICE_INSTANCE = /^(?:BTHENUM|BTHLE)\\DEV_/i;

/**
 * Windows' Bluetooth enumerators (`BTH\MS_BTHBRB`, `BTH\MS_BTHLE`, `BTH\MS_RFCOMM`). They're present only while the
 * radio is on: turning Bluetooth off leaves the adapter's own (USB) node and nothing else.
 */
const RADIO_INSTANCE = /^BTH\\MS_/i;

/** Reads the present Bluetooth devices and their properties by `pnputil`'s full path, with no console window. */
function readWithPnputil(): Promise<string> {
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const pnputil = join(systemRoot, 'System32', 'pnputil.exe');
  return new Promise((resolve, reject) => {
    execFile(
      pnputil,
      ['/enum-devices', '/class', 'Bluetooth', '/connected', '/properties'],
      { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/**
 * The Bluetooth state in `pnputil /enum-devices /class Bluetooth /connected
 * /properties` output: one block per present device, separated by blank
 * lines, each starting with its instance ID. Only the paired devices' own
 * nodes are counted, and one device that pairs twice (a phone over both
 * Classic and LE, under its name on each) counts once.
 * @param output What `pnputil` printed.
 * @returns `unavailable` with no Bluetooth devices at all (no adapter), `off` with the radio turned off, otherwise
 *   `on`, how many devices are connected, and their names.
 */
export function parsePnputilBluetooth(output: string): BluetoothStatus {
  const blocks = output.split(/\r?\n[ \t]*\r?\n/);
  // The first line's value, after its (translated) label: `Instance ID:    BTH\MS_BTHBRB\...`.
  const instanceIds = blocks.map((block) => /^[^\r\n:]+:\s*(\S+)/m.exec(block.trimStart())?.[1] ?? null);
  if (!instanceIds.some((id) => id !== null && id.includes('\\'))) {
    return { state: 'unavailable', devices: 0, names: [] };
  }
  if (!instanceIds.some((id) => id !== null && RADIO_INSTANCE.test(id))) {
    return { state: 'off', devices: 0, names: [] };
  }
  const property = (block: string, key: string): string | null => {
    const at = block.indexOf(key);
    if (at < 0) {
      return null;
    }
    // The value sits on the line after the key's `KEY [Type]:` line.
    return /\r?\n\s*(.*?)\s*(?:\r?\n|$)/.exec(block.slice(at))?.[1] ?? null;
  };
  const connected = new Set<string>();
  const names = new Set<string>();
  blocks.forEach((block, index) => {
    const id = instanceIds[index];
    if (!id || !DEVICE_INSTANCE.test(id) || property(block, CONNECTED_KEY)?.toUpperCase() !== 'TRUE') {
      return;
    }
    const name = property(block, 'DEVPKEY_Device_FriendlyName');
    connected.add(name ?? property(block, 'DEVPKEY_Device_ContainerId') ?? id);
    if (name) {
      names.add(name);
    }
  });
  return { state: 'on', devices: connected.size, names: [...names].sort((a, b) => a.localeCompare(b)) };
}

/**
 * Follows whether Bluetooth is on and its connected devices, for the titlebar's
 * status icon. Like `WifiMonitor`, Windows offers Node no change event, so it
 * reads `pnputil` every `POLL_MS` and reports only when what it read differs
 * from last time.
 */
export class BluetoothMonitor {
  private status: BluetoothStatus = { state: 'unavailable', devices: 0, names: [] };
  private timer: NodeJS.Timeout | null = null;
  private reading = false;

  /**
   * @param onChange Called with the new state whenever it changes.
   * @param read Reads the devices; `pnputil` unless a test supplies one.
   */
  public constructor(
    private readonly onChange: (status: BluetoothStatus) => void,
    private readonly read: BluetoothDevicesReader = readWithPnputil,
  ) {}

  /** The state as last read. */
  public get current(): BluetoothStatus {
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
    let next: BluetoothStatus;
    try {
      next = parsePnputilBluetooth(await this.read());
    } catch {
      // `pnputil` exits non-zero when the class has no devices, and isn't there at all off Windows.
      next = { state: 'unavailable', devices: 0, names: [] };
    } finally {
      this.reading = false;
    }
    if (
      next.state !== this.status.state ||
      next.devices !== this.status.devices ||
      next.names.join('\n') !== this.status.names.join('\n')
    ) {
      this.status = next;
      this.onChange(next);
    }
  }
}
