// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-11-21

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CALLOUT_PICKER_TYPES, calloutKind } from '@shared/markdown/callouts';
import { isWebAddress } from '../../lib/markdown/editorFormat';

/** Where a popup is anchored: a rectangle on the page (an element's, or the caret's), in viewport pixels. */
export interface Anchor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The gap between a popup and what it belongs to. */
const GAP_PX = 6;

/** The margin a popup keeps from the window's edges. */
const EDGE_PX = 4;

interface FloatingProps {
  readonly anchor: Anchor;
  /** Above the anchor (a bar over a table or heading) or below it (a box under the caret). */
  readonly side: 'above' | 'below';
  /** Line the popup up with the anchor's left edge, or its right. */
  readonly align?: 'start' | 'end';
  readonly className?: string;
  readonly label: string;
  readonly role?: 'toolbar' | 'dialog' | 'menu';
  readonly children: ReactNode;
}

/**
 * A small box fixed beside part of the note, kept inside the window: above
 * or below what it belongs to, flipping to the other side when there's no
 * room. Presses on it don't take the caret out of the note (its fields may).
 */
export function Floating({ anchor, side, align = 'start', className = '', label, role = 'toolbar', children }: FloatingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Measured after every render, not only when the anchor moves: what's inside can change size (a list of matching
  // notes opening). The state only changes when the place does, so this settles at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) {
      return;
    }
    const above = anchor.top - GAP_PX - box.height;
    const below = anchor.bottom + GAP_PX;
    let top = side === 'above' ? above : below;
    if (side === 'above' && top < EDGE_PX) {
      top = below;
    } else if (side === 'below' && top + box.height > window.innerHeight - EDGE_PX) {
      top = Math.max(EDGE_PX, above);
    }
    const wanted = align === 'end' ? anchor.right - box.width : anchor.left;
    const left = Math.max(EDGE_PX, Math.min(wanted, window.innerWidth - box.width - EDGE_PX));
    setPlace((previous) => (previous && previous.left === left && previous.top === top ? previous : { left, top }));
  });

  return (
    <div
      ref={ref}
      className={`fm-pop ${className}`}
      role={role}
      aria-label={label}
      // Unplaced, it's only transparent (not hidden), so a field in it can take the keyboard as it opens.
      style={{
        left: place?.left ?? anchor.left,
        top: place?.top ?? anchor.bottom + GAP_PX,
        opacity: place ? 1 : 0,
        pointerEvents: place ? undefined : 'none',
      }}
      onMouseDown={(event) => {
        // Buttons keep the caret where it is; only a field takes the keyboard.
        if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)) {
          event.preventDefault();
        }
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

interface BarButtonProps {
  readonly label: string;
  readonly tooltip?: string;
  readonly active?: boolean;
  readonly danger?: boolean;
  readonly onPress: () => void;
  readonly children?: ReactNode;
}

/** A button in a popup bar: acts on press, so the note keeps its selection. */
export function BarButton({ label, tooltip, active = false, danger = false, onPress, children }: BarButtonProps) {
  return (
    <button
      type="button"
      className={`fm-pop__button${active ? ' fm-pop__button--active' : ''}${danger ? ' fm-pop__button--danger' : ''}`}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={tooltip ?? label}
      onMouseDown={(event) => {
        event.preventDefault();
        onPress();
      }}
    >
      {children ?? label}
    </button>
  );
}

/** The ✕ that removes an element, in the same place on every bar. */
export function RemoveButton({ what, onPress }: { readonly what: string; readonly onPress: () => void }) {
  return (
    <BarButton label={`Remove the ${what}`} danger onPress={onPress}>
      ✕
    </BarButton>
  );
}

// ── HEADINGS ────────────────────────────────────────────────────────────

/** The sizes a heading can be: normal text, then H1 to H6. */
const HEADING_LEVELS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Normal text, H1…H6, the current one marked. */
export function HeadingButtons({ level, onPick }: { readonly level: number; readonly onPick: (level: number) => void }) {
  return (
    <>
      {HEADING_LEVELS.map((candidate) => (
        <BarButton
          key={candidate}
          label={candidate === 0 ? 'Normal text' : `Heading ${candidate}`}
          tooltip={candidate === 0 ? 'Normal text (Ctrl+Alt+0)' : `Heading ${candidate} (Ctrl+Alt+${candidate})`}
          active={candidate === level}
          onPress={() => onPick(candidate)}
        >
          {candidate === 0 ? 'Text' : `H${candidate}`}
        </BarButton>
      ))}
    </>
  );
}

// ── DROPDOWNS ───────────────────────────────────────────────────────────

/** One choice in a `PopSelect`. */
interface PopSelectOption {
  readonly value: string;
  readonly label: string;
  /** Drawn before the label (a callout type's colour). */
  readonly icon?: ReactNode;
}

interface PopSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly PopSelectOption[];
  readonly onChange: (value: string) => void;
}

