// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { z } from 'zod';
import { HISTORY_UNIT_LIMITS } from './constants';
import {
  MAX_SECRET_ELEMENT_CHARS,
  MAX_SECRET_NAME_CHARS,
  MAX_SECRET_SOURCE_CHARS,
  MAX_SECRET_VALUE_CHARS,
} from './secrets';
import { isWorkspaceIconId } from './workspaceIcons';

// Every ipcMain.handle validates its payload against one of these before
// acting on it — the renderer is untrusted, even though it's our own code.
//
// Split out of ipc-contract.ts: this is the only file in `@shared` that
// pulls in `zod`, and it's imported by main only. Preload also imports
// from ipc-contract.ts, but runs inside Electron's sandbox, where a
// require() of an arbitrary node_modules package (zod included) fails —
// keeping the dependency out of ipc-contract.ts keeps it out of preload's
// bundle.

export const createTabRequestSchema = z.object({
  url: z.string().min(1).optional(),
});
export type CreateTabRequest = z.infer<typeof createTabRequestSchema>;

export const tabIdRequestSchema = z.object({
  id: z.string().min(1),
});
export type TabIdRequest = z.infer<typeof tabIdRequestSchema>;

/** A PDF tab's new display name; must end in `.pdf` (case-insensitive) with something before it. */
export const pdfRenameRequestSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(5)
    .max(255)
    .regex(/\.pdf$/i),
});
const pageNumberSchema = z.number().int().min(1).max(100000);
const unitSchema = z.number().min(0).max(1);
/** Same range as `TEXT_BOX_FONT_SIZE_MIN`/`MAX` in `constants.ts`, repeated because a zod literal can't read them back. */
const textBoxFontSizeSchema = z.number().int().min(8).max(48);
const textBoxAlignSchema = z.enum(['left', 'center', 'right']).default('left');

/**
 * Everything drawn on one PDF in this app (never written into the file):
 * coordinates are fractions of a page's width/height, so they hold at any
 * zoom. Size caps keep a misbehaving page from filling the user's disk.
 */
export const pdfAnnotationsSchema = z.object({
  strokes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        page: pageNumberSchema,
        points: z.array(z.object({ x: unitSchema, y: unitSchema })).min(2).max(5000),
      }),
    )
    .max(5000),
  comments: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        page: pageNumberSchema,
        x: unitSchema,
        y: unitSchema,
        text: z.string().max(5000),
      }),
    )
    .max(2000),
  highlights: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        page: pageNumberSchema,
        rects: z
          .array(z.object({ x: unitSchema, y: unitSchema, w: unitSchema, h: unitSchema }))
          .min(1)
          .max(2000),
      }),
    )
    .max(10000),
  /**
   * Text boxes. `size` is the font size in PDF points (what the export draws
   * with); defaulted so stores written before the text tool still parse.
   */
  textBoxes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        page: pageNumberSchema,
        x: unitSchema,
        y: unitSchema,
        text: z.string().min(1).max(10000),
        size: textBoxFontSizeSchema,
        /** Defaulted so boxes saved before alignment existed still parse. */
        align: textBoxAlignSchema,
      }),
    )
    .max(2000)
    .default([]),
  /**
   * Crop boxes, at most one per page, as fractions of the page as displayed.
   * Applied only to exports; defaulted so stores written before the crop tool still parse.
   */
  crops: z
    .array(
      z.object({
        page: pageNumberSchema,
        x: unitSchema,
        y: unitSchema,
        w: unitSchema,
        h: unitSchema,
      }),
    )
    .max(100000)
    .default([]),
  /**
   * The side panel's sections as the user edited them: a name, the page it starts on, and how deep it sits under
   * the ones above. `null` while they're as read from the file (its outline, or else its headings); defaulted so
   * stores written before sections could be edited still parse.
   */
  sections: z
    .array(
      z.object({
        title: z.string().max(500),
        page: pageNumberSchema,
        level: z.number().int().min(0).max(5).default(0),
      }),
    )
    .max(5000)
    .nullable()
    .default(null),
});
export type PdfAnnotations = z.infer<typeof pdfAnnotationsSchema>;

