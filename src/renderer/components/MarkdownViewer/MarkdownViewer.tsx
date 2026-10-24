// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-24

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MARKDOWN_PRINT_GLOBAL, ZOOM_PERCENT_DEFAULT } from '@shared/constants';
import type { MarkdownFileData, MarkdownFormatAction, MarkdownToolState } from '@shared/ipc-contract';
import type { MarkdownDisplay, PointerMode } from '@shared/tab-state';
import { HAND_CLOSED_CURSOR, HAND_OPEN_CURSOR } from '@shared/handCursors';
import { slugifyHeading } from '@shared/markdown/parser';
import { toggleTask } from '@shared/markdown/source';
import {
  countCharacters,
  countSelection,
  extractHeadings,
  indentLevels,
  extractOutboundLinks,
  fileByteSize,
  wordIndexAt,
  wordStarts,
  type NoteHeading,
  type NoteLink,
} from '@shared/markdown/structure';
import { applyLink, toggleWrap, wrapInBlock } from '../../lib/markdown/editorFormat';
import { collectRenderedText, offsetOfPoint, rangeForOffsets, reanchorHighlight } from '../../lib/markdown/textOffsets';
import { commentCursor, highlighterCursor, penCursor } from '../../lib/toolCursors';
import {
  MarkdownAnnotationLayer,
  type NoteComment,
  type NotePoint,
  type NoteStroke,
} from './MarkdownAnnotationLayer';
import { MarkdownEditor } from './MarkdownEditor';
import { EditorContextMenu, LinkPopup } from './MarkdownEditorMenus';
import { MarkdownReader } from './MarkdownReader';
import { MarkdownSidePanel } from './MarkdownSidePanel';
import { MarkdownStatusBar } from './MarkdownStatusBar';
import { useMarkdownFind } from './useMarkdownFind';
import { useMarkdownPan } from './useMarkdownPan';
import { CONTENT_FADE_MS, useLoadBlur } from '../../hooks/useLoadBlur';
import { FluidBackground } from '../FluidBackground';
import { SidePanelToggle } from '../SidePanel';

/** Name registered with `CSS.highlights` for the user's highlights, painted by `markdown-viewer.css`. */
const HIGHLIGHT_NAME = 'northstar-md-highlight';

/** How long typing must pause before the note is written to disk. */
const SAVE_DEBOUNCE_MS = 250;

/** How many edits Ctrl+Z can step back through. */
const MAX_HISTORY = 200;

/** How far a press can travel (px) and still count as a click on a highlight rather than a drag-select. */
const CLICK_DRAG_THRESHOLD_PX = 4;

/** CSS pixels in one `em` at 100% zoom — the root font size the stylesheet scales from. */
const BASE_FONT_PX = 16;