/**
 * A dropdown drawn in the app's own look, not the system's: a button showing
 * the choice, and under it a list like the editor's other menus (the
 * system's list ignores the theme and the accent colour). Opens on a click or
 * Down/Up; Up/Down/Home/End move, Enter or Space chooses, Escape or leaving
 * it closes. The keyboard stays on the button throughout.
 */
export function PopSelect({ label, value, options, onChange }: PopSelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];

  const show = (): void => {
    setActive(selectedIndex);
    setOpen(true);
  };
  const choose = (index: number): void => {
    const option = options[index];
    setOpen(false);
    if (option && option.value !== value) {
      onChange(option.value);
    }
  };

  return (
    <div className="fm-select">
      <button
        ref={buttonRef}
        type="button"
        className={`fm-select__button${open ? ' fm-select__button--open' : ''}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Taken on press (the bar keeps presses from moving the keyboard), so the list's keys reach it.
        onMouseDown={(event) => {
          event.preventDefault();
          buttonRef.current?.focus();
          if (open) {
            setOpen(false);
          } else {
            show();
          }
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          const last = options.length - 1;
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            show();
          } else if (open && event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, last));
          } else if (open && event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (open && event.key === 'Home') {
            event.preventDefault();
            setActive(0);
          } else if (open && event.key === 'End') {
            event.preventDefault();
            setActive(last);
          } else if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            choose(active);
          } else if (open && event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        {selected?.icon}
        <span className="fm-select__label">{selected?.label ?? ''}</span>
        <span className="fm-select__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="fm-select__list" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <div
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`fm-menu__item${index === active ? ' fm-menu__item--selected' : ''}${option.value === value ? ' fm-menu__item--current' : ''}`}
              onMouseEnter={() => setActive(index)}
              // Chosen on press, before the button's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
            >
              {option.icon}
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CALLOUTS ────────────────────────────────────────────────────────────

/** A swatch of a callout type's colour. */
function CalloutSwatch({ type }: { readonly type: string }) {
  return <span className={`fm-swatch fm-swatch--${calloutKind(type).family}`} aria-hidden="true" />;
}

/** The list of callout types to pick from, each with its colour; Up/Down and Enter work too. */
export function CalloutTypeMenu({ onPick, onCancel }: { readonly onPick: (type: string) => void; readonly onCancel: () => void }) {
  const [selected, setSelected] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      className="fm-menu"
      role="menu"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSelected((index) => Math.min(index + 1, CALLOUT_PICKER_TYPES.length - 1));
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSelected((index) => Math.max(index - 1, 0));
        } else if (event.key === 'Enter') {
          event.preventDefault();
          onPick(CALLOUT_PICKER_TYPES[selected] ?? 'note');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
    >
      {CALLOUT_PICKER_TYPES.map((type, index) => (
        <button
          key={type}
          type="button"
          role="menuitem"
          className={`fm-menu__item${index === selected ? ' fm-menu__item--selected' : ''}`}
          onMouseEnter={() => setSelected(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(type);
          }}
        >
          <CalloutSwatch type={type} />
          {calloutKind(type).title}
        </button>
      ))}
    </div>
  );
}

/** The fold settings a callout can have, as written after its `[!type]`. */
const FOLDS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: 'Not foldable' },
  { value: '+', label: 'Foldable, open' },
  { value: '-', label: 'Foldable, closed' },
];

interface CalloutFieldsProps {
  readonly type: string;
  readonly title: string;
  readonly fold: string;
  readonly onChange: (attrs: { type?: string; title?: string; fold?: string }) => void;
  readonly onRemove: () => void;
}

/** A callout's settings: its type, its title (blank shows the type's own), how it folds, and ✕ to unwrap it. */
export function CalloutFields({ type, title, fold, onChange, onRemove }: CalloutFieldsProps) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const known = CALLOUT_PICKER_TYPES.includes(type.toLowerCase());
  return (
    <>
      <PopSelect
        label="Callout type"
        value={known ? type.toLowerCase() : type}
        options={[...(known ? [] : [type]), ...CALLOUT_PICKER_TYPES].map((candidate) => ({
          value: candidate,
          label: calloutKind(candidate).title,
          icon: <CalloutSwatch type={candidate} />,
        }))}
        onChange={(value) => onChange({ type: value })}
      />
      <input
        className="fm-pop__input"
        aria-label="Callout title"
        placeholder={calloutKind(type).title}
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== title && onChange({ title: draft.replace(/\n/g, ' ').trim() })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onChange({ title: draft.replace(/\n/g, ' ').trim() });
          }
        }}
      />
      <PopSelect label="Folding" value={fold} options={FOLDS} onChange={(value) => onChange({ fold: value })} />
      <RemoveButton what="callout (its text is kept)" onPress={onRemove} />
    </>
  );
}

// ── LINKS ───────────────────────────────────────────────────────────────

/** What the link box edits: a web link (`[text](url)`) or a note link (`[[note#heading|text]]`). */
export interface LinkDraft {
  readonly text: string;
  readonly target: string;
  readonly heading: string;
}

interface LinkEditorProps {
  readonly initial: LinkDraft;
  /** Whether a link is being edited (rather than made), so Unlink applies. */
  readonly existing: boolean;
  readonly listNotes: () => Promise<readonly string[]>;
  readonly onSave: (draft: LinkDraft) => void;
  readonly onUnlink: () => void;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}

/**
 * The link box: the text shown, what it links to (a web address, or a note —
 * matching notes are offered as it's typed), and for a note the heading in
 * it to go to. Enter saves, Escape cancels; Unlink keeps the text, ✕ removes
 * the link and its text.
 */
export function LinkEditor({ initial, existing, listNotes, onSave, onUnlink, onRemove, onCancel }: LinkEditorProps) {
  const [draft, setDraft] = useState(initial);
  const [names, setNames] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState(-1);
  const [listOpen, setListOpen] = useState(false);
  const targetRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    targetRef.current?.focus();
    targetRef.current?.select();
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

  const toWeb = draft.target.trim() === '' || isWebAddress(draft.target.trim()) || /^(#|mailto:)/i.test(draft.target.trim());
  const matches = useMemo(() => {
    const needle = draft.target.trim().toLowerCase();
    return !listOpen || needle === '' || toWeb ? [] : names.filter((name) => name.toLowerCase().includes(needle)).slice(0, 6);
  }, [draft.target, names, toWeb, listOpen]);

  const save = (next: LinkDraft = draft): void => {
    if (next.target.trim() !== '') {
      onSave({ text: next.text, target: next.target.trim(), heading: next.heading.trim() });
    }
  };

  return (
    <div
      ref={boxRef}
      className="fm-link"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
          event.preventDefault();
          const picked = matches[selected];
          save(picked ? { ...draft, target: picked } : draft);
        }
      }}
      onBlur={(event) => {
        if (!boxRef.current?.contains(event.relatedTarget as globalThis.Node | null)) {
          onCancel();
        }
      }}
    >
      <div className="fm-link__head">
        <span className="fm-link__kind">{toWeb ? 'Web link' : 'Note link'}</span>
        {existing && <RemoveButton what="link and its text" onPress={onRemove} />}
      </div>
      <label className="fm-link__field">
        <span>Text</span>
        <input
          className="fm-pop__input"
          value={draft.text}
          placeholder="Shown as"
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        />
      </label>
      <label className="fm-link__field">
        <span>Link to</span>
        <input
          ref={targetRef}
          className="fm-pop__input"
          value={draft.target}
          placeholder="https://… or a note's name"
          spellCheck={false}
          onChange={(event) => {
            setDraft({ ...draft, target: event.target.value });
            setSelected(-1);
            setListOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((index) => Math.max(index - 1, -1));
            }
          }}
        />
      </label>
      {matches.length > 0 && (
        <ul className="md-link__list">
          {matches.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                className={`md-link__option${index === selected ? ' md-link__option--selected' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setDraft({ ...draft, target: name });
                  setListOpen(false);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!toWeb && (
        <label className="fm-link__field">
          <span>Heading</span>
          <input
            className="fm-pop__input"
            value={draft.heading}
            placeholder="Optional: a heading in that note"
            onChange={(event) => setDraft({ ...draft, heading: event.target.value })}
          />
        </label>
      )}
      <div className="fm-link__actions">
        {existing && <BarButton label="Unlink" tooltip="Remove the link, keep the text" onPress={onUnlink} />}
        <BarButton label="Save" tooltip="Save (Enter)" active onPress={() => save()} />
      </div>
    </div>
  );
}

// ── IMAGES ──────────────────────────────────────────────────────────────

interface ImageFieldsProps {
  readonly alt: string;
  readonly width: number | null;
  readonly onAlt: (alt: string) => void;
  readonly onChangeImage: () => void;
  readonly onResetSize: () => void;
  readonly onRemove: () => void;
}

/** A selected picture's settings: change it for another file, its description, its size back to natural, ✕. */
export function ImageFields({ alt, width, onAlt, onChangeImage, onResetSize, onRemove }: ImageFieldsProps) {
  const [draft, setDraft] = useState(alt);
  useEffect(() => setDraft(alt), [alt]);
  return (
    <>
      <BarButton label="Change image…" tooltip="Pick another picture" onPress={onChangeImage} />
      <input
        className="fm-pop__input"
        aria-label="Description (alt text)"
        placeholder="Description"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== alt && onAlt(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onAlt(draft);
          }
        }}
      />
      {width !== null && <BarButton label="Natural size" tooltip={`Width ${width}px: back to the picture's own size`} onPress={onResetSize} />}
      <RemoveButton what="picture" onPress={onRemove} />
    </>
  );
}
