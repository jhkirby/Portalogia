// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history } from 'prosemirror-history';
import { Fragment, Slice, type Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  deleteColumn,
  deleteRow,
  setCellAttr,
  tableEditing,
} from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import type { MarkdownFormatAction } from '@shared/ipc-contract';
import { isWebAddress } from '../../lib/markdown/editorFormat';
import {
  findAncestor,
  insertCallout,
  insertCodeBlock,
  insertDivider,
  insertHtmlBlock,
  insertImage,
  insertMathBlock,
  insertTable,
  markExtent,
  moveTableColumn,
  moveTableRow,
  removeNodeAt,
  selectedNode,
  setHeading,
  toggleBold,
  toggleCode,
  toggleHighlight,
  toggleItalic,
  toggleList,
  unwrapBlock,
} from '../../lib/markdown/formatted/commands';
import { markdownToDoc, posOfSourceOffset, sourceOffsetOf } from '../../lib/markdown/formatted/document';
import { buildKeymap } from '../../lib/markdown/formatted/keymap';
import { buildNodeViews, focusSourceEditor } from '../../lib/markdown/formatted/nodeViews';
import { noteSchema as schema } from '../../lib/markdown/formatted/schema';
import { docToMarkdown } from '../../lib/markdown/formatted/toMarkdown';
import {
  BarButton,
  CalloutFields,
  CalloutTypeMenu,
  Floating,
  HeadingButtons,
  ImageFields,
  LinkEditor,
  RemoveButton,
  type Anchor,
  type LinkDraft,
} from './FormattedPopups';
import { TablePopup } from './MarkdownEditorMenus';

/** What the viewer can ask of the formatted editor. */
export interface FormattedEditorHandle {
  /** A toolbar button, shortcut or menu entry. `at` is where a right-click menu was, for a box it opens. */
  runFormat(action: MarkdownFormatAction, at?: { readonly x: number; readonly y: number }): void;
  /** The note changed on disk: show the new text (unless it's what this editor just wrote). */
  replaceSource(source: string): void;
  /** Puts the caret at a place in the note's Markdown and scrolls it into view. */
  jumpTo(offset: number, y: 'center' | 'start'): void;
  /** The element that scrolls. */
  readonly scroller: HTMLElement | null;
  focus(): void;
}

interface FormattedEditorProps {
  readonly initialSource: string;
  /** Where the caret starts, as an offset into the Markdown (from the raw editor), or `null` for the top. */
  readonly initialCaret: number | null;
  /** The scroll position to start at, as a fraction of the note's height. */
  readonly initialScroll: number;
  readonly onChange: (markdown: string) => void;
  /** The caret and selection, as offsets into the Markdown (approximate inside a block), for the status bar. */
  readonly onSelection: (head: number, from: number, to: number) => void;
  readonly onReady: (handle: FormattedEditorHandle | null) => void;
  readonly onContextMenu: (x: number, y: number) => void;
  readonly listNotes: () => Promise<readonly string[]>;
  /** The element that holds the note's `.md-reader` — what the find bar searches. */
  readonly hostRef: RefObject<HTMLDivElement | null>;
}

/** A box the toolbar opened at the caret: the heading sizes, the callout types, a table's size, or the link box. */
type Picker =
  | { readonly kind: 'heading' | 'callout' | 'table'; readonly anchor: Anchor }
  | {
      readonly kind: 'link';
      readonly anchor: Anchor;
      readonly from: number;
      readonly to: number;
      readonly existing: 'mark' | 'wiki' | null;
      readonly draft: LinkDraft;
    };

