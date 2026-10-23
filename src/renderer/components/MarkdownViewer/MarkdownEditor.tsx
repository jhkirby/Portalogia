// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-22

import { useEffect, useRef } from 'react';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { indentOnInput, LanguageDescription } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { latexCompletionSource, wikiLinkCompletionSource } from '../../lib/markdown/editorCompletions';
import { editorFindField } from '../../lib/markdown/editorFind';
import { lineMotionKeymap } from '../../lib/markdown/editorLineMotion';
import { editorHighlight, editorTheme } from '../../lib/markdown/editorTheme';
import { livePreview as livePreviewExtension } from '../../lib/markdown/livePreview';
import { syncRenderedBlocksFocus } from '../../lib/markdown/livePreviewBlocks';

/** Languages whose code blocks get their own colouring inside the editor — the two that can also be run, the rest stay plain. */
const CODE_LANGUAGES = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'node', 'mjs', 'cjs'], support: javascript() }),
  LanguageDescription.of({ name: 'python', alias: ['py', 'python3'], support: python() }),
];

/**
 * The two settings that change while the editor is open: whether it can be
 * edited, and whether it shows the note formatted (live preview) or raw.
 * Module-level so a saved state from an earlier mount, which carries these
 * same compartments, can be reconfigured too.
 */
const editableCompartment = new Compartment();
const previewCompartment = new Compartment();

/**
 * @param readOnly Whether the note is only being viewed.
 * @returns The extensions that make the editor read-only, or editable.
 */
function editableExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/**
 * Line numbers for the raw text, each a handle for its line: a press selects the whole line, break included, so it can
 * be copied, cut or typed over in one go.
 */
const clickableLineNumbers = lineNumbers({
  domEventHandlers: {
    mousedown: (view, line, event) => {
      if ((event as MouseEvent).button !== 0) {
        return false;
      }
      event.preventDefault();
      view.dispatch({ selection: { anchor: line.from, head: Math.min(line.to + 1, view.state.doc.length) }, userEvent: 'select' });
      view.focus();
      return true;
    },
  },
});

/**
 * @param formatted Whether the note is shown formatted.
 * @returns The live preview with its syntax colours and math and wikilink marks, or — for raw text — line numbers
 *   in a gutter, as in a code editor, and every character exactly as typed: no bold, italic, code or link styling.
 */
function previewExtensions(formatted: boolean): Extension {
  return formatted
    ? [livePreviewExtension(), editorHighlight, markupDecorations()]
    : [clickableLineNumbers, highlightActiveLineGutter(), EditorView.editorAttributes.of({ class: 'cm-raw' })];
}

