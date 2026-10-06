// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  applyLineEnding,
  detectLineEnding,
  normalizeLineEndings,
  type LineEnding,
} from '@shared/markdown/source';
import { MAX_NOTE_BYTES, forgetVaultScans, isMarkdownPath, samePath, toNoteFileName } from './MarkdownVault';

/** One note a Markdown tab has open, as main holds it. */
interface OpenNote {
  path: string;
  /** The source with plain `\n` line breaks, as the editor and the renderer see it. */
  content: string;
  /** The line ending the file uses, put back on save. */
  ending: LineEnding;
  /** The file's modified time when it was last read or written here, to notice a change made elsewhere. */
  mtimeMs: number;
  /** Bumped each time the tab is given a different note, so a late save for the previous one can be recognized and refused. */
  generation: number;
  /** The paths this tab came from by following links, nearest last — what Back steps through. */
  back: string[];
  forward: string[];
  /** Saves are written one at a time, in order. */
  writes: Promise<void>;
}

/** What opening a note hands back to show. */
export interface OpenedNote {
  readonly name: string;
  readonly content: string;
  readonly generation: number;
}

/** A note's source has no business starting with a byte-order mark; editors that add one would otherwise make it show up as a stray character. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The notes open in Markdown tabs, by tab id: where each lives on disk, its
 * source as last read or written, and the links the tab has followed (for
 * Back/Forward). Plain files, no Electron — `TabManager` drives it and does
 * the telling of pages and the dialogs.
 *
 * It's the only thing that reads or writes a note, and it works from the path
 * it holds for the tab: a page asks to "save" or "rename" and never names a
 * path, so a page can't be turned into a way to write somewhere else.
 */
export class MarkdownDocuments {
  private readonly notes = new Map<string, OpenNote>();
  private nextGeneration = 1;

  /** @returns Whether the tab has a note open. */
  public has(id: string): boolean {
    return this.notes.has(id);
  }

  /** @returns The open note's path, or `undefined`. */
  public pathOf(id: string): string | undefined {
    return this.notes.get(id)?.path;
  }

  /** @returns The open note's source (plain `\n` breaks), or `undefined`. */
  public contentOf(id: string): string | undefined {
    return this.notes.get(id)?.content;
  }

  /** @returns The tab's current generation (see `OpenNote.generation`), or `undefined`. */
  public generationOf(id: string): number | undefined {
    return this.notes.get(id)?.generation;
  }

  public canGoBack(id: string): boolean {
    return (this.notes.get(id)?.back.length ?? 0) > 0;
  }

  public canGoForward(id: string): boolean {
    return (this.notes.get(id)?.forward.length ?? 0) > 0;
  }

  /**
   * Opens a note in a tab, replacing whatever it had.
   * @param id The tab.
   * @param path The note's path.
   * @param history `'reset'` for a note picked from the toolbar (the tab's Back/Forward start over) or
   *   `'push'` for one reached by a link (the note it came from becomes Back).
   * @throws If the file is missing, isn't a note, or is too large.
   */
  public async open(id: string, path: string, history: 'reset' | 'push'): Promise<OpenedNote> {
    const loaded = await this.read(path);
    const previous = this.notes.get(id);
    const back = history === 'push' && previous && !samePath(previous.path, path) ? [...previous.back, previous.path] : [];
    return this.install(id, path, loaded, { back, forward: [] });
  }

  /**
   * Steps a tab back or forward through the notes it followed links through,
   * skipping any that have since gone missing.
   * @param id The tab.
   * @param direction `-1` for Back, `1` for Forward.
   * @returns The note now showing, or `null` if there was nowhere to go.
   */
  public async step(id: string, direction: 1 | -1): Promise<OpenedNote | null> {
    const current = this.notes.get(id);
    if (!current) {
      return null;
    }
    const source = direction === -1 ? current.back : current.forward;
    const other = direction === -1 ? current.forward : current.back;
    while (source.length > 0) {
      const target = source[source.length - 1] as string;
      try {
        const loaded = await this.read(target);
        source.pop();
        other.push(current.path);
        return this.install(id, target, loaded, { back: current.back, forward: current.forward });
      } catch {
        source.pop();
      }
    }
    return null;
  }

