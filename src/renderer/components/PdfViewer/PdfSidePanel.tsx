// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MarkdownBacklink } from '@shared/ipc-contract';
import { findSectionProblems, sortSections, type PdfSection } from '@shared/pdf/sections';
import { PencilIcon } from '../icons';
import { formatShortcut } from '../../lib/shortcuts';
import { CornerButton, SidePanel, type SidePanelTab } from '../SidePanel';
import type { PdfOutboundLink } from './readPdfStructure';

type PanelTab = 'sections' | 'backlinks' | 'outbound';

/** The panel's tabs, in order, with their labels. */
const PANEL_TABS: readonly SidePanelTab<PanelTab>[] = [
  { tab: 'sections', label: 'Sections' },
  { tab: 'backlinks', label: 'Backlinks' },
  { tab: 'outbound', label: 'Outbound' },
];

/** The sections' edit shortcut, after Ctrl (the menu's `CmdOrCtrl+Alt+E`, see `buildMenu.ts`). */
const EDIT_SECTIONS_KEYS = 'Alt+E';

/** The longest section name that can be typed (the store's cap, see `ipc-schemas.ts`). */
const MAX_TITLE_CHARS = 500;

/** A section as the panel holds it: with an id, so a row being edited keeps its boxes as rows around it come and go. */
export interface EditableSection extends PdfSection {
  readonly id: string;
}

interface PdfSidePanelProps {
  /** The sections showing: as edited, or else as read from the file; `null` while the file is still being read. */
  readonly sections: readonly EditableSection[] | null;
  /** Whether `sections` are the user's own edit (which Reset can undo). */
  readonly edited: boolean;
  /** Whether the file's sections came from its own outline, not guessed from its headings. */
  readonly fromOutline: boolean;
  /** The document's links; `null` while it's still being read. */
  readonly links: readonly PdfOutboundLink[] | null;
  readonly pageCount: number;
  /** The page in view: where a section added in edit mode starts. */
  readonly currentPage: number;
  /** Changes with each document opened, so the backlinks are asked for again. */
  readonly docKey: string;
  /** Brings a page's top into view. */
  readonly onGoToPage: (page: number) => void;
  /** Opens a web link in a new tab. */
  readonly onOpenUrl: (url: string) => void;
  /** Replaces the sections with an edit of them; `null` goes back to the file's own. */
  readonly onChangeSections: (sections: readonly EditableSection[] | null) => void;
  /** Puts back the last edit with nothing marked in red (or the file's own sections): leaving edit mode with problems. */
  readonly onRevertSections: () => void;
  /** Bumped by the edit shortcut (Ctrl+Alt+E): goes to the sections and switches edit mode on or off. 0 while none. */
  readonly editRequest: number;
}

/**
 * The PDF's right-hand panel, like a note's: its sections (the file's own
 * outline, or else each page's heading read from its text; click to go to
 * the page, the pencil beside the panel's toggle or Ctrl+Alt+E to rename,
 * renumber, add or remove them), its backlinks (the notes that link to the
 * file; click to open one in a new tab) and its outbound links (every link in
 * it; click to follow).
 */
