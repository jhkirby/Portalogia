// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useRef } from 'react';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { indentOnInput, LanguageDescription } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { latexCompletionSource, wikiLinkCompletionSource } from '../../lib/markdown/editorCompletions';
import { editorFindField } from '../../lib/markdown/editorFind';
import { editorHighlight, editorTheme } from '../../lib/markdown/editorTheme';

/** Languages whose code blocks get their own colouring inside the editor — the two that can also be run, the rest stay plain. */
const CODE_LANGUAGES = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'node', 'mjs', 'cjs'], support: javascript() }),
  LanguageDescription.of({ name: 'python', alias: ['py', 'python3'], support: python() }),
];

/** Marks `[[wikilinks]]` and `$math$` in the source so they read as what they are while writing. */
function markupDecorations(): Extension {
  const wiki = new MatchDecorator({ regexp: /\[\[[^\]\n]+\]\]/g, decoration: Decoration.mark({ class: 'cm-wikilink' }) });
  const math = new MatchDecorator({
    regexp: /\$\$[^$]+?\$\$|\$(?!\s)(?:\.|[^$\\n])+?(?<!\s)\$(?!\d)/g,
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
}

/**
 * The note's source in CodeMirror: Markdown with colouring, list
 * continuation on Enter, bracket pairing, and completion — LaTeX commands
 * while typing math, and the vault's note names after `[[`. The editor is
 * created once per mount; the viewer remounts it when the mode flips back.
 */
export function MarkdownEditor({ initialSource, savedState, onChange, onView, listNotes, onContextMenu, initialScroll }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // The latest callbacks, read from the editor's listeners, so the editor itself is built just once.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const listNotesRef = useRef(listNotes);
  listNotesRef.current = listNotes;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
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
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
      markupDecorations(),
      editorFindField,
      EditorView.domEventHandlers({
        contextmenu: (event) => {
          event.preventDefault();
          onContextMenuRef.current(event.clientX, event.clientY);
          return true;
        },
      }),
      editorTheme,
      editorHighlight,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];
    const state =
      savedState && savedState.doc.toString() === initialSource
        ? savedState
        : EditorState.create({ doc: initialSource, extensions });
    // A saved state keeps its own extensions and history; only a fresh one needs them built here.
    const view = new EditorView({ state, parent: host });
    onViewRef.current(view);
    view.focus();
    requestAnimationFrame(() => {
      const scroller = view.scrollDOM;
      scroller.scrollTop = initialScroll * scroller.scrollHeight;
    });
    return () => {
      onViewRef.current(null, view.state);
      view.destroy();
    };
    // Built once per mount: the callbacks are read through refs, and the text only ever enters at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="md-editor" />;
}