export const pdfSaveAnnotationsRequestSchema = z.object({
  /** SHA-256 of the document's bytes, hex. */
  key: z.string().regex(/^[0-9a-f]{64}$/),
  annotations: pdfAnnotationsSchema,
});

export const addPdfBookmarkRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(255),
});

export const findSetRequestSchema = z.object({
  enabled: z.boolean(),
});

export const findOptionsSchema = z.object({
  matchCase: z.boolean(),
  wholeWord: z.boolean(),
  regex: z.boolean(),
});

/** From the find bar's own page — a query is bounded so a runaway page can't hand main an enormous string. */
export const findInputRequestSchema = z.object({
  query: z.string().max(1000),
  options: findOptionsSchema,
});

export const findStepRequestSchema = z.union([z.literal(1), z.literal(-1)]);

export const findGotoRequestSchema = z.number().int().min(0).max(1_000_000);

/** From a tab's own page — what it found, bounded like everything else a page sends. */
export const findResultRequestSchema = z.object({
  index: z.number().int().min(0).max(1_000_000),
  total: z.number().int().min(0).max(1_000_000),
  capped: z.boolean(),
  invalid: z.boolean(),
});

export const historyDeleteRequestSchema = z.object({
  id: z.string().min(1).max(64),
});

/** "All time", or the last N of a unit — N within the same range the History tab's number box offers. */
export const historyClearRequestSchema = z.union([
  z.object({ unit: z.literal('all') }),
  z
    .object({
      unit: z.enum(['hours', 'days', 'weeks', 'months']),
      amount: z.number().int().min(1),
    })
    .refine((range) => range.amount <= HISTORY_UNIT_LIMITS[range.unit], { message: 'amount out of range' }),
]);

export const renameWorkspaceImageRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
});

export const historySetRangeRequestSchema = z.object({
  id: z.string().min(1),
  range: historyClearRequestSchema,
});

export const historyQueryRequestSchema = z.object({
  id: z.string().min(1),
  query: z.string().max(500),
});

export const bookmarksSetModeRequestSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['view', 'edit']),
});

/** A Bookmarks page's edit of one bookmark. Bounded like the stores they land in; main checks the rest (`BookmarkStore.update`). */
export const bookmarkUpdateRequestSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(500),
  reference: z.string().max(4096),
});

/** A Secrets page's edit of one secret. Bounded like the store they land in; main checks the rest (`SecretStore.update`). */
export const secretUpdateRequestSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(MAX_SECRET_NAME_CHARS),
  source: z.string().max(MAX_SECRET_SOURCE_CHARS),
  secret: z.string().max(MAX_SECRET_VALUE_CHARS),
});

/** A Secrets page's secret typed in by hand. Bounded like an edit; main checks the rest (`SecretStore.add`). */
export const secretAddRequestSchema = z.object({
  name: z.string().max(MAX_SECRET_NAME_CHARS),
  source: z.string().max(MAX_SECRET_SOURCE_CHARS),
  element: z.string().max(MAX_SECRET_ELEMENT_CHARS),
  secret: z.string().max(MAX_SECRET_VALUE_CHARS),
});

export const secretIdRequestSchema = z.object({
  id: z.string().min(1).max(64),
});

/** One field of a login a web page reports. A page is untrusted: everything is bounded, and an empty value is no field. */
const capturedSecretFieldSchema = z.object({
  value: z.string().min(1).max(MAX_SECRET_VALUE_CHARS),
  element: z.string().min(1).max(MAX_SECRET_ELEMENT_CHARS),
});

/** A login a web page reports as it's sent (`tabSecrets.ts`). Which page it's for main reads from the sender, never from here. */
export const capturedLoginSchema = z.object({
  username: capturedSecretFieldSchema.nullable(),
  password: capturedSecretFieldSchema,
});

/** The save prompt's answer. Names are bounded and trimmed; an accepted one needs both. */
export const secretPromptAnswerSchema = z.discriminatedUnion('accept', [
  z.object({
    id: z.string().min(1).max(64),
    accept: z.literal(true),
    usernameName: z.string().trim().min(1).max(MAX_SECRET_NAME_CHARS),
    passwordName: z.string().trim().min(1).max(MAX_SECRET_NAME_CHARS),
  }),
  z.object({ id: z.string().min(1).max(64), accept: z.literal(false) }),
]);

