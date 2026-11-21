// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import katex from 'katex';
import type { Node } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import { calloutKind } from '@shared/markdown/callouts';
import { sanitizeNoteHtml } from '../renderNote';
import { UI_ATTRIBUTE } from '../textOffsets';
import { removeNodeAt } from './commands';

/** What the node views need from the page: reading pictures, which only main may do. */
export interface NodeViewServices {
  /** A picture beside the note (or anywhere the user picked one from), as a data URL. */
  readonly readImage: (src: string) => Promise<string | null>;
  /** A web picture, fetched by main once the user asks for it. */
  readonly readRemoteImage: (url: string) => Promise<string | null>;
}

/** `getPos` as ProseMirror hands it to a node view: where the node starts, or `undefined` once it's gone. */
type GetPos = () => number | undefined;

/** Builds an element with a class, marked as part of the page rather than the note (find and highlights skip it). */
function uiElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.setAttribute(UI_ATTRIBUTE, '');
  element.contentEditable = 'false';
  return element;
}

/** A small ✕ button that removes a node. */
function removeButton(view: EditorView, getPos: GetPos, label: string): HTMLButtonElement {
  const button = uiElement('button', 'fm-remove');
  button.type = 'button';
  button.textContent = '✕';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const pos = getPos();
    if (pos !== undefined) {
      removeNodeAt(pos)(view.state, view.dispatch);
      view.focus();
    }
  });
  return button;
}

// ── CALLOUTS ────────────────────────────────────────────────────────────

/** A callout drawn as the reader draws it: a coloured box with its title, its blocks editable inside. */
class CalloutView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;
  private readonly title: HTMLElement;

  public constructor(private node: Node) {
    this.dom = document.createElement('div');
    this.title = uiElement('div', 'md-callout__title');
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'md-callout__body';
    this.dom.append(this.title, this.contentDOM);
    this.render();
  }

  private render(): void {
    const type = String(this.node.attrs['type']);
    const kind = calloutKind(type);
    this.dom.className = `md-callout md-callout--${kind.family} fm-callout`;
    this.dom.dataset['callout'] = type.toLowerCase();
    this.dom.dataset['fold'] = String(this.node.attrs['fold'] ?? '');
    const title = String(this.node.attrs['title'] ?? '');
    this.title.textContent = title === '' ? kind.title : title;
  }

  public update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.render();
    return true;
  }

  public ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}

// ── LIST ITEMS ──────────────────────────────────────────────────────────

/** A list item; a task item gets a checkbox that ticks it. */
class ListItemView implements NodeView {
  public readonly dom: HTMLLIElement;
  public readonly contentDOM: HTMLElement;
  private readonly box: HTMLInputElement | null = null;

  public constructor(
    private node: Node,
    view: EditorView,
    getPos: GetPos,
  ) {
    this.dom = document.createElement('li');
    if (node.attrs['checked'] === null) {
      this.contentDOM = this.dom;
      return;
    }
    this.dom.className = 'fm-task';
    const box = uiElement('input', 'md-task');
    box.type = 'checkbox';
    box.checked = node.attrs['checked'] === true;
    box.tabIndex = -1;
    // Pressed rather than clicked, so the press doesn't first move the caret.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const pos = getPos();
      if (pos !== undefined && view.editable) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked: this.node.attrs['checked'] !== true }));
      }
    });
    box.addEventListener('click', (event) => event.preventDefault());
    this.box = box;
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'fm-task__body';
    this.dom.append(box, this.contentDOM);
    this.syncChecked();
  }

  private syncChecked(): void {
    if (this.box) {
      this.box.checked = this.node.attrs['checked'] === true;
      this.dom.classList.toggle('fm-task--done', this.box.checked);
    }
  }

  public update(node: Node): boolean {
    // An item that gains or loses its checkbox is drawn anew.
    if (node.type !== this.node.type || (node.attrs['checked'] === null) !== (this.node.attrs['checked'] === null)) {
      return false;
    }
    this.node = node;
    this.syncChecked();
    return true;
  }

  public stopEvent(event: Event): boolean {
    return this.box !== null && event.target === this.box;
  }

  public ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }): boolean {
    return mutation.type !== 'selection' && (mutation.target === this.box || (mutation.type === 'attributes' && mutation.target === this.dom));
  }
}

// ── CODE BLOCKS ─────────────────────────────────────────────────────────

