// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-12

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { toggleTask } from '@shared/markdown/source';
import {
  collectLocalImages,
  collectWikiLinks,
  convertCallouts,
  decorateTags,
  enableTasks,
  markExternalLinks,
  markMissingWikiLinks,
  typesetMath,
} from './enhance';
import { renderNote } from './renderNote';
import { TableWidget, enterTable } from './livePreviewTable';
import { sourceOffsetForRendered } from './textOffsets';

// ── FOCUS ───────────────────────────────────────────────────────────────

/** The editor gained (`true`) or lost (`false`) focus. */
const setFocused = StateEffect.define<boolean>();

/** Whether the editor has focus — a block is shown as text only while there is a caret to edit it with. */
const focusedField = StateField.define<boolean>({
  create: () => false,
  update(focused, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFocused)) {
        return effect.value;
      }
    }
    return focused;
  },
});

const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing));

// ── RENDERED BLOCKS ─────────────────────────────────────────────────────

/** Pictures already read, by name: a block redrawn after an edit shouldn't read them again. */
const imageCache = new Map<string, string>();

/** Top-level nodes that draw nothing: left as text, since a widget for them would be an empty, unclickable strip. */
const UNDRAWN_BLOCKS = new Set(['LinkReference', 'CommentBlock', 'ProcessingInstructionBlock']);

/**
 * Reads a drawn block's local pictures through main, as the reader does; the
 * editor is told to re-measure as each arrives, since the block grows.
 * @param block The rendered block.
 * @param view The editor.
 */
function loadPictures(block: HTMLElement, view: EditorView): void {
  for (const { image, src } of collectLocalImages(block)) {
    const show = (url: string | null): void => {
      image.classList.remove('md-image--loading');
      if (url) {
        image.src = url;
        image.addEventListener('load', () => view.requestMeasure(), { once: true });
      } else {
        image.classList.add('md-image--broken');
      }
    };
    const cached = imageCache.get(src);
    if (cached !== undefined) {
      show(cached);
      continue;
    }
    void window.portalogiaMarkdown.readImage(src).then((url) => {
      if (url) {
        imageCache.set(src, url);
      }
      if (image.isConnected) {
        show(url);
      }
    });
  }
}

/**
 * Draws one block of the note exactly as the reader draws it — the same
 * renderer and the same finishing touches — for a widget to stand in for its source.
 * @param source The block's source.
 * @param first Whether it is the note's first block, which (as in the reader) has no space above it.
 * @param view The editor it is drawn in.
 * @returns The drawn block.
 */
function drawRenderedBlock(source: string, first: boolean, view: EditorView): HTMLElement {
  const block = document.createElement('div');
  block.className = `md-reader cm-lp-block${first ? ' cm-lp-block--first' : ''}`;
  // The content sits one level down, so the reader's "no space above the first element" rule meets this wrapper
  // instead, and each block keeps the space above it that it has in the reader.
  const content = document.createElement('div');
  content.className = 'cm-lp-block__content';
  // The renderer's HTML is sanitized (see `renderNote`), the same as the reader's.
  content.innerHTML = renderNote(source);
  block.appendChild(content);
  convertCallouts(block);
  typesetMath(block);
  enableTasks(block);
  decorateTags(block);
  markExternalLinks(block);
  loadPictures(block, view);
  const names = collectWikiLinks(block);
  if (names.length > 0) {
    void window.portalogiaMarkdown.resolveLinks(names).then((resolved) => {
      if (block.isConnected) {
        markMissingWikiLinks(block, resolved);
      }
    });
  }
  return block;
}

/**
 * One block of the note (a paragraph, a list, a heading, a table, a code
 * block…) drawn exactly as the reader draws it — the same renderer and the
 * same finishing touches — standing in for its source while the caret is
 * elsewhere. A press puts the caret at the matching point of the source;
 * a task checkbox ticks; Ctrl+click follows a link.
 */
class RenderedBlockWidget extends WidgetType {
  /**
   * @param source The block's source.
   * @param first Whether it is the note's first block, which (as in the reader) has no space above it.
   */
  public constructor(
    private readonly source: string,
    private readonly first: boolean,
  ) {
    super();
  }

