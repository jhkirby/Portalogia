// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SecretField, SecretState } from '@shared/ipc-contract';
import {
  MAX_SECRET_ELEMENT_CHARS,
  MAX_SECRET_NAME_CHARS,
  MAX_SECRET_SOURCE_CHARS,
  MAX_SECRET_VALUE_CHARS,
  secretSourceOf,
} from '@shared/secrets';
import { useAnimatedPlaceholder } from '../../hooks/useAnimatedPlaceholder';
import { compareText, sortRows } from '../../lib/tableSort';
import { CheckIcon, CopyIcon } from '../icons';
import { SortHeader, useTableSort } from '../SortHeader';

/** How long a row's copy button shows its checkmark after copying. */
const COPIED_FEEDBACK_MS = 1200;

/** How many rows into the table the fade-in's stagger reaches; the rest come in with the last of them. */
const MAX_ROW_STAGGER = 25;

/** What a hidden secret shows: the same number of dots for every one, so the table doesn't tell how long each is. */
const MASK = '•'.repeat(10);

/** The table's sortable columns. The secrets themselves aren't one: sorting by them would hint at what they are. */
type SecretColumn = 'name' | 'source' | 'element';

/** The sortable headings, in order, with each column's width class. */
const COLUMNS: readonly { readonly column: SecretColumn; readonly label: string; readonly className: string }[] = [
  { column: 'name', label: 'Name', className: 'history__th secrets__th--name' },
  { column: 'source', label: 'Source', className: 'history__th' },
  { column: 'element', label: 'Element', className: 'history__th secrets__th--element' },
];

/** What a row's boxes hold while edited and not yet kept: a field absent is showing the saved value. */
type Draft = Partial<Record<SecretField, string>>;

/** Why main refused a row's last edit, shown on the field it refused until that field is typed in again. */
interface Refusal {
  readonly field: SecretField;
  readonly message: string;
}

/** A secret being typed in by hand (the toolbar's Add): every field, the element included. */
type NewSecret = Record<SecretField, string>;

const EMPTY_SECRET: NewSecret = { name: '', source: '', element: '', secret: '' };

/**
 * Why an element typed by hand won't do: empty, or not a CSS selector the page could look it up by. Checked here, where
 * there's a page to parse it; main only checks it's there.
 */
function elementProblem(element: string): string | null {
  if (!element.trim()) {
    return 'Needs the element it goes in (a CSS selector)';
  }
  try {
    document.createDocumentFragment().querySelector(element);
    return null;
  } catch {
    return 'Not a CSS selector (like input[name="email"])';
  }
}

/**
 * What's wrong with a row as typed — an empty name or secret, or a source that isn't a web address (and, for a row
 * added by hand, a missing or unreadable element). Checked here so a box turns red as it's typed; main checks again
 * before keeping it. Unlike bookmarks, two secrets may share a name: a site's username and password for two accounts
 * can't be told apart by anything else.
 * @param element The element as typed, for a row added by hand; omitted for a saved row, whose element can't change.
 * @returns A message per field, `null` for a field with nothing wrong.
 */
function rowProblems(name: string, source: string, secret: string, element?: string): Record<SecretField, string | null> {
  return {
    name: name.trim() ? null : 'A secret needs a name',
    source: secretSourceOf(source.trim()) ? null : 'Needs a web address (http or https)',
    element: element === undefined ? null : elementProblem(element),
    secret: secret.length > 0 ? null : 'A secret can’t be empty',
  };
}

