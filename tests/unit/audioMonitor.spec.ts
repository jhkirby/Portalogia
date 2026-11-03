// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { test, expect } from '@playwright/test';
import type { AudioStatus } from '../../src/shared/ipc-contract';
import { AudioMonitor, parseAudioLine, type AudioReaderSpawner } from '../../src/main/platform/AudioMonitor';

const UNAVAILABLE: AudioStatus = { state: 'unavailable', device: null, volume: 0, muted: false };

/** A reader the test drives by hand: what it "prints", and when it "exits". */
function fakeReader(): { spawner: AudioReaderSpawner; print: (line: string) => void; exit: () => void; spawned: () => number; stopped: () => number } {
  let onLine: (line: string) => void = () => {};
  let onExit: () => void = () => {};
  let spawned = 0;
  let stopped = 0;
  return {
    spawner: (line, exit) => {
      spawned += 1;
      onLine = line;
      onExit = exit;
      return { stop: () => (stopped += 1) };
    },
    print: (line) => onLine(line),
    exit: () => onExit(),
    spawned: () => spawned,
    stopped: () => stopped,
  };
}

test.describe('parseAudioLine', () => {
  test('reads a device, its volume and its mute', () => {
    expect(parseAudioLine('{"state":"on","device":"Speakers (Realtek)","volume":42,"muted":false}')).toEqual({
      state: 'on',
      device: 'Speakers (Realtek)',
      volume: 42,
      muted: false,
    });
  });

  test('no device reads as unavailable', () => {
    expect(parseAudioLine('{"state":"unavailable"}')).toEqual(UNAVAILABLE);
  });

  test('a nameless device has no name rather than an empty one', () => {
    expect(parseAudioLine('{"state":"on","device":"  ","volume":5,"muted":true}')?.device).toBeNull();
  });

  test('the volume is held to 0-100 and made whole', () => {
    expect(parseAudioLine('{"state":"on","device":"A","volume":140.6,"muted":false}')?.volume).toBe(100);
    expect(parseAudioLine('{"state":"on","device":"A","volume":-3,"muted":false}')?.volume).toBe(0);
  });

  test('a very long name is cut short', () => {
    const name = 'x'.repeat(5000);
    expect(parseAudioLine(`{"state":"on","device":"${name}","volume":1,"muted":false}`)?.device?.length).toBe(200);
  });

  test('anything else is ignored', () => {
    for (const line of ['', 'not json', 'null', '42', '{"state":"on"}', '{"state":"on","device":1,"volume":2,"muted":false}', '{"state":"loud"}']) {
      expect(parseAudioLine(line), line).toBeNull();
    }
  });
});

test.describe('AudioMonitor', () => {
  test('reports each change once, and nothing when a line says the same', () => {
    const reader = fakeReader();
    const changes: AudioStatus[] = [];
    const monitor = new AudioMonitor((status) => changes.push(status), reader.spawner, 'win32');
    monitor.start();
    reader.print('{"state":"on","device":"A","volume":20,"muted":false}');
    reader.print('{"state":"on","device":"A","volume":20,"muted":false}');
    reader.print('garbage');
    reader.print('{"state":"on","device":"A","volume":20,"muted":true}');
    expect(changes.map((status) => [status.volume, status.muted])).toEqual([
      [20, false],
      [20, true],
    ]);
    expect(monitor.current.muted).toBe(true);
    monitor.stop();
  });

  test('a reader that stops on its own reads as unavailable', () => {
    const reader = fakeReader();
    const changes: AudioStatus[] = [];
    const monitor = new AudioMonitor((status) => changes.push(status), reader.spawner, 'win32');
    monitor.start();
    reader.print('{"state":"on","device":"A","volume":20,"muted":false}');
    reader.exit();
    expect(changes.at(-1)).toEqual(UNAVAILABLE);
    monitor.stop();
  });

  test('stopping stops the reader, and its exit afterwards says nothing', () => {
    const reader = fakeReader();
    const changes: AudioStatus[] = [];
    const monitor = new AudioMonitor((status) => changes.push(status), reader.spawner, 'win32');
    monitor.start();
    reader.print('{"state":"on","device":"A","volume":20,"muted":false}');
    monitor.stop();
    reader.exit();
    expect(reader.stopped()).toBe(1);
    expect(changes).toHaveLength(1);
  });

  test('starts no reader off Windows, and once only when started twice', () => {
    const elsewhere = fakeReader();
    new AudioMonitor(() => {}, elsewhere.spawner, 'linux').start();
    expect(elsewhere.spawned()).toBe(0);

    const reader = fakeReader();
    const monitor = new AudioMonitor(() => {}, reader.spawner, 'win32');
    monitor.start();
    monitor.start();
    expect(reader.spawned()).toBe(1);
    monitor.stop();
  });
});
