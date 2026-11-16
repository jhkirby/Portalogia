// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { MarkdownFormatAction } from '@shared/ipc-contract';
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from '../../lib/markdown/editorFormat';
import { formatShortcut } from '../../lib/shortcuts';

/** The right-click menu's entries, in order: what each does and the keys that do the same from the keyboard. */
const MENU_ITEMS: readonly { readonly action: MarkdownFormatAction; readonly label: string; readonly keys: string }[] = [
  { action: 'bold', label: 'Bold', keys: 'B' },
  { action: 'italic', label: 'Italic', keys: 'I' },
  { action: 'link', label: 'Make a link…', keys: 'Shift+U' },
  { action: 'latex', label: 'Wrap in LaTeX block', keys: 'Shift+L' },
  { action: 'code', label: 'Wrap in code block', keys: 'Shift+K' },
];

interface EditorContextMenuProps {
  /** Where the right-click happened, in page pixels. */
  readonly x: number;
  readonly y: number;
  readonly onPick: (action: MarkdownFormatAction) => void;
  readonly onClose: () => void;
}

/**
 * The small menu a right-click in the editor opens. Each row has a tooltip
 * with its keyboard command. It keeps the editor's selection (rows take no
 * focus), and goes away on a pick, Escape, a click elsewhere or a scroll.
 */
export function EditorContextMenu({ x, y, onPick, onClose }: EditorContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The menu is kept inside the page, and its tooltips open to whichever side has room.
  const [placement, setPlacement] = useState<{ left: number; top: number; flip: boolean }>({ left: x, top: y, flip: false });

  useEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) {
      return;
    }
    const left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4));
    setPlacement({ left, top, flip: left + box.width + 280 > window.innerWidth });
  }, [x, y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`md-menu${placement.flip ? ' md-menu--flip' : ''}`}
      role="menu"
      style={{ left: placement.left, top: placement.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {MENU_ITEMS.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className="md-menu__item"
          data-tooltip={`${item.label.replace('…', '')} (${formatShortcut(item.keys)})`}
          // A press must not take focus from the editor, or its selection would be lost before the menu acts on it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(item.action)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

interface TablePopupProps {
  /** Where to open it, in page pixels (under the caret). */
  readonly x: number;
  readonly y: number;
  readonly onSubmit: (rows: number, columns: number) => void;
  readonly onCancel: () => void;
}

/** The size the table box starts at: a header row and two more, three columns. */
const DEFAULT_TABLE_ROWS = 3;
const DEFAULT_TABLE_COLUMNS = 3;

/**
 * The box the Table button opens: how many rows (the header row included) and columns, in two number boxes. Enter
 * makes the table at the caret; Escape, or leaving the box, cancels. Each box only takes digits, clamped to
 * `TABLE_MAX_ROWS` × `TABLE_MAX_COLUMNS`.
 */
export function TablePopup({ x, y, onSubmit, onCancel }: TablePopupProps) {
  const [rows, setRows] = useState(String(DEFAULT_TABLE_ROWS));
  const [columns, setColumns] = useState(String(DEFAULT_TABLE_COLUMNS));
  const boxRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    rowsRef.current?.focus();
    rowsRef.current?.select();
  }, []);

  /** A box's number, or `null` while it holds nothing usable. */
  const parse = (text: string, max: number): number | null => {
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) && value >= 1 ? Math.min(value, max) : null;
  };
  const rowCount = parse(rows, TABLE_MAX_ROWS);
  const columnCount = parse(columns, TABLE_MAX_COLUMNS);

  const commit = (): void => {
    if (rowCount !== null && columnCount !== null) {
      onSubmit(rowCount, columnCount);
    }
  };

  const field = (
    label: string,
    value: string,
    setValue: (next: string) => void,
    max: number,
    ref?: Ref<HTMLInputElement>,
  ) => (
    <label className="md-table-box__field">
      <span className="md-table-box__name">{label}</span>
      <input
        ref={ref}
        className="md-link__input md-table-box__input"
        type="text"
        inputMode="numeric"
        aria-label={`${label} (1 to ${max})`}
        value={value}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 3))}
      />
    </label>
  );

  return (
    <div
      ref={boxRef}
      className="md-link md-table-box"
      style={{ left: Math.min(x, window.innerWidth - 240), top: y }}
      role="dialog"
      aria-label="Insert a table"
      onKeyDown={(event) => {
        // Keeps the viewer's own shortcuts out of typing.
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
      // Leaving the box (not just moving between its two fields) cancels it.
      onBlur={(event) => {
        if (!boxRef.current?.contains(event.relatedTarget as Node | null)) {
          onCancel();
        }
      }}
    >
      <div className="md-link__label">Insert a table</div>
      <div className="md-table-box__fields">
        {field('Rows', rows, setRows, TABLE_MAX_ROWS, rowsRef)}
        <span className="md-table-box__by" aria-hidden="true">
          ×
        </span>
        {field('Columns', columns, setColumns, TABLE_MAX_COLUMNS)}
      </div>
      <button
        type="button"
        className="md-table-box__create"
        disabled={rowCount === null || columnCount === null}
        // Chosen on press, before the inputs' blur can close the box.
        onMouseDown={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        Create
      </button>
    </div>
  );
}

interface LinkPopupProps {
  /** Where to open it, in page pixels (under the selection). */
  readonly x: number;
  readonly y: number;
  /** The text being linked, shown so it's clear what the link will wrap; empty if nothing was selected. */
  readonly label: string;
  /** The names of the notes in the vault, to offer as the user types. */
  readonly listNotes: () => Promise<readonly string[]>;
  readonly onSubmit: (target: string) => void;
  readonly onCancel: () => void;
}

/**
 * The box "Make a link…" opens: type a web address or the name of a note
 * (matching notes are listed; Up/Down and Enter pick one) and the selection
 * becomes a link to it. Enter confirms what's typed, Escape cancels.
 */
export function LinkPopup({ x, y, label, listNotes, onSubmit, onCancel }: LinkPopupProps) {
  const [draft, setDraft] = useState('');
  const [names, setNames] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    let current = true;
    void listNotes().then((found) => {
      if (current) {
        setNames(found);
      }
    });
    return () => {
      current = false;
    };
  }, [listNotes]);

  const matches = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return needle === '' || /^(https?:|mailto:|www\.)/.test(needle)
      ? []
      : names.filter((name) => name.toLowerCase().includes(needle)).slice(0, 6);
  }, [draft, names]);

  const commit = (value: string): void => {
    if (value.trim() !== '') {
      onSubmit(value.trim());
    }
  };

  return (
    <div className="md-link" style={{ left: Math.min(x, window.innerWidth - 320), top: y }} role="dialog" aria-label="Make a link">
      <div className="md-link__label">{label === '' ? 'Link to a web address or a note' : `Link “${label.length > 40 ? `${label.slice(0, 40)}…` : label}”`}</div>
      <input
        ref={inputRef}
        className="md-link__input"
        type="text"
        value={draft}
        placeholder="https://… or a note's name"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          setSelected(-1);
        }}
        onKeyDown={(event) => {
          // Keeps the viewer's own shortcuts out of typing.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commit(matches[selected] ?? draft);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected((index) => Math.min(index + 1, matches.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected((index) => Math.max(index - 1, -1));
          }
        }}
        onBlur={onCancel}
      />
      {matches.length > 0 && (
        <ul className="md-link__list">
          {matches.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                className={`md-link__option${index === selected ? ' md-link__option--selected' : ''}`}
                // Chosen on press, before the input's blur can close the popup.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(name);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
