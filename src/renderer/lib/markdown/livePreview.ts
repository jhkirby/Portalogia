// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-17

import { syntaxTree } from '@codemirror/language';
import { renderedBlocks } from './livePreviewBlocks';
import type { EditorState, Extension, Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/** The node a syntax-tree walk visits — named through `syntaxTree` so `@lezer/common` needn't be a direct dependency. */
type SyntaxNodeRef = Parameters<Parameters<ReturnType<typeof syntaxTree>['iterate']>[0]['enter']>[0];

// ── WIDGETS ─────────────────────────────────────────────────────────────

/** A task's `[ ]` / `[x]`, drawn as a checkbox that ticks the source when clicked. */
class TaskCheckboxWidget extends WidgetType {
  /**
   * @param checked Whether the task is done (`[x]`).
   * @param from Where the marker's `[` sits in the document, so a click knows which characters to flip.
   */
  public constructor(
    private readonly checked: boolean,
    private readonly from: number,
  ) {
    super();
  }

  /**
   * @param other The widget it would replace.
   * @returns Whether it draws the same thing, so the DOM can be kept.
   */
  public override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  /**
   * @param view The editor it is drawn in.
   * @returns The checkbox element.
   */
  public override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-task';
    box.checked = this.checked;
    box.tabIndex = -1;
    box.setAttribute('aria-label', this.checked ? 'Mark task not done' : 'Mark task done');
    // Pressed rather than clicked: a click would first move the caret onto the line and reveal the raw marker instead.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (view.state.readOnly) {
        return;
      }
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }

  /** @returns `true`: the checkbox handles its own presses. */
  public override ignoreEvent(): boolean {
    return true;
  }
}

/** A list item's `-`, `*` or `+`, drawn as a bullet. */
class BulletWidget extends WidgetType {
  /**
   * @param other The widget it would replace.
   * @returns Always `true`: every bullet looks the same.
   */
  public override eq(other: BulletWidget): boolean {
    return other instanceof BulletWidget;
  }

  /** @returns The bullet element. */
  public override toDOM(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.className = 'cm-lp-bullet';
    bullet.textContent = '•';
    return bullet;
  }
}

/** A `---` thematic break, drawn as a rule across the column. */
class RuleWidget extends WidgetType {
  /**
   * @param other The widget it would replace.
   * @returns Always `true`: every rule looks the same.
   */
  public override eq(other: RuleWidget): boolean {
    return other instanceof RuleWidget;
  }

  /** @returns The rule element. */
  public override toDOM(): HTMLElement {
    const rule = document.createElement('span');
    rule.className = 'cm-lp-rule';
    return rule;
  }
}

// ── DECORATIONS ─────────────────────────────────────────────────────────

const HIDDEN = Decoration.replace({});
const BULLET = Decoration.replace({ widget: new BulletWidget() });
const RULE = Decoration.replace({ widget: new RuleWidget() });

/** Inline Markdown nodes and the class their text takes. Their marks (`**`, `` ` ``…) are hidden off the caret's lines. */
const INLINE_STYLES: Readonly<Record<string, string>> = {
  StrongEmphasis: 'cm-lp-strong',
  Emphasis: 'cm-lp-em',
  Strikethrough: 'cm-lp-strike',
  InlineCode: 'cm-lp-code',
  Link: 'cm-lp-link',
};

/** The syntax marks hidden off the caret's lines — inside the inline nodes above, and a quote's `>`. */
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'QuoteMark']);

/**
 * The lines any selection range touches: there the note is left as raw text,
 * so the caret always sits among the characters it's actually editing.
 * @param state The editor state.
 * @returns The line numbers (1-based) to leave raw.
 */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

/**
 * Builds the live preview's decorations for the visible part of the note:
 * headings sized, emphasis and code styled, links coloured, quotes ruled,
 * bullets, tasks and rules drawn — and the syntax that produces them hidden,
 * except on the lines the caret is on.
 * @param view The editor.
 * @returns The decorations, sorted.
 */