  /**
   * @param other The widget it would replace.
   * @returns Whether it draws the same thing, so its DOM (and any pictures read into it) can be kept.
   */
  public override eq(other: RenderedBlockWidget): boolean {
    return other.source === this.source && other.first === this.first;
  }

  /** @returns A guess at its height before it's drawn, so the scroll bar is about right for blocks off-screen. */
  public override get estimatedHeight(): number {
    return (this.source.split('\n').length + 1) * 27;
  }

  /**
   * @param view The editor it is drawn in.
   * @returns The rendered block.
   */
  public override toDOM(view: EditorView): HTMLElement {
    const block = drawRenderedBlock(this.source, this.first, view);
    block.addEventListener('mousedown', (event) => this.handlePress(event, block, view));
    // A click's default (following a link) is never wanted: a press already placed the caret, or followed it.
    block.addEventListener('click', (event) => event.preventDefault());
    return block;
  }

  /** @returns `true`: the block handles its own presses (see `handlePress`). */
  public override ignoreEvent(): boolean {
    return true;
  }

  /**
   * A press on the drawn block: a checkbox ticks its task, Ctrl+press on a
   * link follows it (a note in a new tab), and anything else puts the caret
   * at the matching point of the source — which then shows as text.
   * @param event The press.
   * @param block The rendered block.
   * @param view The editor.
   */
  private handlePress(event: MouseEvent, block: HTMLElement, view: EditorView): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const start = view.posAtDOM(block);
    const target = event.target instanceof Element ? event.target : null;
    const task = target?.closest<HTMLInputElement>('input.md-task');
    if (task) {
      const next = toggleTask(this.source, Number(task.dataset['taskIndex']));
      if (next !== null && !view.state.readOnly) {
        view.dispatch({ changes: { from: start, to: start + this.source.length, insert: next } });
      }
      return;
    }
    const link = target?.closest<HTMLAnchorElement>('a');
    if (link && (event.ctrlKey || event.metaKey)) {
      const wiki = link.dataset['wikilink'];
      const href = link.getAttribute('href') ?? '';
      if (wiki !== undefined && !wiki.startsWith('#')) {
        void window.portalogiaMarkdown.openLink('wiki', wiki, true);
      } else if (href !== '' && !href.startsWith('#')) {
        void window.portalogiaMarkdown.openLink('link', href, true);
      }
      return;
    }
    let offset = 0;
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (caret && block.contains(caret.startContainer)) {
      const before = document.createRange();
      before.setStart(block, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      offset = sourceOffsetForRendered(this.source, before.toString());
    }
    view.dispatch({ selection: { anchor: start + Math.min(offset, this.source.length) } });
    view.focus();
  }
}

// ── WHICH BLOCKS ARE DRAWN ──────────────────────────────────────────────

/** Marks the first line of the block being edited, with the reader's tag for it (see `blockSpacing`). */
const EDIT_TOP = 'data-lp-edit-top';

/** Marks the last line of the block being edited, with the reader's tag for it (see `blockSpacing`). */
const EDIT_BOTTOM = 'data-lp-edit-bottom';

/**
 * A blank line after the block being edited, folded to no height: the reader has no lines for them, so they'd push
 * everything below down by their height while the caret was in the block, and back up when it left. The reader's
 * spacing comes from the blocks around it instead (`blockSpacing`). Folded by its look only, so the line is still
 * there for the caret to move onto, which shows it again.
 */
const FOLDED_GAP = Decoration.line({ class: 'cm-lp-folded-gap' });

/**
 * The element the reader draws a block as, for measuring the space it keeps above and below (`blockSpacing`).
 * @param name The block's syntax node.
 * @returns The tag; a paragraph's for anything else.
 */
function readerTag(name: string): string {
  const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
  if (heading) {
    return `h${heading[1]}`;
  }
  const tags: Record<string, string> = {
    BulletList: 'ul',
    OrderedList: 'ol',
    Blockquote: 'blockquote',
    FencedCode: 'pre',
    CodeBlock: 'pre',
    HorizontalRule: 'hr',
    Table: 'table',
  };
  return tags[name] ?? 'p';
}

/** Every tag `readerTag` names. */
const READER_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'table'];

