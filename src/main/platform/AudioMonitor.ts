// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AudioStatus } from '@shared/ipc-contract';

/** How often, in ms, the reader looks at the volume: often enough that a volume key's change shows at once. */
const READ_INTERVAL_MS = 250;

/** How long to wait before starting the reader again after it stopped on its own. */
const RESTART_DELAY_MS = 5000;

/** The longest device name passed on: a name is for reading at a glance, and the titlebar cuts it short anyway. */
const MAX_DEVICE_NAME_CHARS = 200;

const UNAVAILABLE: AudioStatus = { state: 'unavailable', device: null, volume: 0, muted: false };

/**
 * The reader, run by PowerShell: a little C# over Windows' Core Audio API (which
 * has no command-line tool), asking the default playback device for its name,
 * master volume and mute every `READ_INTERVAL_MS`, and printing a line of JSON
 * each time any of them changes — on its own or because the default device
 * did. It only reads: nothing here can change the volume.
 */
const READER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PortalogiaAudio {
  [StructLayout(LayoutKind.Sequential)]
  struct PropertyKey { public Guid fmtid; public int pid; }

  [StructLayout(LayoutKind.Sequential)]
  struct PropVariant { public short vt; public short r1; public short r2; public short r3; public IntPtr p; public IntPtr p2; }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out int count);
    int GetAt(int index, out PropertyKey key);
    int GetValue(ref PropertyKey key, out PropVariant value);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
    int OpenPropertyStore(int access, out IPropertyStore store);
  }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float level, ref Guid context);
    int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel(out float level);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  public static class Reader {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);

    static string Escape(string text) {
      var sb = new StringBuilder();
      foreach (char c in text) {
        if (c == '"' || c == '\\') { sb.Append('\\').Append(c); }
        else if (c < ' ') { sb.Append(' '); }
        else { sb.Append(c); }
      }
      return sb.ToString();
    }

    static void Release(object comObject) {
      if (comObject != null && Marshal.IsComObject(comObject)) { Marshal.ReleaseComObject(comObject); }
    }

    // The default playback device (eRender, eMultimedia), as one line of JSON.
    public static string Read() {
      IMMDeviceEnumerator enumerator = null;
      IMMDevice device = null;
      object endpoint = null;
      IPropertyStore store = null;
      try {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null) { return "{\"state\":\"unavailable\"}"; }
        var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpoint));
        var volume = (IAudioEndpointVolume)endpoint;
        float level; bool muted;
        Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out level));
        Marshal.ThrowExceptionForHR(volume.GetMute(out muted));
        string name = "";
        if (device.OpenPropertyStore(0, out store) == 0) {
          // PKEY_Device_FriendlyName: the name Windows' own sound settings show.
          var key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
          PropVariant value;
          if (store.GetValue(ref key, out value) == 0) {
            if (value.vt == 31) { name = Marshal.PtrToStringUni(value.p) ?? ""; }
            PropVariantClear(ref value);
          }
        }
        return "{\"state\":\"on\",\"device\":\"" + Escape(name) + "\",\"volume\":" + (int)Math.Round(level * 100) +
          ",\"muted\":" + (muted ? "true" : "false") + "}";
      } catch {
        return "{\"state\":\"unavailable\"}";
      } finally {
        Release(store);
        Release(endpoint);
        Release(device);
        Release(enumerator);
      }
    }

    public static void Run(int intervalMs) {
      string last = null;
      while (true) {
        string next = Read();
        if (next != last) { Console.Out.WriteLine(next); Console.Out.Flush(); last = next; }
        Thread.Sleep(intervalMs);
      }
    }
  }
}
'@
[PortalogiaAudio.Reader]::Run(${READ_INTERVAL_MS})
`;

/** A running reader: its lines as they come, and a way to stop it. */
export interface AudioReader {
  /** Stops the reader. */
  readonly stop: () => void;
}

/** Starts the reader; injectable so the monitor can be tested without PowerShell. */
export type AudioReaderSpawner = (onLine: (line: string) => void, onExit: () => void) => AudioReader;

/** Runs `READER_SCRIPT` in Windows PowerShell, by its full path, with no console window. */
function spawnPowerShellReader(onLine: (line: string) => void, onExit: () => void): AudioReader {
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Encoded (UTF-16LE, base64) so the script's quotes and braces reach PowerShell exactly as written.
  const encoded = Buffer.from(READER_SCRIPT, 'utf16le').toString('base64');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  createInterface({ input: child.stdout }).on('line', onLine);
  child.on('exit', onExit);
  child.on('error', onExit);
  return { stop: () => child.kill() };
}

/**
 * One line from the reader, as the titlebar takes it.
 * @param line A line of the reader's output.
 * @returns The audio's state, or `null` for a line that isn't one (it's ignored).
 */
export function parseAudioLine(line: string): AudioStatus | null {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record['state'] === 'unavailable') {
    return UNAVAILABLE;
  }
  const { device, volume, muted } = record;
  if (record['state'] !== 'on' || typeof device !== 'string' || typeof volume !== 'number' || typeof muted !== 'boolean') {
    return null;
  }
  return {
    state: 'on',
    device: device.trim().slice(0, MAX_DEVICE_NAME_CHARS) || null,
    volume: Math.min(100, Math.max(0, Math.round(volume))),
    muted,
  };
}

/**
 * Follows the default playback device — its name, volume and mute — for the
 * titlebar's audio section. Windows offers Node no change event for it, so one
 * reader runs for the app's lifetime and reports only changes (see
 * `READER_SCRIPT`); this passes each change on. Should the reader stop on its
 * own, the audio reads as unavailable and the reader starts again shortly.
 * Off Windows there is no reader, and the audio stays unavailable.
 */
export class AudioMonitor {
  private status: AudioStatus = UNAVAILABLE;
  private reader: AudioReader | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private running = false;

  /**
   * @param onChange Called with the new state whenever it changes.
   * @param spawnReader Starts the reader; PowerShell unless a test supplies one.
   * @param platform The operating system; the real one unless a test supplies one.
   */
  public constructor(
    private readonly onChange: (status: AudioStatus) => void,
    private readonly spawnReader: AudioReaderSpawner = spawnPowerShellReader,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** The state as last read. */
  public get current(): AudioStatus {
    return this.status;
  }

  /** Starts the reader, until `stop`. */
  public start(): void {
    if (this.running || this.platform !== 'win32') {
      return;
    }
    this.running = true;
    this.launch();
  }

  /** Stops the reader. */
  public stop(): void {
    this.running = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const reader = this.reader;
    this.reader = null;
    reader?.stop();
  }

  private launch(): void {
    const reader = this.spawnReader(
      (line) => {
        const next = parseAudioLine(line);
        if (next) {
          this.report(next);
        }
      },
      () => {
        // A reader stopped on purpose (`stop`) or already replaced says nothing more.
        if (this.reader !== reader) {
          return;
        }
        this.reader = null;
        this.report(UNAVAILABLE);
        if (this.running && !this.restartTimer) {
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (this.running) {
              this.launch();
            }
          }, RESTART_DELAY_MS);
        }
      },
    );
    this.reader = reader;
  }

  private report(next: AudioStatus): void {
    const same =
      next.state === this.status.state &&
      next.device === this.status.device &&
      next.volume === this.status.volume &&
      next.muted === this.status.muted;
    if (!same) {
      this.status = next;
      this.onChange(next);
    }
  }
}