/** A highlight: a stretch of the rendered text, with the words it covered so it can be found again after an edit. */
interface NoteHighlight {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

/** The undoable marks: what Ctrl+Z / Ctrl+Y step through (comments edit per keystroke, so they're left out). */
interface MarksSnapshot {
  readonly strokes: readonly NoteStroke[];
  readonly highlights: readonly NoteHighlight[];
}

const NO_STROKES: readonly NoteStroke[] = [];
const NO_HIGHLIGHTS: readonly NoteHighlight[] = [];

/** The part of the viewport a mark-making tool or the user's scrolling leaves alone: where the page's size is read from. */
interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The whole of `markdown.html`'s page: a note, a panel of its outline and
 * backlinks, and the marks drawn on it. The controls (New, Open, the
 * View/Edit and Raw/Formatted switches, the file name, Export) live in the
 * chrome's main toolbar (`MarkdownToolbar`); main pushes notes, the two
 * switches and the marking tool here.
 *
 * The two switches pick what shows. View + Formatted is the reader: the note
 * drawn in full (images, maths, runnable code), and the only place marks can
 * be made. Every other pairing is the editor: raw text (read-only in View),
 * or in Edit + Formatted the note formatted while being edited in place.
 *
 * The note's text lives here while it's being worked on: edits are saved to
 * main a moment after typing stops (and at once when leaving the editor, or
 * when the page is hidden), tagged with the generation of the note they
 * belong to so a late save can never land on a different note.
 *
 * Zoom is owned by main and arrives via `onZoom`; the page scales its root
 * font size, and everything inside is in `em`/`rem`, so text, the column and
 * the marks all scale together.
 */
export function MarkdownViewer() {
  const [hasNote, setHasNote] = useState(false);
  const [source, setSource] = useState('');
  const [noteKey, setNoteKey] = useState('');
  const [anchor, setAnchor] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [display, setDisplay] = useState<MarkdownDisplay>('formatted');
  const [printing, setPrinting] = useState(false);
  const [tool, setTool] = useState<MarkdownToolState>({ tool: 'none', color: { r: 26, g: 115, b: 232 } });
  /** The editor's caret, as an offset into the note; `null` while the reader is showing (it has no caret). */
  const [caret, setCaret] = useState<number | null>(null);
  /** The editor's selection (`from` before `to`), or `null` when nothing is selected in it. */
  const [editorSelection, setEditorSelection] = useState<{ readonly from: number; readonly to: number } | null>(null);
  /** The text selected in the reader (which has no offsets into the source), or `null`. */
  const [readerSelection, setReaderSelection] = useState<string | null>(null);
  const handleEditorSelection = useCallback((head: number, from: number, to: number): void => {
    setCaret(head);
    setEditorSelection(from === to ? null : { from, to });
  }, []);
  /** The note file's own line ending, so the status bar's byte count is the file's. */
  const [lineEnding, setLineEnding] = useState<'\n' | '\r\n'>('\n');
  const [panelOpen, setPanelOpen] = useState(false);
  // Ctrl+Alt+B (main's accelerator) shows or hides the panel too.
  useEffect(() => window.northstarMarkdown.onToggleSidePanel(() => setPanelOpen((open) => !open)), []);
  const [strokes, setStrokes] = useState<readonly NoteStroke[]>(NO_STROKES);
  const [comments, setComments] = useState<readonly NoteComment[]>([]);
  const [highlights, setHighlights] = useState<readonly NoteHighlight[]>(NO_HIGHLIGHTS);
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [contentSize, setContentSize] = useState<Size>({ width: 0, height: 0 });
  const [emPx, setEmPx] = useState(BASE_FONT_PX);
  /** Bumps whenever the drawn note changes, so the find bar and the highlights are recomputed against it. */
  const [renderVersion, setRenderVersion] = useState(0);
  const [, setSchemeTick] = useState(0);
  /** The editor's right-click menu while open, and the link box while open (with the range it will turn into a link). */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [linkBox, setLinkBox] = useState<{ x: number; y: number; from: number; to: number; label: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const readerHostRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const savedEditorStateRef = useRef<EditorState | null>(null);
  const generationRef = useRef(0);
  const sourceRef = useRef('');
  const pendingSaveRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const scrollRatioRef = useRef(0);
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  // Printing always draws the reader, whichever view is showing.
  const showReader = hasNote && ((mode === 'view' && display === 'formatted') || printing);
  const showEditor = hasNote && !showReader;

  // The tool cursors are drawn in light or dark ink to match the theme.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setSchemeTick((tick) => tick + 1);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // ── Saving ──

  const flushSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (pending !== null) {
      pendingSaveRef.current = null;
      window.northstarMarkdown.save(pending, generationRef.current);
    }
  }, []);

  const queueSave = useCallback(
    (content: string, immediately = false): void => {
      pendingSaveRef.current = content;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (immediately) {
        flushSave();
      } else {
        saveTimerRef.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
      }
    },
    [flushSave],
  );

  // Anything still waiting is written when the page is hidden or closed.
  useEffect(() => {
    const onHide = (): void => flushSave();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('blur', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('blur', onHide);
      flushSave();
    };
  }, [flushSave]);

  // ── Zoom ──

  useEffect(
    () =>
      window.northstarMarkdown.onZoom((percent) => {
        document.documentElement.style.fontSize = `${(BASE_FONT_PX * percent) / 100}px`;
        setEmPx((BASE_FONT_PX * percent) / 100);
      }),
    [],
  );
  useEffect(() => {
    document.documentElement.style.fontSize = `${(BASE_FONT_PX * ZOOM_PERCENT_DEFAULT) / 100}px`;
  }, []);

