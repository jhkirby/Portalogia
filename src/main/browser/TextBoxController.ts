// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-04

import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { TEXT_BOX_FONT_SIZE_MAX, TEXT_BOX_FONT_SIZE_MIN } from '@shared/constants';
import type { StoredTextBox, TextBoxPatch, TextBoxQuote, TextBoxStore } from './TextBoxStore';
import { getCurrentAccent } from './pageSelectionAccent';
import type { SharedTabRegistry } from './SharedTabRegistry';

// Hardcoded rather than pulled from `@shared/ipc-contract` — same reason
// `CommentController` hardcodes its own: `src/preload/tabTextBoxes.ts` lives
// in a sandboxed preload bundle that can't share a chunk with another entry.
// `src/preload/pdf.ts` listens for `TextToolState` too. Keep in sync by hand.
const TextToolState = 'text-tool:state';
const TextToolOp = 'text-tool:op';
const TextToolApplyOp = 'text-tool:apply-op';
const TextToolRestore = 'text-tool:restore';
const TextToolClear = 'text-tool:clear';

const sizeSchema = z.number().int().min(TEXT_BOX_FONT_SIZE_MIN).max(TEXT_BOX_FONT_SIZE_MAX);
const alignSchema = z.enum(['left', 'center', 'right']);
const quoteSchema = z.object({ prefix: z.string(), suffix: z.string() });
const reportedOpSchema = z.union([
  z.object({
    kind: z.literal('add'),
    id: z.string().min(1).max(64),
    quote: quoteSchema,
    dx: z.number(),
    dy: z.number(),
    text: z.string().min(1).max(10000),
    size: sizeSchema,
    align: alignSchema,
  }),
  z.object({
    kind: z.literal('update'),
    id: z.string().min(1).max(64),
    text: z.string().min(1).max(10000),
    size: sizeSchema,
    align: alignSchema,
    // Present only after the box was dragged somewhere new.
    quote: quoteSchema.optional(),
    dx: z.number().optional(),
    dy: z.number().optional(),
  }),
  z.object({ kind: z.literal('remove'), id: z.string().min(1).max(64) }),
]);

/** A text box as sent to/from a tab's own preload. */
interface TextBoxRecord {
  readonly id: string;
  readonly quote: TextBoxQuote;
  readonly dx: number;
  readonly dy: number;
  readonly text: string;
  readonly size: number;
  readonly align: 'left' | 'center' | 'right';
}

type ApplyOp =
  | { action: 'add'; box: TextBoxRecord }
  | { action: 'update'; id: string; patch: TextBoxPatch }
  | { action: 'remove'; id: string };

/**
 * Owns the text box tool's cross-process wiring for browser tabs — one
 * instance shared by every window's `TabManager` (see `CommentController`,
 * which this mirrors), since a tab carries its boxes with it between
 * windows. `TabManager` only owns the per-window on/off toggle; this class
 * owns what a box *is* — persisting it, restoring it on a fresh document,
 * mirroring it onto sibling tabs open to the same URL — and the tab's own
 * preload (`src/preload/tabTextBoxes.ts`) does the DOM work.
 *
 * PDF tabs don't use this for their boxes: those are marks in
 * `PdfAnnotationStore`, saved by the page itself. They only receive the
 * on/off state from here.
 */
export class TextBoxController {
  private readonly tabs = new Map<string, Map<string, TextBoxRecord>>();

  /**
   * @param registry The shared tabs/views, used to find a tab's `webContents`.
   * @param store Where boxes are persisted, keyed by URL.
   */
  public constructor(
    private readonly registry: SharedTabRegistry,
    private readonly store: TextBoxStore,
  ) {
    ipcMain.on(TextToolOp, (event, rawOp: unknown) => {
      const tabId = this.resolveTabId(event.sender);
      const parsed = reportedOpSchema.safeParse(rawOp);
      if (tabId && parsed.success) {
        this.applyReportedOp(tabId, parsed.data);
      }
    });
  }

  /**
   * Pushes the tool's on/off state and the current accent to a tab's preload
   * (browser or PDF) — call on toggle, on tab activation, and on `dom-ready`.
   * @param tabId The tab to tell; a no-op if it no longer exists or is a terminal.
   * @param active Whether the text box tool is on in the window showing it.
   */
  public syncState(tabId: string, active: boolean): void {
    const view = this.registry.views.get(tabId);
    if (!view || view.webContents.isDestroyed() || this.registry.states.get(tabId)?.kind === 'terminal') {
      return;
    }
    view.webContents.send(TextToolState, { active, color: getCurrentAccent() });
  }

  /**
   * Pushes a fresh accent to every browser and PDF tab so existing boxes
   * repaint at once — call whenever the accent changes.
   * @param isActiveForTab Whether the window showing a given tab has the tool on.
   */
  public broadcastColor(isActiveForTab: (tabId: string) => boolean): void {
    for (const tabId of this.registry.views.keys()) {
      this.syncState(tabId, isActiveForTab(tabId));
    }
  }

  /** Starts tracking a fresh document's boxes — call on every browser-tab `dom-ready`, before `restoreFor`. */
  public resetTab(tabId: string): void {
    this.tabs.set(tabId, new Map());
  }

