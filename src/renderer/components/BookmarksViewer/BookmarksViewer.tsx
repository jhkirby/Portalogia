// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { findDuplicates } from '@shared/duplicates';
import type { BookmarkField } from '@shared/ipc-contract';
import type { BookmarkState } from '@shared/tab-state';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { compareText, sortRows } from '../../lib/tableSort';
import { CheckIcon, CopyIcon, OpenInNewTabIcon } from '../icons';
import { SortHeader, useTableSort } from '../SortHeader';

/** How long a row's copy button shows its checkmark after copying. */
const COPIED_FEEDBACK_MS = 1200;

/** How many rows into the table the fade-in's stagger reaches; the rest come in with the last of them. */
const MAX_ROW_STAGGER = 25;

/** The longest name and reference that can be typed (the update's caps, see `bookmarkUpdateRequestSchema`). */
const MAX_TITLE_CHARS = 500;
const MAX_REFERENCE_CHARS = 4096;

/** The table's sortable columns. */
type BookmarkColumn = 'name' | 'type' | 'reference';

/** The table's headings, in order, with each column's width class. */
const COLUMNS: readonly { readonly column: BookmarkColumn; readonly label: string; readonly className: string }[] = [
  { column: 'name', label: 'Name', className: 'history__th bookmarks__th--name' },
  { column: 'type', label: 'Type', className: 'history__th history__th--type' },
  { column: 'reference', label: 'Reference', className: 'history__th' },
];

/** What a row's boxes hold while edited and not yet kept: a field absent is showing the saved value. */
interface Draft {
  readonly title?: string;
  readonly reference?: string;
}

/** Why main refused a row's last edit, shown on the field it refused until that field is typed in again. */
interface Refusal {
  readonly field: BookmarkField;
  readonly message: string;
}

/** What the Type column shows: the same labels as the History table's. */
function typeLabel(bookmark: BookmarkState): string {
  return bookmark.kind === 'pdf' ? 'PDF' : bookmark.kind === 'markdown' ? 'MD' : 'URL';
}

/** Where a bookmark points: a page's URL, or a PDF's or note's path on disk. */
function referenceOf(bookmark: BookmarkState): string {
  return bookmark.kind === 'page' ? bookmark.url : (bookmark.path ?? bookmark.url);
}

/** How two references are compared for being the same place: a path ignoring case, as Windows does (the page can't tell the platform). */
function referenceKey(bookmark: BookmarkState, reference: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed) {
    return null;
  }
  // A page and a file never point at the same place, so each compares only within its own sort.
  return bookmark.kind === 'page' ? `url:${trimmed}` : `path:${trimmed.toLowerCase()}`;
}

/** How two names are compared for being the same one: as the PDF sections' are, ignoring case and outer spaces. */
function nameKey(title: string): string | null {
  return title.trim().toLowerCase() || null;
}

/** Why a row's boxes can't be kept as typed: a message per box, `null` for a box with nothing wrong. */
interface RowProblem {
  readonly title: string | null;
  readonly reference: string | null;
}

/**
 * What's wrong with the rows as typed — an empty box, or a name or reference
 * another bookmark already has. Checked here so a box turns red as it's
 * typed; main checks again before keeping it. Of a repeated value one row
 * keeps it and only the others are marked, the box last typed in first
 * (`findDuplicates`), so a repeat is one box in red, not both.
 * @param rows Every bookmark with what its boxes hold, in the order added.
 * @param lastEdit The box last typed in, if any.
 * @returns The problems by bookmark id; a row with nothing wrong is absent.
 */