/**
 * The whole of `secrets.html`'s page: every saved username and password as a
 * table — its name, the page it's for (Source), the box it's filled into on
 * that page (Element), and the secret itself, shown as dots until the
 * pointer is on its row. Clicking a heading sorts by that column
 * (`SortHeader`); with none sorted they're listed as saved.
 *
 * In view mode, hovering a row also reveals a button to copy its secret
 * (main copies its own record, and takes it off the clipboard again after a
 * while). In edit mode the name, source and secret are boxes — the secret's
 * still dotted unless its row is hovered or it's being typed in — and the
 * one button deletes the row instead. Leaving a box keeps what's typed, once
 * main has checked it too; while one's marked in red, Enter puts back the
 * saved value.
 *
 * The search box and the View/Edit switch live in the chrome's toolbar
 * (`SecretsToolbar`); main pushes the list whenever a secret changes, and the
 * search text and mode as they're set there. Filtering is local, and never
 * looks at the secrets themselves.
 */
export function SecretsViewer() {
  const [secrets, setSecrets] = useState<readonly SecretState[]>([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [refusals, setRefusals] = useState<Readonly<Record<string, Refusal>>>({});
  /** The row under the pointer: the one whose secret shows. */
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** The row whose secret box is being typed in, which shows its secret while it is. */
  const [focusedSecretId, setFocusedSecretId] = useState<string | null>(null);
  /** The row being typed in by hand (the toolbar's Add), at the top of the table; `null` when there's none. */
  const [newSecret, setNewSecret] = useState<NewSecret | null>(null);
  /** Whether Add's row has been tried once: its boxes turn red only after that, not while it's still empty. */
  const [newSecretTried, setNewSecretTried] = useState(false);
  const [newSecretRefusal, setNewSecretRefusal] = useState<Refusal | null>(null);
  /** The row whose copy button is showing its checkmark. */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => window.northstarSecrets.onSecrets(setSecrets), []);
  useEffect(() => window.northstarSecrets.onQuery(setQuery), []);
  useEffect(() => window.northstarSecrets.onMode(setMode), []);
  // Add pressed again while a row's already being typed in keeps that one: what's in it isn't thrown away.
  useEffect(
    () =>
      window.northstarSecrets.onAddRow(() => {
        setNewSecret((current) => current ?? EMPTY_SECRET);
      }),
    [],
  );
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
      setNewSecret(null);
    }
  }, [mode]);

  // The window losing the pointer (switching away) hides whatever was showing.
  useEffect(() => {
    const hide = (): void => setHoveredId(null);
    window.addEventListener('blur', hide);
    document.documentElement.addEventListener('mouseleave', hide);
    return () => {
      window.removeEventListener('blur', hide);
      document.documentElement.removeEventListener('mouseleave', hide);
    };
  }, []);

  const isEditing = mode === 'edit';
  const sort = useTableSort<SecretColumn>();

  // Filtered and sorted by what's saved, not what's being typed: a row doesn't jump about mid-edit.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = !needle
      ? secrets
      : secrets.filter(
          (secret) =>
            secret.name.toLowerCase().includes(needle) ||
            secret.source.toLowerCase().includes(needle) ||
            secret.element.toLowerCase().includes(needle),
        );
    return sortRows(matches, sort.keys, (first, second, column) => {
      switch (column) {
        case 'name':
          return compareText(first.name, second.name);
        case 'source':
          return compareText(first.source, second.source);
        case 'element':
          return compareText(first.element, second.element);
      }
    });
  }, [secrets, query, sort.keys]);
  const hasRows = shown.length > 0 || newSecret !== null;

  // The empty table's message ends in the same looping dots as the Bookmarks table's.
  const emptyText = secrets.length === 0 ? 'No secrets yet' : 'No matching secrets';
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
  const setDraft = (id: string, field: SecretField, value: string | undefined): void => {
    setDrafts((current) => {
      const next: Draft = { ...current[id], [field]: value };
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
      return Object.values(next).every((entry) => entry === undefined) ? rest : { ...rest, [id]: next };
    });
    setRefusals((current) =>
      current[id]?.field === field ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)) : current,
    );
  };

  const forgetDraft = (id: string): void => {
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  };

  /** Keeps a row's typed name, source and secret, if they can be: unchanged or marked in red, nothing is sent. */
  const commit = (secret: SecretState): void => {
    const draft = drafts[secret.id];
    if (!draft) {
      return;
    }
    const name = draft.name ?? secret.name;
    const source = draft.source ?? secret.source;
    const value = draft.secret ?? secret.secret;
    if (name === secret.name && source === secret.source && value === secret.secret) {
      forgetDraft(secret.id);
      return;
    }
    if (Object.values(rowProblems(name, source, value)).some((problem) => problem !== null)) {
      return;
    }
    void window.northstarSecrets.update(secret.id, name, source, value).then((result) => {
      if (result.ok) {
        // The kept values arrive with the next list; the boxes show those from here.
        forgetDraft(secret.id);
      } else {
        setRefusals((current) => ({ ...current, [secret.id]: { field: result.field, message: result.message } }));
      }
    });
  };

  /** Lets Add's row go, and anything typed in it. */
  const cancelNewSecret = (): void => {
    setNewSecret(null);
    setNewSecretTried(false);
    setNewSecretRefusal(null);
  };

  /** Sets one of Add's boxes; a refusal of that field is cleared. */
  const setNewSecretField = (field: SecretField, value: string): void => {
    setNewSecret((current) => (current ? { ...current, [field]: value } : current));
    setNewSecretRefusal((current) => (current?.field === field ? null : current));
  };

  /** Keeps Add's row, if it can be: anything wrong turns red instead (from here on, as it's typed). */
  const saveNewSecret = (): void => {
    if (!newSecret) {
      return;
    }
    setNewSecretTried(true);
    const { name, source, element, secret } = newSecret;
    if (Object.values(rowProblems(name, source, secret, element)).some((problem) => problem !== null)) {
      return;
    }
    void window.northstarSecrets.add(name, source, element, secret).then((result) => {
      if (result.ok) {
        // The kept secret arrives with the next list, as a row of its own.
        cancelNewSecret();
      } else {
        setNewSecretRefusal({ field: result.field, message: result.message });
      }
    });
  };

  const copy = (secret: SecretState): void => {
    // Main copies what it has stored for this id, not text from here.
    window.northstarSecrets.copy(secret.id);
    setCopiedId(secret.id);
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
                    // Re-sorting under Add's row would shuffle the table while it's being filled in.
                    disabled={newSecret !== null}
                  />
                ))}
                <th className="history__th secrets__th--secret">Secret</th>
                <th className="history__th secrets__th--actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {newSecret && (
                <NewSecretRow
                  value={newSecret}
                  errors={(() => {
                    const problems = newSecretTried
                      ? rowProblems(newSecret.name, newSecret.source, newSecret.secret, newSecret.element)
                      : null;
                    return (field: SecretField): string | null =>
                      problems?.[field] ?? (newSecretRefusal?.field === field ? newSecretRefusal.message : null);
                  })()}
                  onChange={setNewSecretField}
                  onSave={saveNewSecret}
                  onCancel={cancelNewSecret}
                />
              )}
              {shown.map((secret, index) => {
                const draft = drafts[secret.id];
                const refusal = refusals[secret.id];
                const name = draft?.name ?? secret.name;
                const source = draft?.source ?? secret.source;
                const value = draft?.secret ?? secret.secret;
                const problems = rowProblems(name, source, value);
                const errorOf = (field: SecretField): string | null =>
                  problems[field] ?? (refusal?.field === field ? refusal.message : null);
                const isRevealed = hoveredId === secret.id || focusedSecretId === secret.id;
                const isCopied = copiedId === secret.id;
                return (
                  <tr
                    key={secret.id}
                    className="history__row"
                    style={{ '--row-index': Math.min(index, MAX_ROW_STAGGER) } as CSSProperties}
                    onMouseEnter={() => setHoveredId(secret.id)}
                    onMouseLeave={() => setHoveredId((current) => (current === secret.id ? null : current))}
                  >
                    <td className="history__cell secrets__cell--editable" title={isEditing ? undefined : secret.name}>
                      {isEditing ? (
                        <EditField
                          label="Secret name"
                          value={name}
                          error={errorOf('name')}
                          maxLength={MAX_SECRET_NAME_CHARS}
                          onChange={(next) => setDraft(secret.id, 'name', next)}
                          onRevert={() => setDraft(secret.id, 'name', undefined)}
                          onCommit={() => commit(secret)}
                        />
                      ) : (
                        secret.name
                      )}
                    </td>
                    <td
                      className="history__cell history__cell--route secrets__cell--editable"
                      title={isEditing ? undefined : secret.source}
                    >
                      {isEditing ? (
                        <EditField
                          label="Secret source URL"
                          value={source}
                          error={errorOf('source')}
                          maxLength={MAX_SECRET_SOURCE_CHARS}
                          onChange={(next) => setDraft(secret.id, 'source', next)}
                          onRevert={() => setDraft(secret.id, 'source', undefined)}
                          onCommit={() => commit(secret)}
                        />
                      ) : (
                        secret.source
                      )}
                    </td>
                    <td className="history__cell secrets__cell--element" title={secret.element}>
                      {secret.element}
                    </td>
                    <td className="history__cell secrets__cell--editable secrets__cell--secret">
                      {isEditing ? (
                        <EditField
                          label="Secret"
                          value={value}
                          error={errorOf('secret')}
                          maxLength={MAX_SECRET_VALUE_CHARS}
                          masked={!isRevealed}
                          onChange={(next) => setDraft(secret.id, 'secret', next)}
                          onRevert={() => setDraft(secret.id, 'secret', undefined)}
                          onCommit={() => commit(secret)}
                          onFocusChange={(focused) =>
                            setFocusedSecretId((current) => (focused ? secret.id : current === secret.id ? null : current))
                          }
                        />
                      ) : isRevealed ? (
                        <span className="secrets__value">{secret.secret}</span>
                      ) : (
                        <span className="secrets__mask" aria-label="Hidden secret">
                          {MASK}
                        </span>
                      )}
                    </td>
                    <td className="history__cell history__cell--actions">
                      <div className="history__actions">
                        {isEditing ? (
                          <button
                            type="button"
                            className="history__action-button hover-grow history__delete"
                            aria-label={`Delete the secret ${secret.name}`}
                            title="Delete secret"
                            onClick={() => window.northstarSecrets.remove(secret.id)}
                          >
                            ×
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`history__action-button hover-grow history__copy${
                              isCopied ? ' history__copy--done' : ''
                            }`}
                            aria-label="Copy secret"
                            title={isCopied ? 'Copied' : 'Copy secret'}
                            onClick={() => copy(secret)}
                          >
                            {isCopied ? <CheckIcon /> : <CopyIcon />}
                          </button>
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

interface NewSecretRowProps {
  readonly value: NewSecret;
  /** Why a field can't be kept as typed, or `null` if it can. */
  readonly errors: (field: SecretField) => string | null;
  readonly onChange: (field: SecretField, value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/**
 * The row Add puts at the top of the table: a box for each of the four
 * fields, typed in by hand, with ✓ to keep it and × to let it go. Unlike a
 * saved row's boxes, leaving one keeps nothing — the row is kept whole or
 * not at all: ✓, or Enter in any box. Escape lets the row go. The name box
 * takes the keyboard as the row appears; the secret's box is dotted unless
 * it's hovered or being typed in.
 */
function NewSecretRow({ value, errors, onChange, onSave, onCancel }: NewSecretRowProps) {
  const [secretShown, setSecretShown] = useState(false);
  const [secretFocused, setSecretFocused] = useState(false);
  const fields: readonly { field: SecretField; label: string; maxLength: number; className: string }[] = [
    { field: 'name', label: 'New secret name', maxLength: MAX_SECRET_NAME_CHARS, className: 'secrets__cell--editable' },
    { field: 'source', label: 'New secret source URL', maxLength: MAX_SECRET_SOURCE_CHARS, className: 'secrets__cell--editable' },
    { field: 'element', label: 'New secret element', maxLength: MAX_SECRET_ELEMENT_CHARS, className: 'secrets__cell--editable' },
    { field: 'secret', label: 'New secret', maxLength: MAX_SECRET_VALUE_CHARS, className: 'secrets__cell--editable' },
  ];
  const placeholders: Record<SecretField, string> = {
    name: 'Name',
    source: 'https://example.com/login',
    element: 'input[name="email"]',
    secret: 'Secret',
  };
  return (
    <tr
      className="history__row secrets__row--new"
      onMouseEnter={() => setSecretShown(true)}
      onMouseLeave={() => setSecretShown(false)}
    >
      {fields.map(({ field, label, maxLength, className }) => (
        <td key={field} className={`history__cell ${className}`}>
          <EditField
            label={label}
            value={value[field]}
            error={errors(field)}
            maxLength={maxLength}
            placeholder={placeholders[field]}
            autoFocus={field === 'name'}
            masked={field === 'secret' && !secretShown && !secretFocused}
            onChange={(next) => onChange(field, next)}
            onRevert={onCancel}
            onCommit={() => undefined}
            onEnter={onSave}
            onFocusChange={(focused) => {
              if (field === 'secret') {
                setSecretFocused(focused);
              }
            }}
          />
        </td>
      ))}
      <td className="history__cell history__cell--actions">
        <div className="history__actions secrets__actions--new">
          <button
            type="button"
            className="history__action-button hover-grow secrets__save"
            aria-label="Add this secret"
            title="Add secret"
            onClick={onSave}
          >
            <CheckIcon />
          </button>
          <button
            type="button"
            className="history__action-button hover-grow history__delete secrets__cancel"
            aria-label="Don't add this secret"
            title="Cancel"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
      </td>
    </tr>
  );
}

interface EditFieldProps {
  readonly label: string;
  readonly value: string;
  /** Why what's typed can't be kept, or `null` if it can: marked in red, with the reason on hover. */
  readonly error: string | null;
  readonly maxLength: number;
  /** Shown as dots (a password box) rather than as typed. */
  readonly masked?: boolean;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly onChange: (value: string) => void;
  /** Puts back the saved value. */
  readonly onRevert: () => void;
  /** Keeps what's typed, if it can be. */
  readonly onCommit: () => void;
  /** What Enter does instead of leaving the box (Add's row keeps itself whole on Enter); omitted, Enter leaves it. */
  readonly onEnter?: () => void;
  /** Told when the box gains or loses the keyboard. */
  readonly onFocusChange?: (focused: boolean) => void;
}

/**
 * One of an edited row's boxes — the Bookmarks table's (`BookmarksViewer`),
 * with a masked form for the secret. Leaving it (or Enter) keeps what's
 * typed; while it's marked in red, Enter puts back the saved value instead.
 * Escape always puts it back.
 */
function EditField({
  label,
  value,
  error,
  maxLength,
  masked = false,
  placeholder,
  autoFocus = false,
  onChange,
  onRevert,
  onCommit,
  onEnter,
  onFocusChange,
}: EditFieldProps) {
  return (
    <input
      className={`bookmarks__input${error ? ' bookmarks__input--invalid' : ''}`}
      type={masked ? 'password' : 'text'}
      aria-label={label}
      aria-invalid={error !== null}
      title={error ? (onEnter ? error : `${error} (Enter puts back the saved one)`) : undefined}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      autoFocus={autoFocus}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => {
        onFocusChange?.(false);
        onCommit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onEnter) {
          event.preventDefault();
          onEnter();
        } else if (event.key === 'Escape' || (event.key === 'Enter' && error)) {
          event.preventDefault();
          onRevert();
        } else if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}