export const historySearchRequestSchema = z.object({
  type: z.enum(['url', 'pdf', 'markdown']),
  query: z.string().max(500),
});

export const pdfOpenPathRequestSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1).max(4096),
});

export const pdfOpenBookmarkRequestSchema = z.object({
  id: z.string().min(1),
  bookmarkId: z.string().min(1),
});

export const pdfGoToPageRequestSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().min(1).max(1_000_000),
});

/** A tab's page asking for a pan's pointer wrap; the tab is the sender, so only the point comes along. */
const pageCount = z.number().int().min(0).max(100_000_000);

export const pageStatsSchema = z.object({
  words: pageCount,
  characters: pageCount,
  images: pageCount,
  links: pageCount,
  bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  elements: pageCount,
  hovered: z.string().max(200).nullable(),
  focused: z.string().max(200).nullable(),
  pointer: z
    .object({ x: z.number().int().min(-100_000).max(100_000), y: z.number().int().min(-100_000).max(100_000) })
    .nullable(),
  selection: z.object({ words: pageCount, characters: pageCount }).nullable(),
});

export const tabWarpPointerRequestSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
});

export const pointerModeRequestSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['pan', 'select']),
});

export const pdfWarpPointerRequestSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
});

export const pdfOpenLinkRequestSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1).max(8192),
});

export const pdfOpenBacklinkRequestSchema = z.object({
  id: z.string().min(1),
  target: z.string().min(1).max(4096),
});

export const pdfHistoryInfoRequestSchema = z.object({
  id: z.string().min(1),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
});

export const pdfPageInfoRequestSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().min(1).max(1_000_000),
  pageCount: z.number().int().min(0).max(1_000_000),
});

export type PdfRenameRequest = z.infer<typeof pdfRenameRequestSchema>;

// ── Markdown tabs ─────────────────────────────────────────────────────────

/** A Markdown tab's new file name; must end in `.md` or `.markdown` with something before it. */
export const markdownRenameRequestSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(4)
    .max(255)
    .regex(/.\.(md|markdown)$/i),
});

/** Largest note a page may send back to be saved — a note is text; this is generous and still bounded. */
export const MARKDOWN_MAX_CONTENT_CHARS = 20_000_000;

export const markdownSaveRequestSchema = z.object({
  id: z.string().min(1),
  content: z.string().max(MARKDOWN_MAX_CONTENT_CHARS),
  generation: z.number().int().min(0),
});

const emAcrossSchema = z.number().min(-1000).max(1000);
const emDownSchema = z.number().min(0).max(1_000_000);

/**
 * Everything drawn on one Markdown note in this app (never written into the
 * note). Strokes and comment pins sit in `em`s — `x` from the note column's
 * center, `y` from its top — so they follow the text across window widths and
 * zoom levels; a highlight is a character range of the rendered text, with
 * the words it covered so it can be found again after the note is edited.
 */
export const markdownAnnotationsSchema = z.object({
  strokes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        points: z.array(z.object({ x: emAcrossSchema, y: emDownSchema })).min(2).max(5000),
      }),
    )
    .max(5000),
  comments: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        x: emAcrossSchema,
        y: emDownSchema,
        text: z.string().max(5000),
      }),
    )
    .max(2000),
  highlights: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        start: z.number().int().min(0).max(100_000_000),
        end: z.number().int().min(0).max(100_000_000),
        quote: z.string().max(5000),
      }),
    )
    .max(10000),
});
export type MarkdownAnnotations = z.infer<typeof markdownAnnotationsSchema>;

export const markdownSaveAnnotationsRequestSchema = z.object({
  id: z.string().min(1),
  annotations: markdownAnnotationsSchema,
  generation: z.number().int().min(0),
});

export const markdownModeRequestSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['view', 'edit']),
});

export const markdownDisplayRequestSchema = z.object({
  id: z.string().min(1),
  display: z.enum(['formatted', 'raw']),
});

/** A link clicked in a note: a `[[wikilink]]` (its text inside the brackets) or an ordinary link's target. */
export const markdownOpenLinkRequestSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['wiki', 'link']),
  target: z.string().min(1).max(2048),
  newTab: z.boolean(),
});