/** A rectangle as a popup anchor. */
function anchorOf(rect: DOMRect | { left: number; top: number; right: number; bottom: number }): Anchor {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/**
 * The note edited as a document rather than as Markdown — Edit + Formatted.
 * It looks as the reader draws the note (the same classes), but nothing
 * typed becomes formatting: headings, lists, callouts, code, maths, tables,
 * pictures and links come from the toolbar, its shortcuts and the
 * right-click menu, and each is edited through its own small controls — a
 * size bar on a heading, row and column buttons on a table, a box for a
 * formula's TeX, an edit button beside a link, ✕ to remove. The note is
 * written back as Markdown on every change; blocks that weren't edited are
 * written exactly as they were (see `docToMarkdown`).
 */
export function FormattedEditor({
  initialSource,
  initialCaret,
  initialScroll,
  onChange,
  onSelection,
  onReady,
  onContextMenu,
  listNotes,
  hostRef,
}: FormattedEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** The Markdown this editor last wrote, so the save echoing back from main isn't mistaken for an outside change. */
  const writtenRef = useRef(initialSource);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((tick) => tick + 1), []);
  const [focused, setFocused] = useState(false);
  const [popupFocused, setPopupFocused] = useState(false);
  const popupsRef = useRef<HTMLDivElement>(null);

  // The latest callbacks, read from the editor's handlers, so the editor itself is built once.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;

  const reportSelection = useCallback((state: EditorState): void => {
    const { head, from, to, empty } = state.selection;
    const headOffset = sourceOffsetOf(state.doc, head);
    onSelectionRef.current(headOffset, empty ? headOffset : sourceOffsetOf(state.doc, from), empty ? headOffset : sourceOffsetOf(state.doc, to));
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return undefined;
    }
    const doc = markdownToDoc(initialSource);
    const selection =
      initialCaret === null ? TextSelection.atStart(doc) : TextSelection.near(doc.resolve(posOfSourceOffset(doc, initialCaret)));
    const state = EditorState.create({
      doc,
      selection,
      plugins: [...buildKeymap(), history(), dropCursor(), gapCursor(), tableEditing()],
    });
    const view: EditorView = new EditorView(mount, {
      state,
      attributes: { class: 'md-reader fm-editor', spellcheck: 'true', 'aria-label': 'Note' },
      nodeViews: buildNodeViews({
        readImage: (src) => window.portalogiaMarkdown.readImage(src),
        readRemoteImage: (url) => window.portalogiaMarkdown.readRemoteImage(url),
      }),
      dispatchTransaction: (tr) => {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          const markdown = docToMarkdown(next.doc);
          if (markdown !== writtenRef.current) {
            writtenRef.current = markdown;
            onChangeRef.current(markdown);
          }
        }
        if (tr.docChanged || tr.selectionSet) {
          reportSelection(next);
        }
        refresh();
      },
      handleDOMEvents: {
        contextmenu: (_view, event) => {
          event.preventDefault();
          onContextMenuRef.current(event.clientX, event.clientY);
          return true;
        },
        focus: () => {
          setFocused(true);
          return false;
        },
        blur: (_view, event) => {
          // Focus moving into one of the editor's own popups (a callout's type list, a picture's description) keeps the
          // popup up: both states change in the same render, so it is never unmounted under the click.
          const next = (event as FocusEvent).relatedTarget;
          if (next instanceof globalThis.Node && popupsRef.current?.contains(next)) {
            setPopupFocused(true);
          }
          setFocused(false);
          return false;
        },
      },
      handleClick: (clickView, pos, event) => followLink(clickView, pos, event),
      // Copying gives other apps (and the raw editor) the Markdown, not just the bare text.
      clipboardTextSerializer: (slice) => sliceToMarkdown(slice),
    });
    viewRef.current = view;
    view.focus();
    reportSelection(view.state);
    requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollTop = initialScroll * scroller.scrollHeight;
      }
      if (initialCaret !== null) {
        view.dispatch(view.state.tr.scrollIntoView());
      }
    });
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Built once per mount: the callbacks are read through refs and the text only enters at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Popups follow what they belong to as the note scrolls or the window resizes.
  useEffect(() => {
    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', refresh);
    return () => {
      scroller?.removeEventListener('scroll', refresh);
      window.removeEventListener('resize', refresh);
    };
  }, [refresh]);

  /** Runs a command on the editor and gives it the keyboard back. */
  const run = useCallback((command: Command): void => {
    const view = viewRef.current;
    if (view) {
      command(view.state, view.dispatch, view);
      view.focus();
    }
  }, []);

  /** Where the caret is on screen, for a box that opens at it. */
  const caretAnchor = useCallback((at?: { readonly x: number; readonly y: number }): Anchor => {
    if (at) {
      return { left: at.x, top: at.y, right: at.x, bottom: at.y };
    }
    const view = viewRef.current;
    if (!view) {
      return { left: 80, top: 80, right: 80, bottom: 80 };
    }
    return anchorOf(view.coordsAtPos(view.state.selection.head));
  }, []);

  /** Opens the link box: for the link or note link the caret is on, or to make one of the selection. */
  const openLinkBox = useCallback(
    (at?: { readonly x: number; readonly y: number }): void => {
      const view = viewRef.current;
      if (!view) {
        return;
      }
      const state = view.state;
      const wiki = selectedNode(state, 'wikilink');
      if (wiki) {
        const attrs = wiki.node.attrs;
        setPicker({
          kind: 'link',
          anchor: anchorOf((view.nodeDOM(wiki.pos) as HTMLElement).getBoundingClientRect()),
          from: wiki.pos,
          to: wiki.pos + wiki.node.nodeSize,
          existing: 'wiki',
          draft: { text: String(attrs['alias'] ?? ''), target: String(attrs['target']), heading: String(attrs['heading'] ?? '') },
        });
        return;
      }
      const link = markExtent(state, state.selection.from, 'link');
      if (link && state.selection.to <= link.to) {
        setPicker({
          kind: 'link',
          anchor: anchorOf(view.coordsAtPos(link.to)),
          from: link.from,
          to: link.to,
          existing: 'mark',
          draft: { text: state.doc.textBetween(link.from, link.to, ' '), target: String(link.mark.attrs['href']), heading: '' },
        });
        return;
      }
      const { from, to } = state.selection;
      setPicker({
        kind: 'link',
        anchor: caretAnchor(at),
        from,
        to,
        existing: null,
        draft: { text: state.doc.textBetween(from, to, ' '), target: '', heading: '' },
      });
    },
    [caretAnchor],
  );

  /** Writes the link box's link in place of what it was opened on. */
  const saveLink = useCallback(
    (box: Extract<Picker, { kind: 'link' }>, draft: LinkDraft): void => {
      const view = viewRef.current;
      setPicker(null);
      if (!view) {
        return;
      }
      const target = draft.target;
      const web = isWebAddress(target) || /^(#|mailto:)/i.test(target);
      let content: Node;
      if (web) {
        const href = /^(https?:\/\/|mailto:|#)/i.test(target) ? target : `https://${target}`;
        const text = draft.text !== '' ? draft.text : target.replace(/^https?:\/\//i, '');
        // The link keeps the other marks of what it replaces (bold stays bold).
        const keep = view.state.doc.resolve(box.from).marks().filter((mark) => mark.type.name !== 'link');
        content = schema.text(text, [...keep, schema.marks['link']!.create({ href })]);
      } else {
        const name = target.replace(/\.(md|markdown)$/i, '');
        // An embedded note (`![[Note]]`) stays embedded when its link is edited.
        const embed = box.existing === 'wiki' && view.state.doc.nodeAt(box.from)?.attrs['embed'] === true;
        content = schema.node('wikilink', {
          target: name,
          heading: draft.heading,
          alias: draft.text !== '' && draft.text !== name ? draft.text : '',
          embed,
        });
      }
      const tr = view.state.tr.replaceWith(box.from, box.to, content);
      tr.setSelection(TextSelection.create(tr.doc, box.from + content.nodeSize));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    },
    [],
  );

  const unlink = useCallback((box: Extract<Picker, { kind: 'link' }>): void => {
    const view = viewRef.current;
    setPicker(null);
    if (!view) {
      return;
    }
    const node = view.state.doc.nodeAt(box.from);
    const tr =
      box.existing === 'wiki' && node
        ? view.state.tr.replaceWith(box.from, box.to, schema.text(String(node.attrs['alias'] || node.attrs['target'])))
        : view.state.tr.removeMark(box.from, box.to, schema.marks['link']);
    view.dispatch(tr);
    view.focus();
  }, []);

  const runFormat = useCallback(
    (action: MarkdownFormatAction, at?: { readonly x: number; readonly y: number }): void => {
      const view = viewRef.current;
      if (!view) {
        return;
      }
      setPicker(null);
      switch (action) {
        case 'bold':
          return run(toggleBold);
        case 'italic':
          return run(toggleItalic);
        case 'highlight':
          return run(toggleHighlight);
        case 'inlineCode':
          return run(toggleCode);
        case 'heading':
          return setPicker({ kind: 'heading', anchor: caretAnchor(at) });
        case 'heading0':
        case 'heading1':
        case 'heading2':
        case 'heading3':
        case 'heading4':
        case 'heading5':
        case 'heading6':
          return run(setHeading(Number(action.slice('heading'.length))));
        case 'bulletList':
          return run(toggleList('bullet'));
        case 'orderedList':
          return run(toggleList('ordered'));
        case 'taskList':
          return run(toggleList('task'));
        case 'callout':
          return setPicker({ kind: 'callout', anchor: caretAnchor(at) });
        case 'divider':
          return run(insertDivider);
        case 'code':
          return run(insertCodeBlock);
        case 'latex':
          run(insertMathBlock);
          focusSourceEditor(view);
          return;
        case 'html':
          run(insertHtmlBlock);
          focusSourceEditor(view);
          return;
        case 'table':
          return setPicker({ kind: 'table', anchor: caretAnchor(at) });
        case 'link':
          return openLinkBox(at);
        case 'image':
          void window.portalogiaMarkdown.pickImage().then((src) => {
            if (src !== null) {
              run(insertImage(src, ''));
            } else {
              viewRef.current?.focus();
            }
          });
          return;
      }
    },
    [run, caretAnchor, openLinkBox],
  );

  // The viewer's handle on this editor.
  useLayoutEffect(() => {
    const handle: FormattedEditorHandle = {
      runFormat,
      replaceSource: (source) => {
        const view = viewRef.current;
        if (!view || source === writtenRef.current) {
          return;
        }
        writtenRef.current = source;
        const doc = markdownToDoc(source);
        const head = Math.min(view.state.selection.head, doc.content.size);
        view.updateState(
          EditorState.create({ doc, selection: TextSelection.near(doc.resolve(head)), plugins: view.state.plugins }),
        );
        refresh();
      },
      jumpTo: (offset, y) => {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        const pos = posOfSourceOffset(view.state.doc, offset);
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
        const dom = view.domAtPos(view.state.selection.head).node;
        (dom instanceof HTMLElement ? dom : dom.parentElement)?.scrollIntoView({ block: y === 'start' ? 'start' : 'center' });
        view.focus();
      },
      get scroller() {
        return scrollRef.current;
      },
      focus: () => viewRef.current?.focus(),
    };
    onReady(handle);
    return () => onReady(null);
  }, [onReady, runFormat, refresh]);

  // ── The controls for what the caret is in ──

  const view = viewRef.current;
  const showContext = view !== null && (focused || popupFocused) && picker === null;
  const contextPopups: ReactElement[] = [];
  if (view && showContext) {
    const state = view.state;
    const elementRect = (pos: number): DOMRect | null => {
      const dom = view.nodeDOM(pos);
      return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
    };

    const image = selectedNode(state, 'image');
    const rule = selectedNode(state, 'horizontal_rule');
    const wiki = selectedNode(state, 'wikilink');
    const link = state.selection instanceof TextSelection ? markExtent(state, state.selection.from, 'link') : null;
    const heading = findAncestor(state, (node) => node.type.name === 'heading');
    const table = state.selection instanceof CellSelection
      ? findAncestor(state, (node) => node.type.name === 'table') ?? null
      : findAncestor(state, (node) => node.type.name === 'table');
    const callout = findAncestor(state, (node) => node.type.name === 'callout');
    const quote = findAncestor(state, (node) => node.type.name === 'blockquote');

    if (image) {
      const rect = elementRect(image.pos);
      if (rect) {
        contextPopups.push(
          <Floating key="image" anchor={anchorOf(rect)} side="below" label="Picture">
            <ImageFields
              alt={String(image.node.attrs['alt'] ?? '')}
              width={image.node.attrs['width'] as number | null}
              onAlt={(alt) => view.dispatch(view.state.tr.setNodeMarkup(image.pos, undefined, { ...image.node.attrs, alt }))}
              onResetSize={() => {
                const tr = view.state.tr.setNodeMarkup(image.pos, undefined, { ...image.node.attrs, width: null });
                view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, image.pos)));
              }}
              onChangeImage={() => {
                void window.portalogiaMarkdown.pickImage().then((src) => {
                  const current = viewRef.current;
                  const node = current?.state.doc.nodeAt(image.pos);
                  if (current && src !== null && node?.type.name === 'image') {
                    const tr = current.state.tr.setNodeMarkup(image.pos, undefined, { ...node.attrs, src, embed: false });
                    current.dispatch(tr.setSelection(NodeSelection.create(tr.doc, image.pos)));
                  }
                  current?.focus();
                });
              }}
              onRemove={() => run(removeNodeAt(image.pos))}
            />
          </Floating>,
        );
      }
    }
    if (rule) {
      const rect = elementRect(rule.pos);
      if (rect) {
        contextPopups.push(
          // Anchored to the selection ring rather than the rule: the ring sits 8px out (formatted-editor.css), and the
          // button stays clear of it.
          <Floating
            key="rule"
            anchor={{ left: rect.left - 8, top: rect.top - 8, right: rect.right + 8, bottom: rect.bottom + 8 }}
            side="above"
            align="end"
            className="fm-pop--compact"
            label="Divider"
          >
            <RemoveButton what="divider" onPress={() => run(removeNodeAt(rule.pos))} />
          </Floating>,
        );
      }
    }
    const linkEnd = wiki ? wiki.pos + wiki.node.nodeSize : link ? link.to : null;
    if (linkEnd !== null) {
      // At the link's top-right corner, clear of the ring a selected note link has (2px, 2px out).
      const wikiRect = wiki ? elementRect(wiki.pos) : null;
      const coords = view.coordsAtPos(linkEnd);
      const end = wikiRect ? { right: wikiRect.right + 4, top: wikiRect.top } : { right: coords.right, top: coords.top };
      contextPopups.push(
        <button
          key="link-edit"
          type="button"
          className="fm-link-edit"
          aria-label="Edit the link"
          data-tooltip="Edit the link (Ctrl+Shift+U)"
          style={{ left: end.right + 3, top: end.top - 14 }}
          onMouseDown={(event) => {
            event.preventDefault();
            openLinkBox();
          }}
        >
          ✎
        </button>,
      );
    }
    if (heading) {
      const rect = elementRect(heading.pos);
      if (rect) {
        contextPopups.push(
          <Floating key="heading" anchor={anchorOf(rect)} side="above" label="Heading size">
            <HeadingButtons level={Number(heading.node.attrs['level'])} onPick={(level) => run(setHeading(level))} />
          </Floating>,
        );
      }
    }
    if (table) {
      const rect = elementRect(table.pos);
      const cellAlign = (align: 'left' | 'center' | 'right' | null): Command => setCellAttr('align', align);
      if (rect) {
        contextPopups.push(
          <Floating key="table" anchor={anchorOf(rect)} side="above" label="Table">
            <BarButton label="Row above" tooltip="Add a row above" onPress={() => run(addRowBefore)}>↥ Row</BarButton>
            <BarButton label="Row below" tooltip="Add a row below" onPress={() => run(addRowAfter)}>↧ Row</BarButton>
            <BarButton label="Column left" tooltip="Add a column to the left" onPress={() => run(addColumnBefore)}>↤ Col</BarButton>
            <BarButton label="Column right" tooltip="Add a column to the right" onPress={() => run(addColumnAfter)}>↦ Col</BarButton>
            <BarButton label="Move row up" tooltip="Move the row up" onPress={() => run(moveTableRow(-1))}>↑ Row</BarButton>
            <BarButton label="Move row down" tooltip="Move the row down" onPress={() => run(moveTableRow(1))}>↓ Row</BarButton>
            <BarButton label="Move column left" tooltip="Move the column left" onPress={() => run(moveTableColumn(-1))}>← Col</BarButton>
            <BarButton label="Move column right" tooltip="Move the column right" onPress={() => run(moveTableColumn(1))}>→ Col</BarButton>
            <BarButton label="Delete row" tooltip="Delete the row" onPress={() => run(deleteRow)}>− Row</BarButton>
            <BarButton label="Delete column" tooltip="Delete the column" onPress={() => run(deleteColumn)}>− Col</BarButton>
            <BarButton label="Align left" tooltip="Align the column left" onPress={() => run(alignColumn('left', cellAlign))}>⇤</BarButton>
            <BarButton label="Align center" tooltip="Center the column" onPress={() => run(alignColumn('center', cellAlign))}>↔</BarButton>
            <BarButton label="Align right" tooltip="Align the column right" onPress={() => run(alignColumn('right', cellAlign))}>⇥</BarButton>
            <RemoveButton what="table" onPress={() => run(removeNodeAt(table.pos))} />
          </Floating>,
        );
      }
    }
    if (callout && !heading && !table) {
      const rect = elementRect(callout.pos);
      if (rect) {
        const attrs = callout.node.attrs;
        contextPopups.push(
          <Floating key="callout" anchor={anchorOf(rect)} side="above" align="end" label="Callout">
            <CalloutFields
              type={String(attrs['type'])}
              title={String(attrs['title'] ?? '')}
              fold={String(attrs['fold'] ?? '')}
              onChange={(change) => {
                const current = viewRef.current;
                const node = current?.state.doc.nodeAt(callout.pos);
                if (current && node?.type.name === 'callout') {
                  current.dispatch(current.state.tr.setNodeMarkup(callout.pos, undefined, { ...node.attrs, ...change }));
                }
              }}
              onRemove={() => run(unwrapBlock(callout.pos))}
            />
          </Floating>,
        );
      }
    } else if (quote && !callout && !heading && !table) {
      const rect = elementRect(quote.pos);
      if (rect) {
        contextPopups.push(
          <Floating key="quote" anchor={anchorOf(rect)} side="above" align="end" label="Quote">
            <RemoveButton what="quote (its text is kept)" onPress={() => run(unwrapBlock(quote.pos))} />
          </Floating>,
        );
      }
    }
  }

  return (
    <>
      <div ref={scrollRef} className="md-viewer__scroll fm-scroll">
        <div className="md-viewer__content">
          <div ref={hostRef} className="md-viewer__reader-host">
            <div ref={mountRef} className="fm-mount" />
          </div>
        </div>
      </div>
      <div
        ref={popupsRef}
        className="fm-popups"
        onFocus={() => setPopupFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
            setPopupFocused(false);
          }
        }}
      >
        {contextPopups}
        {picker?.kind === 'heading' && (
          <Floating anchor={picker.anchor} side="below" label="Heading size">
            <HeadingButtons
              level={(() => {
                const state = viewRef.current?.state;
                const heading = state ? findAncestor(state, (node) => node.type.name === 'heading') : null;
                return heading ? Number(heading.node.attrs['level']) : 0;
              })()}
              onPick={(level) => {
                setPicker(null);
                run(setHeading(level));
              }}
            />
            <BarButton label="Cancel" onPress={() => { setPicker(null); viewRef.current?.focus(); }}>Esc</BarButton>
          </Floating>
        )}
        {picker?.kind === 'callout' && (
          <Floating anchor={picker.anchor} side="below" label="Callout type" role="menu">
            <CalloutTypeMenu
              onPick={(type) => {
                setPicker(null);
                run(insertCallout(type));
              }}
              onCancel={() => {
                setPicker(null);
                viewRef.current?.focus();
              }}
            />
          </Floating>
        )}
        {picker?.kind === 'table' && (
          <TablePopup
            x={picker.anchor.left}
            y={picker.anchor.bottom + 6}
            onSubmit={(rows, columns) => {
              setPicker(null);
              run(insertTable(rows, columns));
            }}
            onCancel={() => {
              setPicker(null);
              viewRef.current?.focus();
            }}
          />
        )}
        {picker?.kind === 'link' && (
          <Floating anchor={picker.anchor} side="below" label="Link" role="dialog">
            <LinkEditor
              initial={picker.draft}
              existing={picker.existing !== null}
              listNotes={listNotes}
              onSave={(draft) => saveLink(picker, draft)}
              onUnlink={() => unlink(picker)}
              onRemove={() => {
                setPicker(null);
                const current = viewRef.current;
                if (current) {
                  current.dispatch(current.state.tr.delete(picker.from, picker.to));
                  current.focus();
                }
              }}
              onCancel={() => {
                setPicker(null);
                viewRef.current?.focus();
              }}
            />
          </Floating>
        )}
      </div>
    </>
  );
}