function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  // Without focus there's no caret, so every line is formatted.
  const raw = view.hasFocus ? activeLines(state) : new Set<number>();
  const isRaw = (pos: number): boolean => raw.has(state.doc.lineAt(pos).number);
  const ranges: Range<Decoration>[] = [];

  const visit = (node: SyntaxNodeRef): boolean | void => {
    const { name, from, to } = node;
    const heading = /^ATXHeading([1-6])$/.exec(name);
    if (heading) {
      ranges.push(Decoration.line({ class: `cm-lp-h${heading[1]}` }).range(state.doc.lineAt(from).from));
      return;
    }
    if (name === 'HeaderMark') {
      // An ATX heading's `#`s, with the space after them; a setext heading's underline marks stay visible.
      const isAtx = node.node.parent?.name.startsWith('ATXHeading') ?? false;
      if (isAtx && !isRaw(from)) {
        const end = state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
        if (end > from) {
          ranges.push(HIDDEN.range(from, end));
        }
      }
      return;
    }
    const inlineClass = INLINE_STYLES[name];
    if (inlineClass && to > from) {
      ranges.push(Decoration.mark({ class: inlineClass }).range(from, to));
      return;
    }
    if (name === 'URL' && node.node.parent?.name === 'Link' && !isRaw(from)) {
      ranges.push(HIDDEN.range(from, to));
      return;
    }
    if (HIDDEN_MARKS.has(name) && !isRaw(from)) {
      const end = name === 'QuoteMark' && state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
      ranges.push(HIDDEN.range(from, end));
      return;
    }
    if (name === 'Blockquote') {
      for (let pos = from; pos <= to; ) {
        const line = state.doc.lineAt(pos);
        ranges.push(Decoration.line({ class: 'cm-lp-quote' }).range(line.from));
        pos = line.to + 1;
      }
      return;
    }
    if (name === 'FencedCode' || name === 'CodeBlock') {
      const firstLine = state.doc.lineAt(from).number;
      const lastLine = state.doc.lineAt(to).number;
      for (let number = firstLine; number <= lastLine; number += 1) {
        ranges.push(Decoration.line({ class: 'cm-lp-codeblock' }).range(state.doc.line(number).from));
      }
      return;
    }
    if ((name === 'CodeInfo' || name === 'CodeMark') && node.node.parent?.name === 'FencedCode') {
      // The fence lines (```lang) are hidden unless the caret is somewhere in the block.
      const block = node.node.parent;
      const firstLine = state.doc.lineAt(block.from).number;
      const lastLine = state.doc.lineAt(block.to).number;
      if (![...raw].some((line) => line >= firstLine && line <= lastLine)) {
        ranges.push(HIDDEN.range(from, to));
      }
      return;
    }
    if (name === 'ListMark' && !isRaw(from)) {
      const mark = state.doc.sliceString(from, to);
      const nextIsTask = /^\s*\[[ xX]\]/.test(state.doc.sliceString(to, to + 5));
      if (nextIsTask) {
        // The checkbox stands in for the bullet.
        const end = state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
        ranges.push(HIDDEN.range(from, end));
      } else if (mark === '-' || mark === '*' || mark === '+') {
        ranges.push(BULLET.range(from, to));
      }
      return;
    }
    if (name === 'TaskMarker' && !isRaw(from)) {
      const checked = /x/i.test(state.doc.sliceString(from, to));
      ranges.push(Decoration.replace({ widget: new TaskCheckboxWidget(checked, from) }).range(from, to));
      return;
    }
    if (name === 'HorizontalRule' && !isRaw(from)) {
      ranges.push(RULE.range(from, to));
    }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({ from, to, enter: visit });
  }
  return Decoration.set(ranges, true);
}

/** Keeps the decorations in step with the note, the scroll position, the caret and the parse. */
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    public decorations: DecorationSet;

    /** @param view The editor it decorates. */
    public constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    /** @param update What changed since the last build. */
    public update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// ── THEME ───────────────────────────────────────────────────────────────

/** The formatted look: the reader's body font and heading sizes (markdown-viewer.css), code kept monospace. */
const livePreviewTheme = EditorView.theme({
  // The reader's size, not the source editor's, so the formatted note is the same size being edited as being read.
  '&.cm-live-preview': { fontSize: '1rem' },
  '&.cm-live-preview .cm-scroller': { fontFamily: 'var(--md-font-body)', lineHeight: '1.7' },
  // A block drawn by the reader's renderer (see `livePreviewBlocks`): its margins stay inside it (so the editor
  // measures its full height, with the overlap between neighbours taken back by `blockSpacing`), and the HTML's own
  // line breaks aren't the editor's preserved whitespace.
  '.cm-lp-block': { display: 'flow-root', whiteSpace: 'normal', cursor: 'text' },
  '.cm-lp-block__content': { display: 'flow-root' },
  '.cm-lp-h1, .cm-lp-h2, .cm-lp-h3, .cm-lp-h4, .cm-lp-h5, .cm-lp-h6': { fontWeight: '700', lineHeight: '1.35' },
  '.cm-lp-h1': { fontSize: '2em' },
  '.cm-lp-h2': { fontSize: '1.55em' },
  '.cm-lp-h3': { fontSize: '1.25em' },
  '.cm-lp-h4, .cm-lp-h5, .cm-lp-h6': { fontSize: '1.05em' },
  '.cm-lp-h6': { color: 'var(--color-tab-text)' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through' },
  '.cm-lp-code': {
    padding: '0.12em 0.35em',
    backgroundColor: 'var(--md-code-bg)',
    borderRadius: '4px',
    fontFamily: 'var(--md-font-mono)',
    fontSize: '0.9em',
  },
  '.cm-lp-link': { color: 'var(--color-accent-text)', textDecoration: 'underline' },
  '.cm-lp-quote': {
    paddingLeft: '1em',
    borderLeft: '3px solid var(--md-quote-border)',
    color: 'var(--color-tab-text)',
  },
  '.cm-lp-codeblock': {
    backgroundColor: 'var(--md-code-bg)',
    fontFamily: 'var(--md-font-mono)',
    fontSize: '0.9em',
    paddingLeft: '0.8em',
  },
  '.cm-lp-bullet': { display: 'inline-block', width: '0.8em', color: 'var(--color-tab-text)' },
  '.cm-lp-task': { margin: '0 0.4em 0 0', verticalAlign: 'middle', cursor: 'pointer' },
  '.cm-lp-rule': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--color-chrome-border)',
  },
});

/**
 * The editor's formatted mode, like Obsidian's live preview: the note reads
 * as formatted text while staying editable. The line (or lines) the caret is
 * on shows its raw Markdown, so what is typed is always visible exactly.
 * @returns The extension to add to the editor (or remove, for raw text).
 */
export function livePreview(): Extension {
  return [
    renderedBlocks(),
    livePreviewPlugin,
    livePreviewTheme,
    EditorView.editorAttributes.of({ class: 'cm-live-preview' }),
  ];
}