function findRowProblems(
  rows: readonly { readonly bookmark: BookmarkState; readonly title: string; readonly reference: string }[],
  lastEdit: { readonly id: string; readonly field: BookmarkField } | null,
): ReadonlyMap<string, RowProblem> {
  const editedIndex = (field: BookmarkField): number | null => {
    const index = lastEdit?.field === field ? rows.findIndex((row) => row.bookmark.id === lastEdit.id) : -1;
    return index >= 0 ? index : null;
  };
  const titleRepeats = findDuplicates(rows, (row) => nameKey(row.title), editedIndex('title'));
  const referenceRepeats = findDuplicates(
    rows,
    (row) => referenceKey(row.bookmark, row.reference),
    editedIndex('reference'),
  );
  const problems = new Map<string, RowProblem>();
  rows.forEach(({ bookmark, title, reference }, index) => {
    const noun = bookmark.kind === 'page' ? 'URL' : 'path';
    const titleProblem = !title.trim()
      ? 'A bookmark needs a name'
      : titleRepeats.has(index)
        ? 'Another bookmark already has this name'
        : null;
    const referenceProblem = !reference.trim()
      ? `A bookmark needs a ${noun}`
      : referenceRepeats.has(index)
        ? `Another bookmark already points at this ${noun}`
        : null;
    if (titleProblem || referenceProblem) {
      problems.set(bookmark.id, { title: titleProblem, reference: referenceProblem });
    }
  });
  return problems;
}

/**
 * The whole of `bookmarks.html`'s page: every saved bookmark as a table —
 * its name, whether it's a page (`URL`), a PDF or a note (`MD`), and where
 * it points (the URL, or the file's path). Clicking a heading sorts by that
 * column (`SortHeader`); with none sorted they're listed as added.
 *
 * In view mode, hovering a row reveals buttons to copy where it points and
 * to open it in a new tab. In edit mode the name and reference are boxes,
 * and the one button deletes the row instead. As with a PDF's section names,
 * no two bookmarks may share a name, nor point at the same place: the box
 * repeating another's value turns red while it can't be kept (Enter then
 * puts back the saved value); leaving it keeps what's typed, once main has
 * checked it too.
 *
 * The search box and the View/Edit switch live in the chrome's toolbar
 * (`BookmarksToolbar`); main pushes the list whenever a bookmark changes,
 * and the search text and mode as they're set there. Filtering is local.
 */