  /**
   * Creates a new, empty note (a title heading in it) and opens it. If a file
   * is already there it is opened as it is — never overwritten.
   * @param id The tab.
   * @param path Where to create it.
   * @param history As for `open`.
   * @returns The note, and whether it was created (rather than already there).
   */
  public async create(
    id: string,
    path: string,
    history: 'reset' | 'push',
  ): Promise<{ readonly note: OpenedNote; readonly created: boolean }> {
    let created = false;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `# ${basename(path).replace(/\.(md|markdown)$/i, '')}\n\n`, { encoding: 'utf-8', flag: 'wx' });
      created = true;
      forgetVaultScans();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
    return { note: await this.open(id, path, history), created };
  }

  /**
   * Writes the page's edit to the tab's note. Ignored if the tab has moved to
   * a different note since the page began that edit.
   * @param id The tab.
   * @param content The note's source as the editor holds it.
   * @param generation The generation the page was given the note under.
   * @throws If the file can't be written.
   */
  public async save(id: string, content: string, generation: number): Promise<void> {
    const note = this.notes.get(id);
    if (!note || note.generation !== generation) {
      return;
    }
    const source = normalizeLineEndings(content);
    note.content = source;
    const path = note.path;
    const write = note.writes.then(async () => {
      const text = applyLineEnding(source, note.ending);
      const temporary = `${path}.northstar-${randomUUID().slice(0, 8)}.tmp`;
      try {
        // Written beside the note and moved over it, so a crash mid-write can't leave half a note.
        await writeFile(temporary, text, 'utf-8');
        await rename(temporary, path);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        // Some synced or locked folders refuse the rename; the direct write is the fallback.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw error;
        }
        await writeFile(path, text, 'utf-8');
      }
      note.mtimeMs = (await stat(path)).mtimeMs;
    });
    // A failed write must not wedge the chain: later saves still get their turn.
    note.writes = write.catch(() => undefined);
    await write;
  }

  /** @returns The note's source with the file's own line endings, for saving a copy — or `undefined`. */
  public exportSourceOf(id: string): string | undefined {
    const note = this.notes.get(id);
    return note ? applyLineEnding(note.content, note.ending) : undefined;
  }

  /**
   * Re-reads the note if the file changed since this tab last read or wrote it
   * (another program saved it) — what keeps an open tab from showing, and
   * then overwriting, a stale copy.
   * @param id The tab.
   * @returns The new source if it changed, else `null`.
   */
  public async refreshIfChanged(id: string): Promise<string | null> {
    const note = this.notes.get(id);
    if (!note) {
      return null;
    }
    try {
      await note.writes;
      const { mtimeMs } = await stat(note.path);
      if (mtimeMs === note.mtimeMs) {
        return null;
      }
      const loaded = await this.read(note.path);
      note.mtimeMs = loaded.mtimeMs;
      if (loaded.content === note.content) {
        return null;
      }
      note.content = loaded.content;
      note.ending = loaded.ending;
      return loaded.content;
    } catch {
      // Gone or unreadable: the tab keeps what it has.
      return null;
    }
  }

  /**
   * Renames the tab's note on disk, in its own folder.
   * @param id The tab.
   * @param name The new file name (`.md` or `.markdown`).
   * @returns The old and new paths.
   * @throws If nothing is open, the name isn't a bare note file name, or another file already has it.
   */
  public async rename(id: string, name: string): Promise<{ readonly oldPath: string; readonly newPath: string }> {
    const note = this.notes.get(id);
    if (!note) {
      throw new Error('Open a note before renaming it.');
    }
    // A bare file name only: anything else could move the file elsewhere.
    if (basename(name) !== name || name.includes('/') || name.includes('\\') || toNoteFileName(name) !== name) {
      throw new Error('That is not a valid note file name.');
    }
    const oldPath = note.path;
    const newPath = join(dirname(oldPath), name);
    if (newPath !== oldPath) {
      // Windows paths are case-insensitive, so a case-only rename is allowed through;
      // anything else that already exists is never overwritten.
      const caseOnly = newPath.toLowerCase() === oldPath.toLowerCase();
      if (!caseOnly && (await stat(newPath).then(() => true, () => false))) {
        throw new Error('A file with that name already exists.');
      }
      await note.writes;
      await rename(oldPath, newPath);
      note.path = newPath;
      forgetVaultScans();
    }
    return { oldPath, newPath };
  }

  /** Forgets a tab's note (the tab closed, or closed its file). */
  public close(id: string): void {
    this.notes.delete(id);
  }

  /** Reads and normalizes one note from disk. */
  private async read(path: string): Promise<{ content: string; ending: LineEnding; mtimeMs: number }> {
    if (!isMarkdownPath(path)) {
      throw new Error('That file is not a Markdown note (.md or .markdown).');
    }
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error('That is not a file.');
    }
    if (info.size > MAX_NOTE_BYTES) {
      throw new Error('That note is too large to open (limit 20 MB).');
    }
    const raw = stripBom(await readFile(path, 'utf-8'));
    return { content: normalizeLineEndings(raw), ending: detectLineEnding(raw), mtimeMs: info.mtimeMs };
  }

  private install(
    id: string,
    path: string,
    loaded: { content: string; ending: LineEnding; mtimeMs: number },
    history: { back: string[]; forward: string[] },
  ): OpenedNote {
    const generation = this.nextGeneration;
    this.nextGeneration += 1;
    this.notes.set(id, {
      path,
      content: loaded.content,
      ending: loaded.ending,
      mtimeMs: loaded.mtimeMs,
      generation,
      back: history.back,
      forward: history.forward,
      writes: Promise.resolve(),
    });
    return { name: basename(path), content: loaded.content, generation };
  }
}