export function PdfSidePanel({
  sections,
  edited,
  fromOutline,
  links,
  pageCount,
  currentPage,
  docKey,
  onGoToPage,
  onOpenUrl,
  onChangeSections,
  onRevertSections,
  editRequest,
}: PdfSidePanelProps) {
  const [tab, setTab] = useState<PanelTab>('sections');
  const [editing, setEditing] = useState(false);
  const [backlinks, setBacklinks] = useState<readonly MarkdownBacklink[] | null>(null);

  useEffect(() => {
    if (tab !== 'backlinks') {
      return undefined;
    }
    let current = true;
    setBacklinks(null);
    void window.northstarPdf.getBacklinks().then((found) => {
      if (current) {
        setBacklinks(found);
      }
    });
    return () => {
      current = false;
    };
  }, [tab, docKey]);

  /** The box last typed in: of a repeated name or page, that box is the one marked, not the one it now matches. */
  const [lastEdit, setLastEdit] = useState<{ readonly id: string; readonly field: 'title' | 'page' } | null>(null);

  // Another document starts out of edit mode.
  useEffect(() => {
    setEditing(false);
    setLastEdit(null);
  }, [docKey]);

  const lastEditIndex = lastEdit ? (sections ?? []).findIndex((section) => section.id === lastEdit.id) : -1;
  const problems = findSectionProblems(
    sections ?? [],
    pageCount,
    lastEdit && lastEditIndex >= 0 ? { index: lastEditIndex, field: lastEdit.field } : null,
  );
  const hasProblems = editing && (problems.titles.size > 0 || problems.pages.size > 0);

  /**
   * Switches edit mode. Leaving it puts the sections in page order, as they're listed; any box still marked in red
   * goes back to the last edit that had none.
   */
  const toggleEditing = (): void => {
    if (hasProblems) {
      onRevertSections();
    } else if (editing && edited && sections) {
      onChangeSections(sortSections(sections));
    }
    setEditing((on) => !on);
  };

  // The shortcut: the sections come into view, and edit mode switches.
  const toggleRef = useRef(toggleEditing);
  toggleRef.current = toggleEditing;
  // From 0, not the first value: a panel opened by the shortcut itself arrives with a request already waiting.
  const lastRequestRef = useRef(0);
  useEffect(() => {
    if (editRequest === lastRequestRef.current) {
      return;
    }
    lastRequestRef.current = editRequest;
    setTab('sections');
    if (sections !== null) {
      toggleRef.current();
    }
  }, [editRequest, sections]);

  const patch = (id: string, change: Partial<PdfSection>): void => {
    onChangeSections((sections ?? []).map((section) => (section.id === id ? { ...section, ...change } : section)));
  };

  const renderSections = (): ReactNode => {
    if (sections === null) {
      return <p className="side-panel__empty">Reading…</p>;
    }
    if (editing) {
      return (
        <>
          <ul className="side-panel__list">
            {sections.map((section, index) => (
              <li key={section.id} className="side-panel__edit-row">
                <TitleField
                  title={section.title}
                  invalid={problems.titles.has(index)}
                  onChange={(title) => {
                    setLastEdit({ id: section.id, field: 'title' });
                    patch(section.id, { title });
                  }}
                />
                <PageField
                  page={section.page}
                  pageCount={pageCount}
                  invalid={problems.pages.has(index)}
                  onChange={(page) => {
                    setLastEdit({ id: section.id, field: 'page' });
                    patch(section.id, { page });
                  }}
                />
                <button
                  type="button"
                  className="side-panel__remove hover-grow"
                  aria-label={`Remove ${section.title || 'section'}`}
                  title="Remove section"
                  onClick={() => onChangeSections(sections.filter((s) => s.id !== section.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {hasProblems && (
            <p className="side-panel__error">Boxes marked in red go back to their last good values when you finish.</p>
          )}
          <div className="side-panel__edit-footer">
            <button
              type="button"
              className="side-panel__action hover-grow"
              onClick={() =>
                onChangeSections([...sections, { id: crypto.randomUUID(), title: newSectionTitle(sections), page: currentPage, level: 0 }])
              }
            >
              Add section
            </button>
            {edited && (
              <button
                type="button"
                className="side-panel__action hover-grow"
                title={fromOutline ? "Back to the file's own outline" : 'Back to the headings read from the file'}
                onClick={() => onChangeSections(null)}
              >
                Reset
              </button>
            )}
          </div>
        </>
      );
    }
    if (sections.length === 0) {
      return <p className="side-panel__empty">No sections found. Use Edit to add some.</p>;
    }
    return (
      <ul className="side-panel__list">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className="side-panel__item side-panel__item--section"
              title={`${section.title} (page ${section.page})`}
              onClick={() => onGoToPage(section.page)}
            >
              <span className="side-panel__section-title">{section.title || 'Untitled'}</span>
              <span className="side-panel__section-page">{section.page}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const renderList = (): ReactNode => {
    if (tab === 'sections') {
      return renderSections();
    }
    if (tab === 'backlinks') {
      if (backlinks === null) {
        return <p className="side-panel__empty">Looking…</p>;
      }
      return backlinks.length === 0 ? (
        <p className="side-panel__empty">No notes link here.</p>
      ) : (
        <ul className="side-panel__list">
          {backlinks.map((link) => (
            <li key={link.target}>
              <button
                type="button"
                className="side-panel__item"
                title={link.target}
                onClick={() => window.northstarPdf.openBacklink(link.target)}
              >
                {link.name}
              </button>
            </li>
          ))}
        </ul>
      );
    }
    if (links === null) {
      return <p className="side-panel__empty">Reading…</p>;
    }
    return links.length === 0 ? (
      <p className="side-panel__empty">No links in this document.</p>
    ) : (
      <ul className="side-panel__list">
        {links.map((link, index) => {
          const target = link.url ?? (link.targetPage !== null ? `Page ${link.targetPage}` : '');
          return (
            <li key={`${index}-${link.url ?? link.targetPage}`}>
              <button
                type="button"
                className="side-panel__item side-panel__item--link"
                title={`${target} (on page ${link.page})`}
                onClick={() => {
                  if (link.url !== null) {
                    onOpenUrl(link.url);
                  } else if (link.targetPage !== null) {
                    onGoToPage(link.targetPage);
                  }
                }}
              >
                <span className="side-panel__link-label">{link.label}</span>
                {link.label !== target && <span className="side-panel__link-target">{target}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      {/* Beside the panel's toggle, in the frame's corner, while the sections are showing. */}
      {tab === 'sections' && sections !== null && (
        <CornerButton
          className="side-panel-toggle--edit"
          label={editing ? 'Finish editing sections' : 'Edit section names and pages'}
          shortcut={formatShortcut(EDIT_SECTIONS_KEYS)}
          pressed={editing}
          onClick={toggleEditing}
        >
          <PencilIcon size={15} />
        </CornerButton>
      )}
      <SidePanel label="Sections and links" tabs={PANEL_TABS} active={tab} onTab={setTab}>
        {renderList()}
      </SidePanel>
    </>
  );
}

/** "New section", numbered past any already taken, so an added section's name is never a repeat. */
function newSectionTitle(sections: readonly PdfSection[]): string {
  const taken = new Set(sections.map((section) => section.title.trim().toLowerCase()));
  let title = 'New section';
  for (let n = 2; taken.has(title.toLowerCase()); n += 1) {
    title = `New section ${n}`;
  }
  return title;
}

interface TitleFieldProps {
  readonly title: string;
  /** Empty, or another section's name too: marked in red. */
  readonly invalid: boolean;
  readonly onChange: (title: string) => void;
}

/**
 * The most recent value a box held while it was valid — what Enter puts back
 * in it when what's typed can't be kept.
 * @param value The box's value now.
 * @param valid Whether it can be kept.
 */
function useLastValid<T>(value: T, valid: boolean): T {
  const lastValid = useRef(value);
  useEffect(() => {
    if (valid) {
      lastValid.current = value;
    }
  }, [value, valid]);
  return valid ? value : lastValid.current;
}

/** A section's name box. Marked in red while it's empty or repeats another's; Enter then puts back the last good name. */
function TitleField({ title, invalid, onChange }: TitleFieldProps) {
  const lastValid = useLastValid(title, !invalid);
  return (
    <input
      className={`side-panel__input side-panel__input--title${invalid ? ' side-panel__input--invalid' : ''}`}
      aria-label="Section name"
      aria-invalid={invalid}
      title={invalid ? 'Each section needs a name of its own (Enter puts back the last one that was)' : undefined}
      value={title}
      maxLength={MAX_TITLE_CHARS}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && invalid) {
          event.preventDefault();
          onChange(lastValid);
        }
      }}
    />
  );
}

interface PageFieldProps {
  readonly page: number;
  readonly pageCount: number;
  /** The page is another section's too (or not in the document): marked in red. */
  readonly invalid: boolean;
  readonly onChange: (page: number) => void;
}

/**
 * A section's page box. It can be cleared while a new number is typed; only
 * a page the document has is kept, and leaving the box shows the page kept.
 * Marked in red while it's empty, past the document's end, or another
 * section's page; Enter then puts back the last good page.
 */
function PageField({ page, pageCount, invalid, onChange }: PageFieldProps) {
  const [text, setText] = useState(String(page));
  const typed = Number(text);
  const marked = invalid || text === '' || typed < 1 || typed > pageCount;
  const lastValid = useLastValid(page, !invalid);
  useEffect(() => {
    setText(String(page));
  }, [page]);
  return (
    <input
      className={`side-panel__input side-panel__input--page${marked ? ' side-panel__input--invalid' : ''}`}
      aria-label="Page"
      aria-invalid={marked}
      title={marked ? `A page from 1 to ${pageCount} that no other section has (Enter puts back the last one)` : undefined}
      inputMode="numeric"
      value={text}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
        setText(digits);
        const next = Number(digits);
        if (digits !== '' && next >= 1 && next <= pageCount) {
          onChange(next);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && marked) {
          event.preventDefault();
          onChange(lastValid);
          setText(String(lastValid));
        }
      }}
      onBlur={() => setText(String(page))}
    />
  );
}
