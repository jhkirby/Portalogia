// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-25

import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import type { RGB } from '@shared/color';
import type { HighlightQuote, HighlightStore, StoredHighlight } from './HighlightStore';
import { getCurrentAccent } from './pageSelectionAccent';
import type { SharedTabRegistry } from './SharedTabRegistry';

// Hardcoded rather than pulled from `@shared/ipc-contract` — see
// `src/preload/tabHighlighter.ts`'s own comment: that file lives inside a
// sandboxed preload bundle that can't share a chunk with any other preload
// entry, so these four channel names are duplicated by hand on both sides
// instead. Keep them in sync.
const HighlighterState = 'highlighter:state';
const HighlighterOp = 'highlighter:op';
const HighlighterApplyOp = 'highlighter:apply-op';
const HighlighterRestore = 'highlighter:restore';

const rgbSchema = z.object({ r: z.number(), g: z.number(), b: z.number() });
const quoteSchema = z.object({ exact: z.string().min(1), prefix: z.string(), suffix: z.string() });
const reportedOpSchema = z.union([
  z.object({ kind: z.literal('add'), id: z.string().min(1), quote: quoteSchema, color: rgbSchema }),
  z.object({ kind: z.literal('remove'), id: z.string().min(1) }),
]);

/** A highlight as sent to/from a tab's own preload — the wire shape both sides agree on by convention (see the hardcoded channel names above), not a type either side imports at runtime. */
interface HighlightRecord {
  readonly id: string;
  readonly quote: HighlightQuote;
  readonly color: RGB;
}

/** One undoable action: a highlight that was added, or one that was removed. Undoing either just means doing the other. */
interface HighlightOp {
  readonly kind: 'add' | 'remove';
  readonly highlight: HighlightRecord;
}

interface TabHighlightState {
  /** Every highlight currently applied to this tab's live document, keyed by id — resolves a bare `remove` report (preload only knows the id it's removing, not the full record) back to what undoing that removal needs to restore. */
  readonly current: Map<string, HighlightRecord>;
  readonly undo: HighlightOp[];
  readonly redo: HighlightOp[];
}

function toRecord(stored: StoredHighlight): HighlightRecord {
  return { id: stored.id, quote: stored.quote, color: stored.colorRgb };
}

function toStored(record: HighlightRecord, url: string): StoredHighlight {
  return { id: record.id, url, quote: record.quote, colorRgb: record.color, createdAt: Date.now() };
}

/**
 * Owns the highlighter tool's cross-process wiring for every browser tab —
 * shared across every window's `TabManager` (constructed once in
 * `main/index.ts`, like `SharedTabRegistry`/`TerminalManager`) since a tab
 * carries its highlights with it if it's moved between windows. A
 * `TabManager` itself only owns the per-window on/off toggle
 * (`highlighterActive`, mirroring `laserPointerActive`) and decides *when*
 * to call into this class — on toggle, on tab activation, on every
 * `dom-ready`, and on Ctrl+Z/Ctrl+Y (see `wireSharedInputHandling`); this
 * class owns what a highlight actually *is*: creating it, undoing/redoing
 * it, persisting it, and pushing it down into a tab's own preload
 * (`tabHighlighter.ts`), which does the actual DOM work of wrapping,
 * un-wrapping, and re-anchoring `<mark>` elements.
 *
 * Terminal-tab highlights are handled entirely separately (`Terminal.tsx`,
 * using xterm's own decoration API) and never touch this class or
 * `HighlightStore` — a terminal has no navigable URL to key persistence off
 * of and no meaningful "reload" of its content, so persisting those to disk
 * the same way wouldn't mean anything.
 */
