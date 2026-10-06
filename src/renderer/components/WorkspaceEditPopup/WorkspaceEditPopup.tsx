// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { RGB } from '@shared/color';
import { WORKSPACE_ICON_IDS } from '@shared/workspaceIcons';
import type { WorkspaceState } from '@shared/tab-state';
import { hexToRgb, rgbToHex } from '../../lib/color';
import { ColorWheel } from '../ColorWheel';
import { WorkspaceIcon } from '../WorkspaceIcon';

interface WorkspaceEditPopupProps {
  /** The workspace being edited, as it was when the popup opened. */
  readonly workspace: WorkspaceState;
  /** A data URL of the tab's last-painted frame, shown blurred behind the popup; `null` falls back to a plain scrim. */
  readonly previewImage: string | null;
  /** Commits the name, the icon's `#rrggbb` color, and the icon's id. */
  readonly onSave: (name: string, color: string, icon: string) => void;
  /** Cancels. The backdrop, the close button, and Escape all take this path; nothing is saved. */
  readonly onClose: () => void;
}

/** Shown in the icon list's tooltips: `'map-pin'` reads as "Map pin". */
function iconLabel(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The workspace editor, opened from a sidebar pill's pencil button (or
 * Ctrl+Shift+E for the active workspace): its name, a color wheel for the
 * icon's color, and a scrolling list of icons to pick from. Laid out and
 * layered like `BookmarkPopup`: it fills the tab area over a blurred still of
 * the page, since the tab's native view has come off the window. Like it, it
 * saves nothing until Save, so every other way out is a true cancel.
 */
export function WorkspaceEditPopup({ workspace, previewImage, onSave, onClose }: WorkspaceEditPopupProps) {
  const [name, setName] = useState(workspace.name);
  const [color, setColor] = useState<RGB>(() => hexToRgb(workspace.color) ?? { r: 66, g: 133, b: 244 });
  const [icon, setIcon] = useState(workspace.icon);
  const [isListOpen, setListOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const hex = rgbToHex(color);
  const canSave = name.trim().length > 0;

  // The icon list is a dropdown: a click anywhere else in the popup folds it away.
  useEffect(() => {
    if (!isListOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setListOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isListOpen]);

  const handleSave = (): void => {
    if (canSave) {
      onSave(name.trim(), hex, icon);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // The list is the innermost layer: Escape folds it before it cancels the whole editor.
      if (isListOpen) {
        setListOpen(false);
      } else {
        onClose();
      }
    } else if (event.key === 'Enter' && canSave && !isListOpen) {
      event.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="bookmark-popup__backdrop" onClick={onClose}>
      {previewImage && <img className="bookmark-popup__preview" src={previewImage} alt="" aria-hidden="true" />}
      <div className="bookmark-popup__scrim" aria-hidden="true" />
      <div
        className="bookmark-popup workspace-editor"
        role="dialog"
        aria-label="Edit Workspace"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="bookmark-popup__header">
          <h2 className="bookmark-popup__title">Edit Workspace</h2>
          <button type="button" className="bookmark-popup__close" onClick={onClose} aria-label="Cancel">
            ×
          </button>
        </div>

        <div className="workspace-editor__name-row">
          <input
            autoFocus
            className="bookmark-popup__input workspace-editor__name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="Workspace name"
            aria-label="Workspace name"
            maxLength={200}
          />
          <div ref={pickerRef} className="workspace-editor__icon-picker">
            <button
              type="button"
              className="workspace-editor__icon-button"
              onClick={() => setListOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={isListOpen}
              aria-label={`Icon: ${iconLabel(icon)}`}
            >
              <WorkspaceIcon icon={icon} color={hex} size={18} />
              <span className="workspace-editor__chevron" aria-hidden="true">
                ▾
              </span>
            </button>
            {isListOpen && (
              <div className="workspace-editor__icon-list" role="listbox" aria-label="Workspace icon">
                {WORKSPACE_ICON_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={id === icon}
                    className={`workspace-editor__icon-option${id === icon ? ' workspace-editor__icon-option--selected' : ''}`}
                    onClick={() => {
                      setIcon(id);
                      setListOpen(false);
                    }}
                    title={iconLabel(id)}
                    aria-label={iconLabel(id)}
                  >
                    <WorkspaceIcon icon={id} color={hex} size={18} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <ColorWheel value={color} onChange={(next) => setColor(next)} />

        <div className="bookmark-popup__actions">
          <button type="button" className="bookmark-popup__cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bookmark-popup__save" onClick={handleSave} disabled={!canSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