  /** Pushes every box saved for a tab's URL to its preload — call right after `resetTab`. */
  public restoreFor(tabId: string, url: string): void {
    const view = this.registry.views.get(tabId);
    const current = this.tabs.get(tabId);
    if (!view || !current || view.webContents.isDestroyed()) {
      return;
    }
    const boxes = this.store.listFor(url).map(TextBoxController.toRecord);
    if (boxes.length === 0) {
      return;
    }
    for (const box of boxes) {
      current.set(box.id, box);
    }
    view.webContents.send(TextToolRestore, { boxes });
  }

  /** Forgets a closed tab's in-memory state; saved boxes are keyed by URL and stay. */
  public disposeTab(tabId: string): void {
    this.tabs.delete(tabId);
  }

  /** Writes any pending save now — call on quit. */
  public flush(): void {
    this.store.flush();
  }

  /** Removes every box on a tab's page for good, and on every sibling tab open to that URL ("Revert Annotations"). */
  public clearTab(tabId: string): void {
    this.wipeTabState(tabId);
    const url = this.urlFor(tabId);
    if (!url) {
      return;
    }
    for (const stored of this.store.listFor(url)) {
      this.store.remove(stored.id);
    }
    for (const [siblingId, state] of this.registry.states) {
      if (siblingId !== tabId && state.kind === 'browser' && state.url === url) {
        this.wipeTabState(siblingId);
      }
    }
  }

  private wipeTabState(tabId: string): void {
    this.tabs.get(tabId)?.clear();
    const view = this.registry.views.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send(TextToolClear);
    }
  }

  /** Records a box a tab's preload just added, edited or deleted (the DOM side is already done) and mirrors it to sibling tabs. */
  private applyReportedOp(tabId: string, op: z.infer<typeof reportedOpSchema>): void {
    const current = this.tabs.get(tabId) ?? new Map<string, TextBoxRecord>();
    this.tabs.set(tabId, current);
    const url = this.urlFor(tabId);

    if (op.kind === 'add') {
      const box: TextBoxRecord = {
        id: op.id,
        quote: op.quote,
        dx: op.dx,
        dy: op.dy,
        text: op.text,
        size: op.size,
        align: op.align,
      };
      current.set(box.id, box);
      if (url) {
        this.store.add(TextBoxController.toStored(box, url));
        this.syncSiblingTabs(tabId, url, { action: 'add', box });
      }
    } else if (op.kind === 'update') {
      const existing = current.get(op.id);
      if (!existing) {
        return;
      }
      const patch = TextBoxController.toPatch(op);
      current.set(op.id, { ...existing, ...patch });
      this.store.update(op.id, patch);
      if (url) {
        this.syncSiblingTabs(tabId, url, { action: 'update', id: op.id, patch });
      }
    } else {
      current.delete(op.id);
      this.store.remove(op.id);
      if (url) {
        this.syncSiblingTabs(tabId, url, { action: 'remove', id: op.id });
      }
    }
  }

  /** Applies a change to every *other* tab showing `url` — boxes are keyed by URL, so two tabs on one page stay in step. */
  private syncSiblingTabs(tabId: string, url: string, payload: ApplyOp): void {
    for (const [siblingId, state] of this.registry.states) {
      if (siblingId === tabId || state.kind !== 'browser' || state.url !== url) {
        continue;
      }
      const siblingBoxes = this.tabs.get(siblingId);
      if (payload.action === 'add') {
        siblingBoxes?.set(payload.box.id, payload.box);
      } else if (payload.action === 'update') {
        const existing = siblingBoxes?.get(payload.id);
        if (existing) {
          siblingBoxes?.set(payload.id, { ...existing, ...payload.patch });
        }
      } else {
        siblingBoxes?.delete(payload.id);
      }
      const view = this.registry.views.get(siblingId);
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.send(TextToolApplyOp, payload);
      }
    }
  }

  private urlFor(tabId: string): string | null {
    const state = this.registry.states.get(tabId);
    return state?.kind === 'browser' ? state.url : null;
  }

  /** Finds which tab owns a `webContents` — same pattern as `CommentController.resolveTabId`. */
  private resolveTabId(sender: WebContents): string | undefined {
    for (const [tabId, view] of this.registry.views) {
      if (view.webContents === sender) {
        return tabId;
      }
    }
    return undefined;
  }

  private static toRecord(stored: StoredTextBox): TextBoxRecord {
    return {
      id: stored.id,
      quote: stored.quote,
      dx: stored.dx,
      dy: stored.dy,
      text: stored.text,
      size: stored.size,
      align: stored.align,
    };
  }

  /** The fields of an update op that changed a box; a position only comes along with a full anchor (`quote`, `dx`, `dy`). */
  private static toPatch(op: Extract<z.infer<typeof reportedOpSchema>, { kind: 'update' }>): TextBoxPatch {
    const patch: TextBoxPatch = { text: op.text, size: op.size, align: op.align };
    if (op.quote && op.dx !== undefined && op.dy !== undefined) {
      return { ...patch, quote: op.quote, dx: op.dx, dy: op.dy };
    }
    return patch;
  }

  private static toStored(box: TextBoxRecord, url: string): StoredTextBox {
    return { ...box, url, createdAt: Date.now() };
  }
}