export class HighlighterController {
  private readonly tabs = new Map<string, TabHighlightState>();

  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: HighlightStore,
  ) {
    ipcMain.on(HighlighterOp, (event, rawOp: unknown) => {
      const tabId = this.resolveTabId(event.sender);
      const parsed = reportedOpSchema.safeParse(rawOp);
      if (!tabId || !parsed.success) {
        return;
      }
      this.applyReportedOp(tabId, parsed.data);
    });
  }

  /**
   * Pushes the highlighter's current on/off state (and, if on, the current
   * accent color) to a tab's own preload — call on toggle, on tab
   * activation, and (for a browser tab) on every `dom-ready`, so a tab's
   * cursor/mouseup handling always reflects the window currently showing
   * it, regardless of whether that tab just finished loading or was already
   * open. A terminal tab listens on this same channel too
   * (`src/preload/terminal.ts`) but only ever uses the on/off-plus-color
   * half of it — see `Terminal.tsx`'s own doc comment for why it has no
   * op/restore/undo-redo wiring the way a browser tab does. A no-op for a
   * tab that no longer exists.
   */
  public syncState(tabId: string, active: boolean): void {
    const view = this.registry.views.get(tabId);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    view.webContents.send(HighlighterState, { active, color: getCurrentAccent() });
  }

  /**
   * Starts tracking a fresh document's highlights — call on every
   * `dom-ready` for a browser tab, before `restoreFor`. A fresh document has
   * none of the previous one's undo/redo history or live highlights,
   * regardless of whether it's the very same URL reloaded.
   */
  public resetTab(tabId: string): void {
    this.tabs.set(tabId, { current: new Map(), undo: [], redo: [] });
  }

  /**
   * Pushes every highlight persisted for a tab's current URL down to its
   * preload to re-apply — call once per `dom-ready`, right after
   * `resetTab`. Restored highlights seed `current` directly rather than
   * going through `applyReportedOp`, since they're not a new action Ctrl+Z
   * should be able to undo — they were already there before this page load.
   */
  public restoreFor(tabId: string, url: string): void {
    const view = this.registry.views.get(tabId);
    const tabState = this.tabs.get(tabId);
    if (!view || !tabState || view.webContents.isDestroyed()) {
      return;
    }
    const stored = this.store.listFor(url);
    if (stored.length === 0) {
      return;
    }
    const highlights = stored.map(toRecord);
    for (const highlight of highlights) {
      tabState.current.set(highlight.id, highlight);
    }
    view.webContents.send(HighlighterRestore, { highlights });
  }

  /**
   * Removes a tab's in-memory undo/redo/current state — call when a tab
   * closes, so a long browsing session doesn't accumulate stacks for tabs
   * that no longer exist. Never touches `HighlightStore`: persisted
   * highlights are keyed by URL, not tab id, and outlive the tab that made
   * them for whenever that page is opened again.
   */
  public disposeTab(tabId: string): void {
    this.tabs.delete(tabId);
  }

  /**
   * Undoes a tab's most recent highlight action (Ctrl+Z, only while the
   * highlighter tool is on — see `TabManager.wireSharedInputHandling`) —
   * inverts it (an add is undone by removing it, a remove by re-adding it)
   * and moves it onto the redo stack. A no-op if there's nothing to undo.
   */
  public undo(tabId: string): void {
    const tabState = this.tabs.get(tabId);
    const op = tabState?.undo.pop();
    if (!tabState || !op) {
      return;
    }
    tabState.redo.push(op);
    this.invert(tabId, tabState, op);
  }

  /** Redoes a tab's most recently undone highlight action (Ctrl+Y). A no-op if there's nothing to redo. */
  public redo(tabId: string): void {
    const tabState = this.tabs.get(tabId);
    const op = tabState?.redo.pop();
    if (!tabState || !op) {
      return;
    }
    tabState.undo.push(op);
    this.perform(tabId, tabState, op);
  }

  /** Applies an op as-is: an `add` op adds the highlight, a `remove` op removes it. What `redo` does. */
  private perform(tabId: string, tabState: TabHighlightState, op: HighlightOp): void {
    const url = this.urlFor(tabId);
    if (op.kind === 'add') {
      tabState.current.set(op.highlight.id, op.highlight);
      this.sendApplyOp(tabId, { action: 'add', highlight: op.highlight });
      if (url) {
        this.store.add(toStored(op.highlight, url));
      }
    } else {
      tabState.current.delete(op.highlight.id);
      this.sendApplyOp(tabId, { action: 'remove', id: op.highlight.id });
      this.store.remove(op.highlight.id);
    }
  }

  /** Applies an op's inverse: undoing an `add` removes it, undoing a `remove` re-adds it. What `undo` does. */
  private invert(tabId: string, tabState: TabHighlightState, op: HighlightOp): void {
    const url = this.urlFor(tabId);
    if (op.kind === 'add') {
      tabState.current.delete(op.highlight.id);
      this.sendApplyOp(tabId, { action: 'remove', id: op.highlight.id });
      this.store.remove(op.highlight.id);
    } else {
      tabState.current.set(op.highlight.id, op.highlight);
      this.sendApplyOp(tabId, { action: 'add', highlight: op.highlight });
      if (url) {
        this.store.add(toStored(op.highlight, url));
      }
    }
  }

  /**
   * Handles a highlight a tab's own preload just made or removed on its own
   * (a live user action — a fresh selection released, or a hover+D/Delete),
   * as opposed to an undo/redo replay. The DOM side is already done by the
   * time this fires (the preload applies its own change immediately, before
   * reporting it); this only updates main's own bookkeeping: records it on
   * the undo stack, clears the redo stack (a fresh action invalidates
   * whatever could have been redone, same as any ordinary undo/redo model),
   * and persists it.
   */
  private applyReportedOp(
    tabId: string,
    parsed: { kind: 'add'; id: string; quote: HighlightQuote; color: RGB } | { kind: 'remove'; id: string },
  ): void {
    const tabState = this.tabs.get(tabId) ?? { current: new Map<string, HighlightRecord>(), undo: [], redo: [] };
    this.tabs.set(tabId, tabState);

    let op: HighlightOp;
    if (parsed.kind === 'add') {
      op = { kind: 'add', highlight: { id: parsed.id, quote: parsed.quote, color: parsed.color } };
    } else {
      const existing = tabState.current.get(parsed.id);
      if (!existing) {
        // Nothing on record for this id — e.g. a stale report from a
        // document that's since navigated away. Nothing to undo to.
        return;
      }
      op = { kind: 'remove', highlight: existing };
    }

    tabState.redo.length = 0;
    tabState.undo.push(op);

    const url = this.urlFor(tabId);
    if (op.kind === 'add') {
      tabState.current.set(op.highlight.id, op.highlight);
      if (url) {
        this.store.add(toStored(op.highlight, url));
      }
    } else {
      tabState.current.delete(op.highlight.id);
      this.store.remove(op.highlight.id);
    }
  }

  private urlFor(tabId: string): string | null {
    const state = this.registry.states.get(tabId);
    return state?.kind === 'browser' ? state.url : null;
  }

  private sendApplyOp(
    tabId: string,
    payload: { action: 'add'; highlight: HighlightRecord } | { action: 'remove'; id: string },
  ): void {
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(HighlighterApplyOp, payload);
    }
  }

  /**
   * Finds which tab id owns a given `webContents` — `HighlighterOp` arrives
   * from a tab's own child `WebContentsView`, not the chrome's top-level
   * one, so (like `registerTabIpc`'s terminal channels) it can't be resolved
   * from `event.sender` the direct way the chrome-originated channels are.
   * Unlike those, there's no tab id already carried in the payload to key
   * off of, so this scans `registry.views` instead.
   */
  private resolveTabId(sender: WebContents): string | undefined {
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents === sender) {
        return tabId;
      }
    }
    return undefined;
  }
}