/**
 * Sets a column's alignment: every cell of the columns the selection touches, as a Markdown table can only align a
 * whole column.
 */
function alignColumn(align: 'left' | 'center' | 'right', setAlign: (align: 'left' | 'center' | 'right' | null) => Command): Command {
  return (state, dispatch, view) => {
    const table = findAncestor(state, (node) => node.type.name === 'table');
    const cell = findAncestor(state, (node) => node.type.name === 'table_cell' || node.type.name === 'table_header');
    if (!table || !cell) {
      return setAlign(align)(state, dispatch, view);
    }
    // Which column the caret's cell is in.
    const $cell = state.doc.resolve(cell.pos);
    const column = $cell.index();
    const current = cell.node.attrs['align'] === align ? null : align;
    if (dispatch) {
      const tr = state.tr;
      let rowPos = table.pos + 1;
      table.node.forEach((row) => {
        let cellPos = rowPos + 1;
        row.forEach((rowCell, _offset, index) => {
          if (index === column) {
            tr.setNodeMarkup(cellPos, undefined, { ...rowCell.attrs, align: current });
          }
          cellPos += rowCell.nodeSize;
        });
        rowPos += row.nodeSize;
      });
      dispatch(tr);
    }
    return true;
  };
}

/** Ctrl+click on a link follows it, as in the reader; a plain click just puts the caret there. */
function followLink(view: EditorView, pos: number, event: MouseEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) {
    return false;
  }
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name === 'wikilink') {
    const heading = String(node.attrs['heading'] ?? '');
    void window.portalogiaMarkdown.openLink('wiki', `${String(node.attrs['target'])}${heading === '' ? '' : `#${heading}`}`, false);
    return true;
  }
  const link = markExtent(view.state, pos, 'link');
  const href = link ? String(link.mark.attrs['href']) : '';
  if (href !== '' && !href.startsWith('#')) {
    void window.portalogiaMarkdown.openLink('link', href, false);
    return true;
  }
  return false;
}

/** A copied piece of the note as Markdown — whole blocks as they'd be written, a piece of a line as its own text. */
function sliceToMarkdown(slice: Slice): string {
  try {
    let content = slice.content;
    if (content.firstChild?.isInline) {
      content = Fragment.from(schema.node('paragraph', null, content));
    }
    const doc = schema.node('doc', null, content);
    return docToMarkdown(doc).replace(/\n$/, '');
  } catch {
    return slice.content.textBetween(0, slice.content.size, '\n\n', ' ');
  }
}
