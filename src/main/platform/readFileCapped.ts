// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { open } from 'node:fs/promises';

/** How much is read at a time. */
const READ_CHUNK_BYTES = 1024 * 1024;

/** What `readFileCapped` found. */
export type CappedRead =
  | { readonly kind: 'ok'; readonly data: Buffer; readonly mtimeMs: number }
  | { readonly kind: 'not-file' }
  | { readonly kind: 'too-large' };

/**
 * Reads a file only if it is no bigger than a limit. The size is checked on
 * the same open handle the bytes are read from, and the read stops one byte
 * past the limit, so a file swapped between a separate `stat` and `readFile`,
 * or one still growing, can't push past the cap and exhaust memory.
 * @param path The file.
 * @param maxBytes The most bytes allowed.
 * @param onProgress Called after each chunk with the bytes read so far and the file's size when opened (a file still
 *   growing can read past that size).
 * @returns The bytes and modified time, or why it wasn't read.
 * @throws If the file can't be opened or read.
 */
export async function readFileCapped(
  path: string,
  maxBytes: number,
  onProgress?: (bytesRead: number, totalBytes: number) => void,
): Promise<CappedRead> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return { kind: 'not-file' };
    }
    if (info.size > maxBytes) {
      return { kind: 'too-large' };
    }
    // Read to the end in chunks rather than trusting the size above: the file may have grown since.
    const chunks: Buffer[] = [];
    let length = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, length);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      onProgress?.(length, info.size);
      if (length > maxBytes) {
        return { kind: 'too-large' };
      }
    }
    return { kind: 'ok', data: Buffer.concat(chunks, length), mtimeMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}
