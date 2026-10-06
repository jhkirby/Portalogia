// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { MARKDOWN_PRINT_GLOBAL, ZOOM_PERCENT_DEFAULT } from '@shared/constants';
import type { MarkdownFileData, MarkdownFormatAction, MarkdownToolState } from '@shared/ipc-contract';
import { toggleTask } from '@shared/markdown/source';
import type { OutlineEntry } from '../../lib/markdown/enhance';
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
import { useMarkdownFind } from './useMarkdownFind';

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
 * The whole of `markdown.html`'s page: a note drawn (or its source in an
 * editor), a panel of its outline and backlinks, and the marks drawn on it.
 * The controls (New, Open, the view/edit switch, the file name, Export) live
 * in the chrome's main toolbar (`MarkdownToolbar`); main pushes notes, the
 * mode and the marking tool here.
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
  const [printing, setPrinting] = useState(false);
  const [tool, setTool] = useState<MarkdownToolState>({ tool: 'none', color: { r: 26, g: 115, b: 232 } });
  const [outline, setOutline] = useState<readonly OutlineEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
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
  }, [hasNote, mode]);

  // ── Notes arriving, closing, and the mode ──

  // Marks that came with the note are the baseline: loading them isn't an edit.
  const baselineRef = useRef<MarksSnapshot>({ strokes: NO_STROKES, highlights: NO_HIGHLIGHTS });
  const undoRef = useRef<MarksSnapshot[]>([]);
  const redoRef = useRef<MarksSnapshot[]>([]);
  const historyStartedRef = useRef(false);
  /** The note's marks have been loaded for this generation — saving before then would overwrite them with nothing. */
  const [marksLoadedFor, setMarksLoadedFor] = useState(0);

  const loadNote = useCallback(
    (file: MarkdownFileData): void => {
      flushSave();
      const isNewNote = file.reason !== 'reload' || file.generation !== generationRef.current;
      generationRef.current = file.generation;
      sourceRef.current = file.content;
      setHasNote(true);
      setSource(file.content);
      setNoteKey(String(file.generation));
      setAnchor(file.anchor);
      if (isNewNote) {
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
    [flushSave],
  );
  useEffect(() => window.northstarMarkdown.onFile(loadNote), [loadNote]);

  useEffect(
    () =>
      window.northstarMarkdown.onClose(() => {
        flushSave();
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
        setOutline([]);
        setMarksLoadedFor(0);
      }),
    [flushSave],
  );

  useEffect(
    () =>
      window.northstarMarkdown.onMode((next) => {
        const scroller = editorViewRef.current?.scrollDOM ?? scrollRef.current;
        if (scroller && scroller.scrollHeight > 0) {
          scrollRatioRef.current = scroller.scrollTop / scroller.scrollHeight;
        }
        flushSave();
        setMode(next);
      }),
    [flushSave],
  );

  // Coming back to the rendered note lands where the editor was, and the other way round.
  useLayoutEffect(() => {
    if (mode === 'view' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRatioRef.current * scrollRef.current.scrollHeight;
    }
  }, [mode, hasNote]);

  useEffect(() => window.northstarMarkdown.onTool(setTool), []);

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

  const showReader = hasNote && (mode === 'view' || printing);

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

  const goToHeading = useCallback((id: string): void => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  useMarkdownFind({
    mode: printing ? 'view' : mode,
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
    <div className="md-viewer" data-printing={printing ? 'true' : undefined} data-mode={mode}>
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(${r}, ${g}, ${b}, 0.55); }`}</style>
      {!hasNote ? (
        <div className="md-viewer__empty" />
      ) : (
        <>
          {mode === 'edit' && !printing && (
            <div className="md-viewer__editor">
              <MarkdownEditor
                key={noteKey}
                initialSource={source}
                savedState={savedEditorStateRef.current}
                onChange={handleEdit}
                onView={handleEditorView}
                listNotes={listNotes}
                onContextMenu={(x, y) => setMenu({ x, y })}
                initialScroll={scrollRatioRef.current}
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
                    onRendered={(entries) => {
                      setOutline(entries);
                      setRenderVersion((version) => version + 1);
                    }}
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
              <button
                type="button"
                className="md-viewer__panel-toggle"
                aria-pressed={panelOpen}
                aria-label={panelOpen ? 'Hide outline and backlinks' : 'Show outline and backlinks'}
                title={panelOpen ? 'Hide outline and backlinks' : 'Show outline and backlinks'}
                onClick={() => setPanelOpen((open) => !open)}
              >
                ☰
              </button>
              {panelOpen && <MarkdownSidePanel outline={outline} noteKey={noteKey} onGoToHeading={goToHeading} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