/**
 * The note's blocks, each drawn as the reader would draw it, except the ones
 * the caret is in while the editor has focus — those stay as text (styled by
 * `livePreview`'s inline decorations) so they can be edited. With no focus
 * every block is drawn, and the note looks exactly as it does in View. The
 * blank lines between two drawn blocks are folded into the first, so the
 * spacing is the reader's, not a blank line's.
 * @param state The editor state.
 * @returns The block decorations.
 */
function buildBlocks(state: EditorState): DecorationSet {
  const { doc } = state;
  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
  const blocks: { from: number; to: number; drawn: boolean; table: boolean; name: string }[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const from = doc.lineAt(node.from).from;
    // A node can end at the start of the next line (its own line break included); its last line is the one before.
    const to = doc.lineAt(node.to > node.from && doc.lineAt(node.to).from === node.to ? node.to - 1 : node.to).to;
    blocks.push({ from, to, drawn: !UNDRAWN_BLOCKS.has(node.name), table: node.name === 'Table', name: node.name });
  }
  const focused = state.field(focusedField);
  const touches = (from: number, to: number): boolean =>
    focused && state.selection.ranges.some((range) => range.from <= to && range.to >= from);
  const ranges: Range<Decoration>[] = [];
  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    // The block's reach: itself and the blank lines after it, up to the next block.
    const reach = next ? Math.max(block.to, doc.lineAt(next.from - 1).to) : doc.length;
    if (!block.drawn) {
      return;
    }
    // The blank lines after the block are only text while the caret is on them, so they can be typed on.
    const blankLinesInUse = reach > block.to && touches(block.to + 1, reach);
    if (!block.table && touches(block.from, reach)) {
      // The block being edited, left as text. It takes the room the drawn block took, so nothing around it moves as
      // the caret comes and goes: the blank lines after it fold away (unless the caret is on them, `blankLinesInUse`),
      // and its first and last lines are marked for `blockSpacing` to give the reader's space above and below.
      const tag = readerTag(block.name);
      const firstLine = doc.lineAt(block.from).from;
      const lastLine = doc.lineAt(block.to).from;
      if (firstLine === lastLine) {
        ranges.push(Decoration.line({ attributes: { [EDIT_TOP]: tag, [EDIT_BOTTOM]: tag } }).range(firstLine));
      } else {
        ranges.push(Decoration.line({ attributes: { [EDIT_TOP]: tag } }).range(firstLine));
        ranges.push(Decoration.line({ attributes: { [EDIT_BOTTOM]: tag } }).range(lastLine));
      }
      if (reach > block.to && !blankLinesInUse) {
        for (let pos = block.to + 1; pos <= reach; ) {
          const line = doc.lineAt(pos);
          ranges.push(FOLDED_GAP.range(line.from));
          pos = line.to + 1;
        }
      }
      return;
    }
    // A drawn block folds in the blank lines after it, as the reader has no lines for them: its own spacing stands in.
    // A table keeps them as text while the caret is on them; any other block with the caret there is text itself.
    const end = blankLinesInUse ? block.to : reach;
    const source = doc.sliceString(block.from, block.to);
    const widget = block.table
      ? new TableWidget(source, index === 0, drawRenderedBlock)
      : new RenderedBlockWidget(source, index === 0);
    ranges.push(Decoration.replace({ widget, block: true }).range(block.from, end));
  });
  return Decoration.set(ranges, true);
}

/**
 * Carries the caret on into a table when the arrows bring the note's caret
 * onto it (see `enterTable`): the table stays drawn, so its source can't be
 * typed in as text.
 */
const tableEntry = EditorView.updateListener.of((update) => {
  if (!update.selectionSet || update.docChanged || !update.view.hasFocus) {
    return;
  }
  const head = update.state.selection.main;
  if (!head.empty) {
    return;
  }
  const previous = update.startState.selection.main.head;
  update.state.field(blocksField).between(head.head, head.head, (from, to, decoration) => {
    if (!(decoration.spec.widget instanceof TableWidget) || head.head < from || head.head > to) {
      return;
    }
    enterTable(update.view, from, previous < from);
    return false;
  });
});