export const markdownResolveLinksRequestSchema = z.object({
  id: z.string().min(1),
  names: z.array(z.string().min(1).max(2048)).max(1000),
});

export const markdownReadImageRequestSchema = z.object({
  id: z.string().min(1),
  src: z.string().min(1).max(2048),
});

export const markdownReadRemoteImageRequestSchema = z.object({
  id: z.string().min(1),
  url: z
    .string()
    .max(2048)
    .refine((value) => /^https:\/\//i.test(value), 'Only https: pictures are fetched'),
});

export const markdownRunCodeRequestSchema = z.object({
  id: z.string().min(1),
  /** Which fenced code block of the note, counting from 0 in reading order. */
  index: z.number().int().min(0).max(100_000),
});

export const markdownExportRequestSchema = z.object({
  id: z.string().min(1),
  format: z.enum(['pdf', 'md', 'txt']),
});

export const markdownNavigateHistoryRequestSchema = z.object({
  id: z.string().min(1),
  direction: z.union([z.literal(1), z.literal(-1)]),
});

export const moveTabRequestSchema = z.object({
  id: z.string().min(1),
  beforeId: z.string().min(1).nullable(),
});
export type MoveTabRequest = z.infer<typeof moveTabRequestSchema>;

export const moveTabToWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
});
export type MoveTabToWorkspaceRequest = z.infer<typeof moveTabToWorkspaceRequestSchema>;

export const tearOffTabRequestSchema = z.object({
  id: z.string().min(1),
  screenX: z.number(),
  screenY: z.number(),
  // True when sent mid-drag, the moment the cursor leaves the window (the new
  // window then follows the cursor until `TabsTearOffEnd`), rather than on release.
  live: z.boolean().optional(),
});
export const tearOffTabEndRequestSchema = z.object({
  id: z.string().min(1),
  accepted: z.boolean(),
});

export const dropRegionsRequestSchema = z.object({
  rects: z
    .array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }))
    .max(200),
});

export type TearOffTabRequest = z.infer<typeof tearOffTabRequestSchema>;

export const navigateRequestSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
});
export type NavigateRequest = z.infer<typeof navigateRequestSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const workspaceIdRequestSchema = z.object({
  id: z.string().min(1),
});
export type WorkspaceIdRequest = z.infer<typeof workspaceIdRequestSchema>;

export const createWorkspaceWithTabRequestSchema = z.object({
  tabId: z.string().min(1),
});
export type CreateWorkspaceWithTabRequest = z.infer<typeof createWorkspaceWithTabRequestSchema>;

export const renameWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type RenameWorkspaceRequest = z.infer<typeof renameWorkspaceRequestSchema>;

export const moveWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
  beforeId: z.string().min(1).nullable(),
});
export type MoveWorkspaceRequest = z.infer<typeof moveWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().refine(isWorkspaceIconId),
});
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

export const addBookmarkRequestSchema = z.object({
  title: z.string(),
  url: z.string().min(1),
});
export type AddBookmarkRequest = z.infer<typeof addBookmarkRequestSchema>;

export const bookmarkIdRequestSchema = z.object({
  id: z.string().min(1),
});
export type BookmarkIdRequest = z.infer<typeof bookmarkIdRequestSchema>;

export const splitEnterRequestSchema = z.object({
  secondaryId: z.string().min(1),
});
export type SplitEnterRequest = z.infer<typeof splitEnterRequestSchema>;

export const focusModeRequestSchema = z.object({
  enabled: z.boolean(),
});
export type FocusModeRequest = z.infer<typeof focusModeRequestSchema>;

export const laserPointerRequestSchema = z.object({
  enabled: z.boolean(),
});
export type LaserPointerRequest = z.infer<typeof laserPointerRequestSchema>;

export const highlighterRequestSchema = z.object({
  enabled: z.boolean(),
});
export type HighlighterRequest = z.infer<typeof highlighterRequestSchema>;

export const commentToolRequestSchema = z.object({
  enabled: z.boolean(),
});
export type CommentToolRequest = z.infer<typeof commentToolRequestSchema>;