  // The marks are drawn against the note's own size.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return undefined;
    }
    const observer = new ResizeObserver(() => setContentSize({ width: el.offsetWidth, height: el.offsetHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [showReader]);

  // ── Notes arriving, closing, and the mode ──

  // Marks that came with the note are the baseline: loading them isn't an edit.
  const baselineRef = useRef<MarksSnapshot>({ strokes: NO_STROKES, highlights: NO_HIGHLIGHTS });
  const undoRef = useRef<MarksSnapshot[]>([]);
  const redoRef = useRef<MarksSnapshot[]>([]);
  const historyStartedRef = useRef(false);
  /** The note's marks have been loaded for this generation — saving before then would overwrite them with nothing. */
  const [marksLoadedFor, setMarksLoadedFor] = useState(0);
  /** Whether the note is fading away, having been closed; the timer that then clears it. */
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);
  /** Blurs the note while one opens, until it's on the page. */
  const { blurred: loadBlurred, start: startLoadBlur, finish: finishLoadBlur } = useLoadBlur();
  // The note is on the page once the render that brought it in has committed.
  useEffect(() => {
    if (noteKey) {
      finishLoadBlur();
    }
  }, [noteKey, finishLoadBlur]);

  const loadNote = useCallback(
    (file: MarkdownFileData): void => {
      // A note opened while the last one fades away replaces it at once.
      window.clearTimeout(closeTimerRef.current);
      setClosing(false);
      flushSave();
      const isNewNote = file.reason !== 'reload' || file.generation !== generationRef.current;
      generationRef.current = file.generation;
      sourceRef.current = file.content;
      setHasNote(true);
      setSource(file.content);
      setNoteKey(String(file.generation));
      setAnchor(file.anchor);
      setLineEnding(file.lineEnding);
      if (isNewNote) {
        startLoadBlur();
        savedEditorStateRef.current = null;
        scrollRatioRef.current = 0;
        undoRef.current = [];
        redoRef.current = [];
        const loadedStrokes = file.annotations.strokes;
        const loadedHighlights = file.annotations.highlights;
        baselineRef.current = { strokes: loadedStrokes, highlights: loadedHighlights };
        setStrokes(loadedStrokes);
        setHighlights(loadedHighlights);
        setComments(file.annotations.comments.map((comment) => ({ ...comment, committed: true })));
        setOpenCommentId(null);
      }
      setMarksLoadedFor(file.generation);
      // The same note changed on disk while its editor was open: put the new text in without losing the place.
      const view = editorViewRef.current;
      if (view && view.state.doc.toString() !== file.content) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: file.content } });
        pendingSaveRef.current = null;
      }
    },
    [flushSave, startLoadBlur],
  );
  useEffect(() => window.northstarMarkdown.onFile(loadNote), [loadNote]);

  useEffect(
    () =>
      window.northstarMarkdown.onClose(() => {
        flushSave();
        // The note fades away first, then the empty page takes its place.
        window.clearTimeout(closeTimerRef.current);
        setClosing(true);
        closeTimerRef.current = window.setTimeout(() => {
          setClosing(false);
          generationRef.current = 0;
          sourceRef.current = '';
          savedEditorStateRef.current = null;
          undoRef.current = [];
          redoRef.current = [];
          baselineRef.current = { strokes: NO_STROKES, highlights: NO_HIGHLIGHTS };
          setHasNote(false);
          setSource('');
          setNoteKey('');
          setStrokes(NO_STROKES);
          setHighlights(NO_HIGHLIGHTS);
          setComments([]);
          setOpenCommentId(null);
          setMarksLoadedFor(0);
        }, CONTENT_FADE_MS);
      }),
    [flushSave],
  );

  /** Notes how far down the note is scrolled, and writes any edit, before a switch changes what's showing. */
  const beforeSwitch = useCallback((): void => {
    const scroller = editorViewRef.current?.scrollDOM ?? scrollRef.current;
    if (scroller && scroller.scrollHeight > 0) {
      scrollRatioRef.current = scroller.scrollTop / scroller.scrollHeight;
    }
    flushSave();
  }, [flushSave]);

  useEffect(
    () =>
      window.northstarMarkdown.onMode((next) => {
        beforeSwitch();
        setMode(next);
      }),
    [beforeSwitch],
  );
  useEffect(
    () =>
      window.northstarMarkdown.onDisplay((next) => {
        beforeSwitch();
        setDisplay(next);
      }),
    [beforeSwitch],
  );

  // Coming back to the reader lands where the editor was (the editor starts where the reader was itself).
  useLayoutEffect(() => {
    if (showReader && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRatioRef.current * scrollRef.current.scrollHeight;
    }
  }, [showReader]);

  useEffect(() => window.northstarMarkdown.onTool(setTool), []);

  const [pointerMode, setPointerMode] = useState<PointerMode>('select');
  useEffect(() => window.northstarMarkdown.onPointerMode(setPointerMode), []);
  // The reader's selection, for the status bar's counts: whatever is selected inside the drawn note.
  useEffect(() => {
    const onSelectionChange = (): void => {
      const selection = window.getSelection();
      const host = readerHostRef.current;
      const inReader =
        selection !== null && !selection.isCollapsed && host !== null && host.contains(selection.anchorNode) && host.contains(selection.focusNode);
      setReaderSelection(inReader ? selection.toString() : null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  /** The window's Focus Mode: the stat bar hides with the chrome. */
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => window.northstarMarkdown.onFocusMode(setFocusMode), []);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pannerScroller = useCallback(
    (): HTMLElement | null => (showReader ? scrollRef.current : (editorViewRef.current?.scrollDOM ?? null)),
    [showReader],
  );
  const panEnabled = hasNote && pointerMode === 'pan' && tool.tool === 'none';
  const panning = useMarkdownPan({
    enabled: panEnabled,
    bodyRef,
    scrollerOf: pannerScroller,
  });

  // ── Printing (PDF export): the rendered note, whichever view is showing, at full length ──

  useEffect(() => {
    const globals = window as unknown as Record<string, unknown>;
    globals[MARKDOWN_PRINT_GLOBAL] = async (on: boolean): Promise<void> => {
      setPrinting(on);
      // Two frames for the layout to settle; then wait (briefly) for any picture still being read from disk.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const deadline = Date.now() + 3000;
      while (on && document.querySelector('.md-image--loading') && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
    };
    return () => {
      delete globals[MARKDOWN_PRINT_GLOBAL];
    };
  }, []);

  // ── Editing ──

  const handleEdit = useCallback(
    (next: string): void => {
      sourceRef.current = next;
      setSource(next);
      setRenderVersion((version) => version + 1);
      queueSave(next);
    },
    [queueSave],
  );

  const handleEditorView = useCallback((view: EditorView | null, finalState?: EditorState): void => {
    editorViewRef.current = view;
    if (view === null) {
      setCaret(null);
      setEditorSelection(null);
    }
    if (view === null && finalState) {
      savedEditorStateRef.current = finalState;
    }
    setRenderVersion((version) => version + 1);
  }, []);

  const handleToggleTask = useCallback(
    (index: number): void => {
      const next = toggleTask(sourceRef.current, index);
      if (next !== null) {
        sourceRef.current = next;
        setSource(next);
        queueSave(next, true);
      }
    },
    [queueSave],
  );

  const listNotes = useCallback(() => window.northstarMarkdown.listNotes(), []);

  /** Runs a formatting command on the editor — from a shortcut (via main) or the right-click menu. */
  const runFormat = useCallback((action: MarkdownFormatAction, at?: { x: number; y: number }): void => {
    const view = editorViewRef.current;
    if (!view) {
      return;
    }
    setMenu(null);
    if (action === 'bold') {
      toggleWrap(view, '**');
    } else if (action === 'italic') {
      toggleWrap(view, '*');
    } else if (action === 'latex') {
      wrapInBlock(view, '$$');
    } else if (action === 'code') {
      wrapInBlock(view, '```');
    } else {
      // The link box opens under the selection's end (or where the menu was), and remembers what to link.
      const { from, to, head } = view.state.selection.main;
      const coords = view.coordsAtPos(head);
      setLinkBox({
        x: at?.x ?? coords?.left ?? 80,
        y: at ? at.y : (coords?.bottom ?? 80) + 6,
        from,
        to,
        label: view.state.doc.sliceString(from, to),
      });
    }
  }, []);
  useEffect(() => window.northstarMarkdown.onFormat((action) => runFormat(action)), [runFormat]);
  // Leaving the editor closes whatever it opened.
  useEffect(() => {
    if (mode !== 'edit') {
      setMenu(null);
      setLinkBox(null);
    }
  }, [mode]);

  // ── Marks ──

  // Every edit to the marks is reported so main can persist it; an unsaved (uncommitted) comment isn't.
  useEffect(() => {
    if (marksLoadedFor === 0 || marksLoadedFor !== generationRef.current) {
      return;
    }
    window.northstarMarkdown.saveAnnotations(
      {
        strokes: strokes.map(({ id, points }) => ({ id, points: points.map(({ x, y }) => ({ x, y })) })),
        comments: comments.filter((c) => c.committed).map(({ id, x, y, text }) => ({ id, x, y, text })),
        highlights: highlights.map(({ id, start, end, quote }) => ({ id, start, end, quote })),
      },
      generationRef.current,
    );
  }, [marksLoadedFor, strokes, comments, highlights]);

  // Undo/redo of strokes and highlights, as snapshots. Any change to them that didn't come from undo/redo
  // or from loading a note is a user edit and pushes the previous state onto the undo stack.
  useEffect(() => {
    if (!historyStartedRef.current) {
      historyStartedRef.current = true;
      baselineRef.current = { strokes, highlights };
      return;
    }
    const baseline = baselineRef.current;
    if (strokes === baseline.strokes && highlights === baseline.highlights) {
      return;
    }
    undoRef.current.push(baseline);
    if (undoRef.current.length > MAX_HISTORY) {
      undoRef.current.shift();
    }
    redoRef.current = [];
    baselineRef.current = { strokes, highlights };
  }, [strokes, highlights]);

  const applySnapshot = useCallback((snapshot: MarksSnapshot): void => {
    baselineRef.current = snapshot;
    setStrokes(snapshot.strokes);
    setHighlights(snapshot.highlights);
  }, []);

  useEffect(
    () =>
      window.northstarMarkdown.onUndo(() => {
        const previous = undoRef.current.pop();
        if (previous) {
          redoRef.current.push(baselineRef.current);
          applySnapshot(previous);
        }
      }),
    [applySnapshot],
  );
  useEffect(
    () =>
      window.northstarMarkdown.onRedo(() => {
        const next = redoRef.current.pop();
        if (next) {
          undoRef.current.push(baselineRef.current);
          applySnapshot(next);
        }
      }),
    [applySnapshot],
  );

  // Revert Annotations.
  useEffect(
    () =>
      window.northstarMarkdown.onClear(() => {
        setStrokes(NO_STROKES);
        setComments([]);
        setHighlights(NO_HIGHLIGHTS);
        setOpenCommentId(null);
      }),
    [],
  );

  // A comment left unsaved when the tool turns off is kept if it has text and dropped if empty, as in the browser.
  const previousToolRef = useRef<MarkdownToolState['tool']>('none');
  useEffect(() => {
    if (previousToolRef.current === 'comment' && tool.tool !== 'comment') {
      setComments((previous) =>
        previous.filter((comment) => comment.committed || comment.text.trim() !== '').map((c) => ({ ...c, committed: true })),
      );
      setOpenCommentId(null);
    }
    previousToolRef.current = tool.tool;
  }, [tool.tool]);

  // Clicking away from an open comment (tool off) closes its box.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (tool.tool === 'comment' || !openCommentId) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`[data-comment-id="${CSS.escape(openCommentId)}"]`)) {
        setOpenCommentId(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [tool.tool, openCommentId]);

  // ── Highlights: painted from stored text ranges, re-found if the words moved ──

  useLayoutEffect(() => {
    const root = readerHostRef.current?.querySelector<HTMLElement>('.md-reader');
    if (!showReader || !root || highlights.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return;
    }
    const rendered = collectRenderedText(root);
    let moved = false;
    const anchored = highlights.map((highlight) => {
      const found = reanchorHighlight(rendered.text, highlight.start, highlight.end, highlight.quote);
      if (found && (found.start !== highlight.start || found.end !== highlight.end)) {
        moved = true;
        return { ...highlight, ...found };
      }
      return highlight;
    });
    const ranges = anchored
      .map((highlight) => rangeForOffsets(rendered, highlight.start, highlight.end))
      .filter((range): range is Range => range !== null);
    if (ranges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    } else {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
    if (moved) {
      // The words shifted (the note was edited): remember where they are now, as the baseline, not as an undoable edit.
      baselineRef.current = { strokes: baselineRef.current.strokes, highlights: anchored };
      setHighlights(anchored);
    }
  }, [showReader, highlights, renderVersion, source]);

  /** Turns the finished text selection into a highlight, merging with any it overlaps. */
  const commitSelectionAsHighlight = (): void => {
    const selection = window.getSelection();
    const root = readerHostRef.current?.querySelector<HTMLElement>('.md-reader');
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !root) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      return;
    }
    const rendered = collectRenderedText(root);
    const start = offsetOfPoint(rendered, range.startContainer, range.startOffset);
    const end = offsetOfPoint(rendered, range.endContainer, range.endOffset);
    selection.removeAllRanges();
    if (start === null || end === null || end <= start) {
      return;
    }
    const overlapping = highlights.filter((h) => h.start <= end && h.end >= start);
    const from = Math.min(start, ...overlapping.map((h) => h.start));
    const to = Math.max(end, ...overlapping.map((h) => h.end));
    const merged: NoteHighlight = { id: crypto.randomUUID(), start: from, end: to, quote: rendered.text.slice(from, to) };
    if (merged.quote.trim() === '') {
      return;
    }
    setHighlights((previous) => [...previous.filter((h) => !overlapping.includes(h)), merged]);
  };

  /** The highlight under a point of the screen, if any. */
  const highlightAt = (x: number, y: number): NoteHighlight | null => {
    const root = readerHostRef.current?.querySelector<HTMLElement>('.md-reader');
    const caret = document.caretRangeFromPoint(x, y);
    if (!root || !caret) {
      return null;
    }
    const rendered = collectRenderedText(root);
    const offset = offsetOfPoint(rendered, caret.startContainer, caret.startOffset);
    return offset === null ? null : (highlights.find((h) => h.start <= offset && offset < h.end) ?? null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button === 0 && tool.tool === 'highlighter') {
      pressRef.current = { x: event.clientX, y: event.clientY };
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (tool.tool !== 'highlighter') {
      return;
    }
    const press = pressRef.current;
    pressRef.current = null;
    const isClick = press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) < CLICK_DRAG_THRESHOLD_PX;
    const clicked = isClick ? highlightAt(event.clientX, event.clientY) : null;
    if (clicked) {
      // A click on an existing highlight removes it (there is no new selection to turn into one).
      setHighlights((previous) => previous.filter((h) => h.id !== clicked.id));
      window.getSelection()?.removeAllRanges();
    } else {
      commitSelectionAsHighlight();
    }
  };

  // ── The note's structure: what the side panel lists and the status bar counts, kept current with every edit ──

  const structure = useMemo(() => {
    const lineStarts = [0];
    for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) {
      lineStarts.push(at + 1);
    }
    return {
      headings: extractHeadings(source),
      links: extractOutboundLinks(source),
      wordStarts: wordStarts(source),
      lineStarts,
      characters: countCharacters(source),
      bytes: fileByteSize(source, lineEnding),
    };
  }, [source, lineEnding]);

  // Each line's indentation level, for the status bar's "indentations".
  const lineIndents = useMemo(() => indentLevels(source), [source]);

  // What's selected, counted for the status bar: from the source in the editor, from the drawn text in the reader.
  const selectedText =
    showEditor && editorSelection
      ? source.slice(editorSelection.from, Math.min(editorSelection.to, source.length))
      : !showEditor
        ? readerSelection
        : null;
  const selectionStats = selectedText ? countSelection(selectedText) : null;

  // Where the caret is, as the status bar shows it; nothing while the reader (which has no caret) is showing.
  const caretAt = showEditor && caret !== null ? Math.min(caret, source.length) : null;
  let caretLine: number | null = null;
  if (caretAt !== null) {
    let low = 0;
    let high = structure.lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (structure.lineStarts[middle]! <= caretAt) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    caretLine = low + 1;
  }
  const caretColumn = caretAt !== null && caretLine !== null ? caretAt - structure.lineStarts[caretLine - 1]! + 1 : null;
  const caretWord = caretAt !== null ? wordIndexAt(structure.wordStarts, caretAt) : null;

  /** Puts the editor's caret at an offset and scrolls it into view; the editor takes the keyboard when it can be edited. */
  const jumpTo = useCallback(
    (offset: number, y: 'center' | 'start' = 'center'): void => {
      const view = editorViewRef.current;
      if (!view) {
        return;
      }
      const at = Math.max(0, Math.min(offset, view.state.doc.length));
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y }) });
      if (mode === 'edit') {
        view.focus();
      }
    },
    [mode],
  );

  const goToLine = useCallback(
    (line: number): void => {
      const view = editorViewRef.current;
      if (view) {
        jumpTo(view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).from);
      }
    },
    [jumpTo],
  );

  const goToColumn = useCallback(
    (column: number): void => {
      const view = editorViewRef.current;
      if (view) {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        jumpTo(line.from + Math.max(0, Math.min(column - 1, line.length)));
      }
    },
    [jumpTo],
  );

  const goToWord = useCallback(
    (word: number): void => {
      const starts = structure.wordStarts;
      if (starts.length > 0) {
        jumpTo(starts[Math.max(1, Math.min(word, starts.length)) - 1]!);
      }
    },
    [jumpTo, structure],
  );

  /** Brings a heading into view: in the reader by finding it among the drawn headings, in the editor by its line. */
  const goToHeading = useCallback(
    (heading: NoteHeading, index: number): void => {
      if (!showReader) {
        const view = editorViewRef.current;
        if (view) {
          jumpTo(view.state.doc.line(Math.min(heading.line, view.state.doc.lines)).from, 'start');
        }
        return;
      }
      // The same words can head more than one section: take the one with as many namesakes before it.
      const slug = slugifyHeading(heading.text);
      const namesakesBefore = structure.headings.slice(0, index).filter((h) => slugifyHeading(h.text) === slug).length;
      const drawn = Array.from(readerHostRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []).filter(
        (element) => slugifyHeading(element.textContent ?? '') === slug,
      );
      (drawn[namesakesBefore] ?? drawn[0])?.scrollIntoView({ block: 'start' });
    },
    [showReader, jumpTo, structure],
  );

  /** Follows a link from the panel: a link to a heading of this note goes there; any other is opened as the reader would. */
  const openOutboundLink = useCallback(
    (link: NoteLink, newTab: boolean): void => {
      if (link.target.startsWith('#')) {
        const name = link.kind === 'link' ? decodeURIComponent(link.target.slice(1)) : link.target.slice(1);
        const slug = slugifyHeading(name);
        const index = structure.headings.findIndex((heading) => slugifyHeading(heading.text) === slug);
        if (index !== -1) {
          goToHeading(structure.headings[index]!, index);
        }
        return;
      }
      void window.northstarMarkdown.openLink(link.kind, link.target, newTab);
    },
    [goToHeading, structure],
  );

  useMarkdownFind({
    mode: showReader ? 'view' : 'edit',
    hasNote,
    readerHostRef,
    editorViewRef,
    scrollRef,
    contentVersion: renderVersion,
  });

  const toolCursor =
    tool.tool === 'pen'
      ? penCursor()
      : tool.tool === 'highlighter'
        ? highlighterCursor()
        : tool.tool === 'comment'
          ? commentCursor(tool.color)
          : undefined;
  const { r, g, b } = tool.color;
  const toolOn = tool.tool !== 'none';

  return (
    <div
      className="md-viewer"
      data-printing={printing ? 'true' : undefined}
      data-mode={mode}
      data-display={display}
      data-pan={panEnabled ? (panning ? 'grabbing' : 'ready') : undefined}
      style={
        panEnabled
          ? ({ '--md-hand-cursor': panning ? HAND_CLOSED_CURSOR : HAND_OPEN_CURSOR } as CSSProperties)
          : undefined
      }
    >
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(${r}, ${g}, ${b}, 0.55); }`}</style>
      {!hasNote ? (
        <div className="md-viewer__empty">
          <FluidBackground />
        </div>
      ) : (
        <>
          {/* The note and its panel side by side, over the status bar. */}
          <div ref={bodyRef} className={`md-viewer__body load-blur${loadBlurred ? ' load-blur--on' : ''}${closing ? ' content-fading' : ''}`}>
            {showEditor && (
              <div className="md-viewer__editor">
                <MarkdownEditor
                  key={noteKey}
                  initialSource={source}
                  savedState={savedEditorStateRef.current}
                  onChange={handleEdit}
                  onView={handleEditorView}
                  listNotes={listNotes}
                  // Read-only text has nothing to format.
                  onContextMenu={(x, y) => {
                    if (mode === 'edit') {
                      setMenu({ x, y });
                    }
                  }}
                  initialScroll={scrollRatioRef.current}
                  readOnly={mode === 'view'}
                  livePreview={display === 'formatted'}
                  onSelection={handleEditorSelection}
                />
              </div>
            )}
            {showReader && (
              <div
                ref={scrollRef}
                className="md-viewer__scroll"
                data-tool={tool.tool}
                style={toolCursor ? ({ '--md-tool-cursor': toolCursor } as CSSProperties) : undefined}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
              >
                <div ref={contentRef} className="md-viewer__content">
                  <div ref={readerHostRef} className="md-viewer__reader-host">
                    <MarkdownReader
                      source={source}
                      noteKey={noteKey}
                      scrollRef={scrollRef}
                      anchor={anchor}
                      toolActive={toolOn}
                      onRendered={() => setRenderVersion((version) => version + 1)}
                      onToggleTask={handleToggleTask}
                    />
                  </div>
                  <MarkdownAnnotationLayer
                    tool={tool.tool}
                    color={tool.color}
                    strokes={strokes}
                    comments={comments}
                    openCommentId={openCommentId}
                    width={contentSize.width}
                    height={contentSize.height}
                    emPx={emPx}
                    onAddStroke={(points: readonly NotePoint[]) =>
                      setStrokes((previous) => [...previous, { id: crypto.randomUUID(), points }])
                    }
                    onRemoveStroke={(id) => setStrokes((previous) => previous.filter((s) => s.id !== id))}
                    onAddComment={(point) => {
                      const id = crypto.randomUUID();
                      setComments((previous) => [...previous, { id, x: point.x, y: point.y, text: '', committed: false }]);
                      return id;
                    }}
                    onChangeComment={(id, text) =>
                      setComments((previous) => previous.map((c) => (c.id === id ? { ...c, text } : c)))
                    }
                    onCommitComment={(id) =>
                      setComments((previous) =>
                        previous.flatMap((c) => (c.id !== id ? [c] : c.text.trim() === '' ? [] : [{ ...c, committed: true }])),
                      )
                    }
                    onRemoveComment={(id) => {
                      setComments((previous) => previous.filter((c) => c.id !== id));
                      setOpenCommentId((current) => (current === id ? null : current));
                    }}
                    onToggleComment={(id) => setOpenCommentId((current) => (current === id ? null : id))}
                  />
                </div>
              </div>
            )}
            {menu && mode === 'edit' && (
              <EditorContextMenu x={menu.x} y={menu.y} onPick={(action) => runFormat(action, menu)} onClose={() => setMenu(null)} />
            )}
            {linkBox && mode === 'edit' && (
              <LinkPopup
                x={linkBox.x}
                y={linkBox.y}
                label={linkBox.label}
                listNotes={listNotes}
                onSubmit={(target) => {
                  const view = editorViewRef.current;
                  if (view) {
                    applyLink(view, linkBox.from, linkBox.to, target);
                  }
                  setLinkBox(null);
                }}
                onCancel={() => {
                  setLinkBox(null);
                  editorViewRef.current?.focus();
                }}
              />
            )}
            {!printing && (
              <>
                <SidePanelToggle open={panelOpen} what="outline and links" onToggle={() => setPanelOpen((open) => !open)} />
                {panelOpen && (
                  <MarkdownSidePanel
                    headings={structure.headings}
                    links={structure.links}
                    noteKey={noteKey}
                    onGoToHeading={goToHeading}
                    onOpenLink={openOutboundLink}
                  />
                )}
              </>
            )}
          </div>
          {!printing && !focusMode && (
            <MarkdownStatusBar
              line={caretLine}
              lineCount={structure.lineStarts.length}
              column={caretColumn}
              word={caretWord}
              wordCount={structure.wordStarts.length}
              indent={caretLine === null ? null : (lineIndents[caretLine - 1] ?? 0)}
              indentMax={lineIndents.reduce((deepest, level) => Math.max(deepest, level), 0)}
              characters={structure.characters}
              links={structure.links.length}
              selection={selectionStats}
              onGoToLine={goToLine}
              onGoToColumn={goToColumn}
              onGoToWord={goToWord}
            />
          )}
        </>
      )}
    </div>
  );
}