export function BookmarksViewer() {
  const [bookmarks, setBookmarks] = useState<readonly BookmarkState[]>([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [refusals, setRefusals] = useState<Readonly<Record<string, Refusal>>>({});
  /** The box last typed in: of a repeated value, that box is the one marked, not the one it now matches. */
  const [lastEdit, setLastEdit] = useState<{ readonly id: string; readonly field: BookmarkField } | null>(null);
  /** The row whose copy button is showing its checkmark. */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => window.portalogiaBookmarks.onBookmarks(setBookmarks), []);
  useEffect(() => window.portalogiaBookmarks.onQuery(setQuery), []);
  useEffect(() => window.portalogiaBookmarks.onMode(setMode), []);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  // Back to viewing: anything typed but never kept is let go.
  useEffect(() => {
    if (mode === 'view') {
      setDrafts({});
      setRefusals({});
      setLastEdit(null);
    }
  }, [mode]);

  const isEditing = mode === 'edit';
  const sort = useTableSort<BookmarkColumn>();

  // Filtered and sorted by what's saved, not what's being typed: a row doesn't jump about mid-edit.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = !needle
      ? bookmarks
      : bookmarks.filter(
          (bookmark) =>
            bookmark.title.toLowerCase().includes(needle) ||
            typeLabel(bookmark).toLowerCase().includes(needle) ||
            referenceOf(bookmark).toLowerCase().includes(needle),
        );
    return sortRows(matches, sort.keys, (first, second, column) => {
      switch (column) {
        case 'name':
          return compareText(first.title, second.title);
        case 'type':
          return compareText(typeLabel(first), typeLabel(second));
        case 'reference':
          return compareText(referenceOf(first), referenceOf(second));
      }
    });
  }, [bookmarks, query, sort.keys]);
  const hasRows = shown.length > 0;

  // Checked across every bookmark as typed, not just the rows the search shows: a hidden one can still be repeated.
  const problems = useMemo(
    () =>
      findRowProblems(
        bookmarks.map((bookmark) => ({
          bookmark,
          title: drafts[bookmark.id]?.title ?? bookmark.title,
          reference: drafts[bookmark.id]?.reference ?? referenceOf(bookmark),
        })),
        lastEdit,
      ),
    [bookmarks, drafts, lastEdit],
  );

  // The empty table's message ends in the same looping dots as the History table's.
  const emptyText = bookmarks.length === 0 ? 'No bookmarks yet' : 'No matching bookmarks';
  const emptyMessage = useAnimatedPlaceholder(!hasRows, emptyText);
  const emptyRest = `${emptyText}...`.slice(emptyMessage.length);

  // The scroll bar starts below the column headers — see `HistoryViewer`'s same measurement.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const head = headRef.current;
    if (!wrap || !head) {
      return undefined;
    }
    const sync = (): void => wrap.style.setProperty('--history-header-height', `${head.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(head);
    return () => observer.disconnect();
  }, [hasRows]);

  /** Sets what one of a row's boxes holds, `undefined` putting back the saved value; a refusal of that field is cleared. */
  const setDraft = (id: string, field: BookmarkField, value: string | undefined): void => {
    if (value !== undefined) {
      setLastEdit({ id, field });
    }
    setDrafts((current) => {
      const next: Draft = { ...current[id], [field]: value };
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
      return next.title === undefined && next.reference === undefined ? rest : { ...rest, [id]: next };
    });
    setRefusals((current) =>
      current[id]?.field === field ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)) : current,
    );
  };

  /** Keeps a row's typed name and reference, if they can be: unchanged or marked in red, nothing is sent. */
  const commit = (bookmark: BookmarkState): void => {
    const draft = drafts[bookmark.id];
    if (!draft) {
      return;
    }
    const title = draft.title ?? bookmark.title;
    const reference = draft.reference ?? referenceOf(bookmark);
    if (title === bookmark.title && reference === referenceOf(bookmark)) {
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== bookmark.id)));
      return;
    }
    if (problems.has(bookmark.id)) {
      return;
    }
    void window.portalogiaBookmarks.update(bookmark.id, title, reference).then((result) => {
      if (result.ok) {
        // The kept values arrive with the next list; the boxes show those from here.
        setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== bookmark.id)));
      } else {
        setRefusals((current) => ({ ...current, [bookmark.id]: { field: result.field, message: result.message } }));
      }
    });
  };

  const copy = (bookmark: BookmarkState): void => {
    // Main copies what it has stored for this id, not text from here.
    window.portalogiaBookmarks.copy(bookmark.id);
    setCopiedId(bookmark.id);
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), COPIED_FEEDBACK_MS);
  };

  return (
    <div className="history">
      <div ref={wrapRef} className="history__table-wrap">
        {!hasRows ? (
          <p className="history__empty">
            {emptyMessage}
            <span className="history__empty-rest" aria-hidden="true">
              {emptyRest}
            </span>
          </p>
        ) : (
          <table className={`history__table${isEditing ? ' bookmarks__table--editing' : ''}`}>
            <thead ref={headRef}>
              <tr>
                {COLUMNS.map(({ column, label, className }) => (
                  <SortHeader
                    key={column}
                    label={label}
                    className={className}
                    direction={sort.directionOf(column)}
                    onToggle={() => sort.toggle(column)}
                  />
                ))}
                <th className="history__th bookmarks__th--actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((bookmark, index) => {
                const draft = drafts[bookmark.id];
                const refusal = refusals[bookmark.id];
                const title = draft?.title ?? bookmark.title;
                const reference = draft?.reference ?? referenceOf(bookmark);
                const problem = problems.get(bookmark.id);
                const titleError = problem?.title ?? (refusal?.field === 'title' ? refusal.message : null);
                const referenceError = problem?.reference ?? (refusal?.field === 'reference' ? refusal.message : null);
                const routeKind = bookmark.kind === 'page' ? 'URL' : 'path';
                const isCopied = copiedId === bookmark.id;
                return (
                  <tr
                    key={bookmark.id}
                    className="history__row"
                    style={{ '--row-index': Math.min(index, MAX_ROW_STAGGER) } as CSSProperties}
                  >
                    <td className="history__cell bookmarks__cell--name" title={isEditing ? undefined : bookmark.title}>
                      {isEditing ? (
                        <EditField
                          label="Bookmark name"
                          value={title}
                          error={titleError}
                          maxLength={MAX_TITLE_CHARS}
                          onChange={(value) => setDraft(bookmark.id, 'title', value)}
                          onRevert={() => setDraft(bookmark.id, 'title', undefined)}
                          onCommit={() => commit(bookmark)}
                        />
                      ) : (
                        bookmark.title
                      )}
                    </td>
                    <td className="history__cell history__cell--type">{typeLabel(bookmark)}</td>
                    <td
                      className="history__cell history__cell--route bookmarks__cell--reference"
                      title={isEditing ? undefined : referenceOf(bookmark)}
                    >
                      {isEditing ? (
                        <EditField
                          label={bookmark.kind === 'page' ? 'Bookmark URL' : 'Bookmark file path'}
                          value={reference}
                          error={referenceError}
                          maxLength={MAX_REFERENCE_CHARS}
                          onChange={(value) => setDraft(bookmark.id, 'reference', value)}
                          onRevert={() => setDraft(bookmark.id, 'reference', undefined)}
                          onCommit={() => commit(bookmark)}
                        />
                      ) : (
                        referenceOf(bookmark)
                      )}
                    </td>
                    <td className="history__cell history__cell--actions">
                      <div className="history__actions">
                        {isEditing ? (
                          <button
                            type="button"
                            className="history__action-button hover-grow history__delete"
                            aria-label={`Delete the bookmark ${bookmark.title}`}
                            title="Delete bookmark"
                            onClick={() => window.portalogiaBookmarks.remove(bookmark.id)}
                          >
                            ×
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`history__action-button hover-grow history__copy${
                                isCopied ? ' history__copy--done' : ''
                              }`}
                              aria-label={`Copy ${routeKind}`}
                              title={isCopied ? 'Copied' : `Copy ${routeKind}`}
                              onClick={() => copy(bookmark)}
                            >
                              {isCopied ? <CheckIcon /> : <CopyIcon />}
                            </button>
                            <button
                              type="button"
                              className="history__action-button hover-grow history__open"
                              aria-label={`Open ${bookmark.title} in a new tab`}
                              title="Open in new tab"
                              onClick={() => window.portalogiaBookmarks.open(bookmark.id)}
                            >
                              <OpenInNewTabIcon />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface EditFieldProps {
  readonly label: string;
  readonly value: string;
  /** Why what's typed can't be kept, or `null` if it can: marked in red, with the reason on hover. */
  readonly error: string | null;
  readonly maxLength: number;
  readonly onChange: (value: string) => void;
  /** Puts back the saved value. */
  readonly onRevert: () => void;
  /** Keeps what's typed, if it can be. */
  readonly onCommit: () => void;
}

/**
 * One of an edited row's boxes. Leaving it (or Enter) keeps what's typed;
 * while it's marked in red, Enter puts back the saved value instead, as a
 * PDF section's name box does. Escape always puts it back.
 */
function EditField({ label, value, error, maxLength, onChange, onRevert, onCommit }: EditFieldProps) {
  return (
    <input
      className={`bookmarks__input${error ? ' bookmarks__input--invalid' : ''}`}
      aria-label={label}
      aria-invalid={error !== null}
      title={error ? `${error} (Enter puts back the saved one)` : undefined}
      value={value}
      maxLength={maxLength}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || (event.key === 'Enter' && error)) {
          event.preventDefault();
          onRevert();
        } else if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}