export const textToolRequestSchema = z.object({
  enabled: z.boolean(),
});
export type TextToolRequest = z.infer<typeof textToolRequestSchema>;

export const penRequestSchema = z.object({
  enabled: z.boolean(),
});
export type PenRequest = z.infer<typeof penRequestSchema>;

export const cropRequestSchema = z.object({
  enabled: z.boolean(),
});
export type CropRequest = z.infer<typeof cropRequestSchema>;

// Deliberately not `.min(25).max(200)` here — `TabManager.setZoom` clamps
// to that range itself, the same as `zoomIn`/`zoomOut` clamp their own
// step, so an out-of-range value here isn't a malformed request, just one
// that lands on a clamped result instead of a rejection.
export const zoomSetRequestSchema = z.object({
  percent: z.number(),
});
export type ZoomSetRequest = z.infer<typeof zoomSetRequestSchema>;

export const terminalInputRequestSchema = z.object({
  id: z.string().min(1),
  data: z.string(),
});
export type TerminalInputRequest = z.infer<typeof terminalInputRequestSchema>;

export const terminalResizeRequestSchema = z.object({
  id: z.string().min(1),
  // Capped well past any real screen: an absurd grid size would make the pty allocate (or fail) needlessly.
  cols: z.number().int().positive().max(2000),
  rows: z.number().int().positive().max(1000),
});
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;

export const addressSuggestionsSyncRequestSchema = z.object({
  // Without this the schema would strip it: the overlay would never learn it's drawing a menu.
  variant: z.enum(['bookmarks', 'menu']).optional(),
  open: z.boolean(),
  rect: z
    .object({
      top: z.number(),
      left: z.number(),
      width: z.number(),
    })
    .nullable(),
  suggestions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      kind: z.enum(['bookmark', 'history']).optional(),
    }),
  ),
  selectedIndex: z.number().int().nonnegative(),
});
export type AddressSuggestionsSyncRequest = z.infer<typeof addressSuggestionsSyncRequestSchema>;

export const addressSuggestionSelectRequestSchema = z.number().int().nonnegative();

export const tooltipSyncRequestSchema = z.object({
  visible: z.boolean(),
  text: z.string(),
  rect: z
    .object({
      top: z.number(),
      left: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable(),
});
export type TooltipSyncRequest = z.infer<typeof tooltipSyncRequestSchema>;

export const rgbSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});

export const colorPickerSyncRequestSchema = z.object({
  open: z.boolean(),
  rect: z
    .object({
      top: z.number(),
      left: z.number(),
    })
    .nullable(),
  accent: rgbSchema,
  recentColors: z.array(rgbSchema),
});
export type ColorPickerSyncRequest = z.infer<typeof colorPickerSyncRequestSchema>;

export const colorPickerColorChangeRequestSchema = z.object({
  rgb: rgbSchema,
  commit: z.boolean(),
});

export const zoomWheelRequestSchema = z.object({
  direction: z.union([z.literal(1), z.literal(-1)]),
  /** Shift was held: the coarse step. */
  coarse: z.boolean().optional(),
});

export const exportMenuSyncRequestSchema = z.object({
  open: z.boolean(),
  rect: z.object({ top: z.number(), left: z.number() }).nullable(),
  canExportDocuments: z.boolean(),
  /** Defaulted so a sync from before Markdown tabs existed still parses. */
  markdown: z.boolean().default(false),
});

export const exportMenuSelectRequestSchema = z.object({
  action: z.enum(['pdf', 'documents', 'markdown', 'text']),
});

export const themeSetRequestSchema = z.object({
  theme: z.enum(['light', 'dark']),
});
export type ThemeSetRequest = z.infer<typeof themeSetRequestSchema>;

export const adBlockSetEnabledRequestSchema = z.object({ enabled: z.boolean() });

export const adBlockSetSiteAllowedRequestSchema = z.object({
  host: z.string().min(1).max(253),
  allowed: z.boolean(),
});
export type AdBlockSetSiteAllowedRequest = z.infer<typeof adBlockSetSiteAllowedRequestSchema>;

/** The chrome's word that a sidebar-slide snapshot is on screen (`ContentSnapshotShown`). */
export const contentSnapshotShownRequestSchema = z.object({ id: z.number().int().positive() });