/** Marks `[[wikilinks]]` and `$math$` in the source so they read as what they are while writing. */
function markupDecorations(): Extension {
  const wiki = new MatchDecorator({ regexp: /\[\[[^\]\n]+\]\]/g, decoration: Decoration.mark({ class: 'cm-wikilink' }) });
  const math = new MatchDecorator({
    // `\\.` is a backslash escape and `[^$\\\n]` anything but `$`, a backslash or a newline. The two never overlap, so a
    // long unclosed `$....` can't backtrack exponentially, and math containing the letter `n` is still matched.
    regexp: /\$\$[^$]+?\$\$|\$(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\d)/g,
    decoration: Decoration.mark({ class: 'cm-math' }),
  });
  return [wiki, math].map((decorator) =>
    ViewPlugin.fromClass(
      class {
        public decorations: DecorationSet;
        public constructor(view: EditorView) {
          this.decorations = decorator.createDeco(view);
        }
        public update(update: ViewUpdate): void {
          this.decorations = decorator.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  );
}

interface MarkdownEditorProps {
  /** The note's source, as it is when the editor opens. Later changes made elsewhere come through `onView`'s view, not this prop. */
  readonly initialSource: string;
  /** The editor's last state from the previous time it was open on this very text, so undo carries across a switch to the rendered view and back. */
  readonly savedState: EditorState | null;
  readonly onChange: (source: string) => void;
  /** Called with the live editor once it exists, and with `null` and the editor's final state as it goes — for the find bar, and for keeping the state (and its undo history) for the next time. */
  readonly onView: (view: EditorView | null, finalState?: EditorState) => void;
  /** The names of the notes in this note's vault, asked for the first time `[[` is typed. */
  readonly listNotes: () => Promise<readonly string[]>;
  /** A right-click in the editor, at these page coordinates — opens the formatting menu. */
  readonly onContextMenu: (x: number, y: number) => void;
  /** The scroll position to start at, as a fraction of the document's height. */
  readonly initialScroll: number;
  /** View mode: the text can be read and selected but not changed. */
  readonly readOnly: boolean;
  /** Formatted display: the note is drawn formatted while staying editable, Obsidian-style (see `livePreview`). */
  readonly livePreview: boolean;
  /**
   * Where the caret is (its offset in the note) and what's selected (`from` to `to`, equal when nothing is), whenever
   * either moves or the text under them changes — for the status bar.
   */
  readonly onSelection: (head: number, from: number, to: number) => void;
}

/**
 * The note in CodeMirror: Markdown with colouring, list continuation on
 * Enter, bracket pairing, and completion — LaTeX commands while typing math,
 * and the vault's note names after `[[`. Shows the raw text, or (with
 * `livePreview`) the note formatted while still editable; `readOnly` makes
 * either one view-only. Both switch in place, keeping the undo history. The
 * editor is created once per mount; the viewer unmounts it only for the
 * read-only formatted reader. Escape takes the caret out of it.
 */
export function MarkdownEditor({
  initialSource,
  savedState,
  onChange,
  onView,
  listNotes,
  onContextMenu,
  initialScroll,
  readOnly,
  livePreview,
  onSelection,
}: MarkdownEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // The latest callbacks, read from the editor's listeners, so the editor itself is built just once.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const listNotesRef = useRef(listNotes);
  listNotesRef.current = listNotes;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    let names: Promise<readonly string[]> | null = null;
    const noteNames = (): Promise<readonly string[]> => {
      names ??= listNotesRef.current();
      return names;
    };
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      highlightActiveLine(),
      indentOnInput(),
      EditorView.lineWrapping,
      closeBrackets(),
      // Only pairs that help in prose: a quote or `$` that closed itself would fight the apostrophes and dollar amounts in ordinary text.
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '`'] } }]),
      markdown({ base: markdownLanguage, codeLanguages: CODE_LANGUAGES }),
      autocompletion({
        override: [latexCompletionSource, wikiLinkCompletionSource(noteNames)],
        activateOnTyping: true,
        icons: false,
      }),
      keymap.of([
        ...closeBracketsKeymap,
        // Before Escape below, so an open completion list closes first and the caret stays.
        ...completionKeymap,
        {
          key: 'Escape',
          run: (target) => {
            target.contentDOM.blur();
            return true;
          },
        },
        ...historyKeymap,
        // Ahead of the default Up/Down, which would step over a whole drawn list or table at once.
        ...lineMotionKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      editableCompartment.of(editableExtensions(readOnly)),
      previewCompartment.of(previewExtensions(livePreview)),
      editorFindField,
      EditorView.domEventHandlers({
        contextmenu: (event) => {
          event.preventDefault();
          onContextMenuRef.current(event.clientX, event.clientY);
          return true;
        },
      }),
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          const { head, from, to } = update.state.selection.main;
          onSelectionRef.current(head, from, to);
        }
      }),
    ];
    const state =
      savedState && savedState.doc.toString() === initialSource
        ? savedState
        : EditorState.create({ doc: initialSource, extensions });
    // A saved state keeps its own extensions and history; only a fresh one needs them built here — but its two
    // switchable settings are brought up to date.
    const view = new EditorView({ state, parent: host });
    if (state === savedState) {
      view.dispatch({
        effects: [
          editableCompartment.reconfigure(editableExtensions(readOnly)),
          previewCompartment.reconfigure(previewExtensions(livePreview)),
        ],
      });
    }
    viewRef.current = view;
    onViewRef.current(view);
    const { head, from, to } = view.state.selection.main;
    onSelectionRef.current(head, from, to);
    if (!readOnly) {
      view.focus();
    }
    syncRenderedBlocksFocus(view);
    requestAnimationFrame(() => {
      const scroller = view.scrollDOM;
      scroller.scrollTop = initialScroll * scroller.scrollHeight;
    });
    return () => {
      viewRef.current = null;
      onViewRef.current(null, view.state);
      view.destroy();
    };
    // Built once per mount: the callbacks are read through refs, the text only ever enters at creation, and the two
    // settings switch in place (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // View ↔ Edit and Raw ↔ Formatted, in place: the document, its scroll and its undo history stay.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: [
        editableCompartment.reconfigure(editableExtensions(readOnly)),
        previewCompartment.reconfigure(previewExtensions(livePreview)),
      ],
    });
    if (!readOnly) {
      view.focus();
    }
    syncRenderedBlocksFocus(view);
  }, [readOnly, livePreview]);

  return <div ref={hostRef} className="md-editor" />;
}