/** A code block as a box: its language and Copy and ✕ along the top, its text editable below, no fences. */
class CodeBlockView implements NodeView {
  public readonly dom: HTMLElement;
  public readonly contentDOM: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly language: HTMLInputElement;

  public constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: GetPos,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'fm-code';
    this.bar = uiElement('div', 'fm-code__bar');
    this.language = document.createElement('input');
    this.language.className = 'fm-code__language';
    this.language.placeholder = 'language';
    this.language.spellcheck = false;
    this.language.setAttribute('aria-label', 'Code language');
    this.language.value = String(node.attrs['language'] ?? '');
    this.language.addEventListener('change', () => this.setLanguage());
    this.language.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        this.setLanguage();
        this.view.focus();
      }
    });
    const copy = uiElement('button', 'fm-code__button');
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('mousedown', (event) => {
      event.preventDefault();
      void navigator.clipboard.writeText(this.node.textContent).then(() => {
        copy.textContent = 'Copied';
        window.setTimeout(() => (copy.textContent = 'Copy'), 1200);
      });
    });
    this.bar.append(this.language, copy, removeButton(view, getPos, 'Remove the code block'));
    const pre = document.createElement('pre');
    pre.className = 'md-code';
    this.contentDOM = document.createElement('code');
    pre.appendChild(this.contentDOM);
    this.dom.append(this.bar, pre);
  }

  private setLanguage(): void {
    const pos = this.getPos();
    const language = this.language.value.trim();
    if (pos !== undefined && language !== this.node.attrs['language']) {
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, language }));
    }
  }

  public update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    if (document.activeElement !== this.language) {
      this.language.value = String(node.attrs['language'] ?? '');
    }
    return true;
  }

  public stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.bar.contains(event.target);
  }

  public ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}

// ── SOURCE ATOMS: MATH, RAW HTML, RAW MARKDOWN ──────────────────────────

/** The atoms edited as source: which attribute holds it, how it's drawn, and what its box is called. */
interface SourceKind {
  readonly attribute: string;
  readonly inline: boolean;
  readonly label: string;
  readonly placeholder: string;
  readonly render: (target: HTMLElement, source: string, node: Node) => void;
  /** Whether the atom goes away when closed empty (an empty formula or HTML block is nothing). */
  readonly dropWhenEmpty: boolean;
}

const SOURCE_KINDS: Readonly<Record<string, SourceKind>> = {
  math_block: {
    attribute: 'tex',
    inline: false,
    label: 'LaTeX',
    placeholder: 'e.g. \\frac{a}{b}',
    dropWhenEmpty: true,
    render: (target, tex) => renderMath(target, tex, true),
  },
  math_inline: {
    attribute: 'tex',
    inline: true,
    label: 'LaTeX',
    placeholder: 'e.g. x^2',
    dropWhenEmpty: true,
    render: (target, tex, node) => renderMath(target, tex, node.attrs['display'] === true),
  },
  html_block: {
    attribute: 'html',
    inline: false,
    label: 'HTML',
    placeholder: '<div>…</div>',
    dropWhenEmpty: true,
    render: (target, html) => {
      target.innerHTML = html.trim() === '' ? '' : sanitizeNoteHtml(html);
      if (html.trim() === '') {
        target.textContent = 'Empty HTML block';
        target.classList.add('fm-atom__empty');
      } else {
        target.classList.remove('fm-atom__empty');
      }
    },
  },
  raw_block: {
    attribute: 'text',
    inline: false,
    label: 'Markdown',
    placeholder: '',
    dropWhenEmpty: false,
    render: (target, text) => {
      target.textContent = text;
    },
  },
};

/** Typesets TeX with KaTeX as the reader does; an empty formula shows a hint, a broken one shows its TeX in red. */
function renderMath(target: HTMLElement, tex: string, display: boolean): void {
  if (tex.trim() === '') {
    target.textContent = display ? 'Empty formula' : '∅';
    target.classList.add('fm-atom__empty');
    return;
  }
  target.classList.remove('fm-atom__empty');
  try {
    katex.render(tex, target, { displayMode: display, throwOnError: false, output: 'html', trust: false, strict: 'ignore' });
  } catch {
    target.textContent = tex;
  }
}

/** The open source views, by their element — how `focusSourceEditor` finds the one that's selected. */
const sourceViews = new WeakMap<HTMLElement, SourceAtomView>();

/**
 * A formula, an HTML block or a stretch of Markdown the editor has no element
 * for: drawn as it renders, and — while selected — with a box under it to
 * edit its source, the drawing updating as it's typed.
 */