const blocksField = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(blocks, transaction) {
    const refocused = transaction.effects.some((effect) => effect.is(setFocused));
    const reparsed = syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    return transaction.docChanged || transaction.selection || refocused || reparsed ? buildBlocks(transaction.state) : blocks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ── SPACING BETWEEN DRAWN BLOCKS ────────────────────────────────────────

/** Whether an element's own edge stops a child's margin there (padding, a border, or a box of its own). */
function stopsMargin(style: CSSStyleDeclaration, side: 'Top' | 'Bottom'): boolean {
  return (
    parseFloat(style[`padding${side}`]) > 0 ||
    parseFloat(style[`border${side}Width`]) > 0 ||
    !['block', 'list-item'].includes(style.display) ||
    style.overflow !== 'visible'
  );
}

/**
 * The margin an element's content puts at one edge: its first (or last)
 * child's, and that child's own first (or last) child's, for as long as the
 * margins would collapse together — as they do in the reader.
 * @param container The element whose content is measured.
 * @param side Which edge.
 * @returns The largest margin along that edge, in px.
 */
function edgeMargin(container: Element, side: 'Top' | 'Bottom'): number {
  let largest = 0;
  let node = side === 'Top' ? container.firstElementChild : container.lastElementChild;
  while (node) {
    const style = getComputedStyle(node);
    largest = Math.max(largest, parseFloat(side === 'Top' ? style.marginTop : style.marginBottom) || 0);
    if (stopsMargin(style, side)) {
      break;
    }
    node = side === 'Top' ? node.firstElementChild : node.lastElementChild;
  }
  return largest;
}

/**
 * The space the reader keeps above and below each kind of block (`readerTag`): its margins, and for a block drawn
 * with a padded, bordered edge (a level-2 heading's underline) that edge too, since the line being edited has none.
 * @param sample A hidden `.md-reader` holding one element of every kind.
 * @returns Each tag's space above and below, in px.
 */
function readerSpacing(sample: HTMLElement): Map<string, { top: number; bottom: number }> {
  const spacing = new Map<string, { top: number; bottom: number }>();
  for (const element of Array.from(sample.querySelectorAll<HTMLElement>('[data-tag]'))) {
    const style = getComputedStyle(element);
    const px = (value: string): number => parseFloat(value) || 0;
    spacing.set(element.dataset['tag'] ?? '', {
      top: px(style.marginTop) + px(style.paddingTop) + px(style.borderTopWidth),
      bottom: px(style.marginBottom) + px(style.paddingBottom) + px(style.borderBottomWidth),
    });
  }
  return spacing;
}

/**
 * Builds the hidden sample `readerSpacing` measures: one element of each kind, laid out as a drawn block lays its
 * content out (one level down in a `.md-reader`, so the "no space above the first element" rule meets the wrapper).
 * @returns The sample, not yet in the page.
 */
function buildSpacingSample(): HTMLElement {
  const sample = document.createElement('div');
  sample.className = 'md-reader cm-lp-spacing-sample';
  sample.setAttribute('aria-hidden', 'true');
  const content = document.createElement('div');
  content.appendChild(document.createElement('span'));
  for (const tag of READER_TAGS) {
    const element = document.createElement(tag);
    element.dataset['tag'] = tag;
    content.appendChild(element);
  }
  sample.appendChild(content);
  return sample;
}

/**
 * Gives the drawn blocks the reader's spacing. In the reader, the margin
 * below one block and the margin above the next collapse into the larger of
 * the two; each drawn block keeps its margins inside itself (so the editor
 * can measure it), so here the overlap is taken back by pulling each block up
 * by the smaller of the two. The note's first block, like the reader's first
 * element, has no space above it.
 *
 * The block being edited (text, not drawn) gets the same: its first and last lines (`EDIT_TOP`, `EDIT_BOTTOM`) are
 * padded out to the reader's gap to the drawn blocks either side, less what those blocks already keep inside them.
 * So the text sits where the drawn block did, and nothing below it moves as the caret goes in and out.
 */
/** The measure that spaces the block being edited, kept apart from the drawn blocks' own (`blockSpacing`). */
const editSpacingKey = {};

const blockSpacing = ViewPlugin.fromClass(
  class {
    /** The hidden `.md-reader` the reader's spacing is measured from (`readerSpacing`). */
    private readonly sample: HTMLElement;

    /** @param view The editor. */
    public constructor(private readonly view: EditorView) {
      this.sample = buildSpacingSample();
      view.dom.appendChild(this.sample);
      this.schedule();
    }

    /** Re-spaces after anything that can change the drawn blocks or their sizes. */
    public update(): void {
      this.schedule();
    }

    /** Takes the sample back out of the page. */
    public destroy(): void {
      this.sample.remove();
    }

    private schedule(): void {
      this.view.requestMeasure({
        key: editSpacingKey,
        read: (view) => {
          const spacing = readerSpacing(this.sample);
          /** The drawn block next to a line, past any folded gap, or `null` if text (or nothing) is there. */
          const drawnBeside = (line: Element, side: 'previous' | 'next'): Element | null => {
            let element = side === 'previous' ? line.previousElementSibling : line.nextElementSibling;
            while (element?.classList.contains('cm-lp-folded-gap')) {
              element = side === 'previous' ? element.previousElementSibling : element.nextElementSibling;
            }
            return element?.classList.contains('cm-lp-block') ? element : null;
          };
          return Array.from(view.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-line')).map((line) => {
            let top = 0;
            let bottom = 0;
            const topTag = line.getAttribute(EDIT_TOP);
            if (topTag !== null) {
              const above = drawnBeside(line, 'previous');
              const content = above?.firstElementChild;
              // The note's first block has no space above it, as in the reader.
              if (above && content) {
                top = Math.max(0, (spacing.get(topTag)?.top ?? 0) - edgeMargin(content, 'Bottom'));
              }
            }
            const bottomTag = line.getAttribute(EDIT_BOTTOM);
            if (bottomTag !== null) {
              const below = drawnBeside(line, 'next');
              const content = below?.firstElementChild;
              if (below && content) {
                bottom = Math.max(0, (spacing.get(bottomTag)?.bottom ?? 0) - edgeMargin(content, 'Top'));
              }
            }
            return { line, top: top > 0 ? `${top}px` : '', bottom: bottom > 0 ? `${bottom}px` : '' };
          });
        },
        write: (lines, view) => {
          let changed = false;
          for (const { line, top, bottom } of lines) {
            // Every line, so one no longer being edited (the editor reuses line elements) loses its padding.
            if (line.style.paddingTop !== top || line.style.paddingBottom !== bottom) {
              line.style.paddingTop = top;
              line.style.paddingBottom = bottom;
              changed = true;
            }
          }
          if (changed) {
            view.requestMeasure();
          }
        },
      });
      this.view.requestMeasure({
        key: blockSpacing,
        read: (view) =>
          Array.from(view.contentDOM.children).flatMap((element) => {
            const content = element.classList.contains('cm-lp-block') ? element.firstElementChild : null;
            if (!(content instanceof HTMLElement)) {
              return [];
            }
            const previous = element.previousElementSibling;
            return [
              {
                content,
                top: edgeMargin(content, 'Top'),
                bottom: edgeMargin(content, 'Bottom'),
                first: element.classList.contains('cm-lp-block--first'),
                // The previous block's bottom margin, if a drawn block sits right above with no line of text between.
                afterBlock: previous?.classList.contains('cm-lp-block') ?? false,
              },
            ];
          }),
        write: (blocks, view) => {
          let changed = false;
          blocks.forEach((block, index) => {
            const above = block.afterBlock ? blocks[index - 1] : undefined;
            const pullUp = block.first ? block.top : above ? Math.min(above.bottom, block.top) : 0;
            const margin = pullUp > 0 ? `-${pullUp}px` : '';
            if (block.content.style.marginTop !== margin) {
              block.content.style.marginTop = margin;
              changed = true;
            }
          });
          // The blocks' heights just changed: the editor measures them again.
          if (changed) {
            view.requestMeasure();
          }
        },
      });
    }
  },
);

/**
 * Tells the blocks whether the editor has focus — for when they're switched
 * on in an editor that already has it, which no focus change will announce.
 * @param view The editor.
 */
export function syncRenderedBlocksFocus(view: EditorView): void {
  if (view.state.field(focusedField, false) !== undefined) {
    view.dispatch({ effects: setFocused.of(view.hasFocus) });
  }
}

/**
 * Draws the note's blocks with the reader's own renderer wherever the caret
 * isn't, so editing the formatted note looks like reading it: only the block
 * being edited shows its Markdown. Part of `livePreview`.
 * @returns The extension.
 */
export function renderedBlocks(): Extension {
  return [focusedField, focusTracker, blocksField, blockSpacing, tableEntry];
}