class SourceAtomView implements NodeView {
  public readonly dom: HTMLElement;
  private readonly preview: HTMLElement;
  private box: HTMLElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private readonly kind: SourceKind;

  public constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: GetPos,
  ) {
    this.kind = SOURCE_KINDS[node.type.name]!;
    this.dom = document.createElement(this.kind.inline ? 'span' : 'div');
    this.dom.className = `fm-atom fm-atom--${node.type.name}`;
    this.preview = document.createElement(this.kind.inline ? 'span' : 'div');
    this.preview.className = node.type.name.startsWith('math') ? `md-math md-math--${this.kind.inline ? 'inline' : 'display'}` : 'fm-atom__preview';
    this.dom.appendChild(this.preview);
    // A click on the drawing opens its source for typing.
    this.dom.addEventListener('mouseup', () => window.setTimeout(() => this.focusInput(), 0));
    sourceViews.set(this.dom, this);
    this.renderPreview();
  }

  private get source(): string {
    return String(this.node.attrs[this.kind.attribute] ?? '');
  }

  private renderPreview(): void {
    this.kind.render(this.preview, this.source, this.node);
  }

  /** Puts the keyboard in the source box, if it's open. */
  public focusInput(): void {
    if (this.input && document.activeElement !== this.input) {
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }
  }

  public selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    if (!this.view.editable || this.box) {
      return;
    }
    const box = uiElement('div', `fm-source${this.kind.inline ? ' fm-source--inline' : ''}`);
    const head = uiElement('div', 'fm-source__head');
    const label = document.createElement('span');
    label.className = 'fm-source__label';
    label.textContent = this.kind.label;
    head.append(label, removeButton(this.view, this.getPos, `Remove the ${this.kind.label === 'Markdown' ? 'block' : this.kind.label}`));
    const input = document.createElement('textarea');
    input.className = 'fm-source__input';
    input.spellcheck = false;
    input.placeholder = this.kind.placeholder;
    input.value = this.source;
    input.rows = this.kind.inline ? 1 : Math.min(12, Math.max(2, this.source.split('\n').length));
    input.addEventListener('input', () => {
      const pos = this.getPos();
      if (pos !== undefined) {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, [this.kind.attribute]: input.value });
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        this.view.dispatch(tr);
      }
      if (!this.kind.inline) {
        input.rows = Math.min(12, Math.max(2, input.value.split('\n').length));
      }
    });
    input.addEventListener('keydown', (event) => {
      // The note's own keys (and the viewer's shortcuts) stay out of the box.
      event.stopPropagation();
      const done = event.key === 'Escape' || (event.key === 'Enter' && (this.kind.inline || event.ctrlKey || event.metaKey));
      if (done) {
        event.preventDefault();
        this.leave();
      }
    });
    box.append(head, input);
    this.box = box;
    this.input = input;
    this.dom.appendChild(box);
  }

  /** Closes the box and puts the caret just after the atom. */
  private leave(): void {
    const pos = this.getPos();
    if (pos !== undefined) {
      const after = pos + this.node.nodeSize;
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(after))));
    }
    this.view.focus();
  }

  public deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
    this.box?.remove();
    this.box = null;
    this.input = null;
    if (this.kind.dropWhenEmpty && this.source.trim() === '') {
      // Not from inside the view's own update: once it's done, if the atom is still there and still empty.
      window.setTimeout(() => {
        const pos = this.getPos();
        const current = pos === undefined ? null : this.view.state.doc.nodeAt(pos);
        if (pos !== undefined && current === this.node && String(current.attrs[this.kind.attribute] ?? '').trim() === '') {
          const selection = this.view.state.selection;
          if (!(selection instanceof NodeSelection && selection.from === pos)) {
            this.view.dispatch(this.view.state.tr.delete(pos, pos + current.nodeSize));
          }
        }
      }, 0);
    }
  }

  public update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.renderPreview();
    if (this.input && this.input.value !== this.source) {
      this.input.value = this.source;
    }
    return true;
  }

  public stopEvent(event: Event): boolean {
    return this.box !== null && event.target instanceof globalThis.Node && this.box.contains(event.target);
  }

  public ignoreMutation(): boolean {
    return true;
  }

  public destroy(): void {
    sourceViews.delete(this.dom);
  }
}

/**
 * Opens the selected atom's source box for typing — after Enter on it, or
 * right after the toolbar put one in.
 * @returns Whether a source atom was selected.
 */
export function focusSourceEditor(view: EditorView): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof NodeSelection) || !(selection.node.type.name in SOURCE_KINDS)) {
    return false;
  }
  const dom = view.nodeDOM(selection.from);
  const source = dom instanceof HTMLElement ? sourceViews.get(dom) : undefined;
  if (!source) {
    return false;
  }
  window.setTimeout(() => source.focusInput(), 0);
  return true;
}

// ── IMAGES ──────────────────────────────────────────────────────────────

/** The narrowest a picture can be dragged to, in pixels. */
const MIN_IMAGE_WIDTH = 24;

/** A picture, read through main, with corner handles to drag it wider or narrower while it's selected. */
class ImageView implements NodeView {
  public readonly dom: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly handles: HTMLElement[];
  private loadedSrc = '';

  public constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: GetPos,
    private readonly services: NodeViewServices,
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'fm-image';
    this.image = document.createElement('img');
    this.image.draggable = false;
    this.handles = (['left', 'right'] as const).map((side) => {
      const handle = uiElement('span', `fm-image__handle fm-image__handle--${side}`);
      handle.addEventListener('pointerdown', (event) => this.startResize(event, side));
      return handle;
    });
    this.dom.append(this.image, ...this.handles);
    this.dom.addEventListener('click', () => {
      if (this.image.classList.contains('md-image--remote') && !this.image.src) {
        this.loadRemote();
      }
    });
    this.render();
  }

  private render(): void {
    const src = String(this.node.attrs['src'] ?? '');
    const width = this.node.attrs['width'] as number | null;
    this.image.alt = String(this.node.attrs['alt'] ?? '') || src;
    this.image.title = String(this.node.attrs['title'] ?? '');
    this.image.style.width = width === null ? '' : `${width}px`;
    if (src === this.loadedSrc) {
      return;
    }
    this.loadedSrc = src;
    this.image.removeAttribute('src');
    this.image.className = '';
    if (/^https?:\/\//i.test(src)) {
      // A web picture waits for a click, as in the reader, so opening the note tells no server about it.
      this.image.classList.add('md-image--remote');
      return;
    }
    this.image.classList.add('md-image--loading');
    void this.services.readImage(src).then((url) => {
      if (this.loadedSrc !== src) {
        return;
      }
      this.image.classList.remove('md-image--loading');
      if (url) {
        this.image.src = url;
      } else {
        this.image.classList.add('md-image--broken');
      }
    });
  }

  private loadRemote(): void {
    const src = this.loadedSrc;
    this.image.classList.add('md-image--loading');
    void this.services.readRemoteImage(src).then((url) => {
      if (this.loadedSrc !== src) {
        return;
      }
      this.image.classList.remove('md-image--loading', 'md-image--remote');
      if (url) {
        this.image.src = url;
      } else {
        this.image.classList.add('md-image--broken');
      }
    });
  }

  /** Drags a corner: the picture follows the pointer, and its width is written when the pointer lets go. */
  private startResize(event: PointerEvent, side: 'left' | 'right'): void {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = this.image.getBoundingClientRect().width;
    const maxWidth = (this.view.dom as HTMLElement).clientWidth;
    let width = startWidth;
    const onMove = (move: PointerEvent): void => {
      const delta = (move.clientX - startX) * (side === 'right' ? 1 : -1);
      width = Math.round(Math.max(MIN_IMAGE_WIDTH, Math.min(maxWidth, startWidth + delta)));
      this.image.style.width = `${width}px`;
    };
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      const pos = this.getPos();
      if (pos !== undefined && width !== startWidth) {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width });
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        this.view.dispatch(tr);
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  public selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  public deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  public update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    this.node = node;
    this.render();
    return true;
  }

  public stopEvent(event: Event): boolean {
    return event.target instanceof HTMLElement && event.target.classList.contains('fm-image__handle');
  }

  public ignoreMutation(): boolean {
    return true;
  }
}

/**
 * The editor's node views.
 * @param services Picture reading, from the page.
 */
export function buildNodeViews(services: NodeViewServices): Record<string, NodeViewConstructor> {
  const source: NodeViewConstructor = (node, view, getPos) => new SourceAtomView(node, view, getPos);
  return {
    callout: (node) => new CalloutView(node),
    list_item: (node, view, getPos) => new ListItemView(node, view, getPos),
    code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
    math_block: source,
    math_inline: source,
    html_block: source,
    raw_block: source,
    image: (node, view, getPos) => new ImageView(node, view, getPos, services),
  };
}
