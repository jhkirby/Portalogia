// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-09-18

import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';
import { ColorPicker } from '../ColorPicker';
import { ExportMenu } from '../ExportMenu';
import {
  CommentIcon,
  HighlighterIcon,
  LaserPointerIcon,
  OpenInNewWindowIcon,
  PenIcon,
  RevertIcon,
} from '../icons';
import { ZoomControl } from '../ZoomControl';

interface PageActionsProps {
  /** Whether there's an active tab to bookmark — browser-only, unlike `canExportPdf`, since a terminal tab has no URL to bookmark. */
  readonly canActOnPage: boolean;
  /** Whether there's an active tab to export to PDF — unlike `canActOnPage`, true for a terminal tab too (its `WebContentsView` prints its on-screen output same as a browser tab prints its page). */
  readonly canExportPdf: boolean;
  /** Whether there's an active tab to zoom — unlike `canActOnPage`, true for a terminal tab too (zoom isn't browser-only). */
  /** Whether the export dropdown is usable — unlike `canExportPdf`, false on the built-in home page, which has no real content to export. */
  readonly canExportMenu: boolean;
  /** Whether the active tab has HTML/CSS/JS to save — browser tabs only, unlike `canExportPdf`. */
  readonly canExportDocuments: boolean;
  readonly canZoom: boolean;
  /** The active tab's current zoom, 25–200. */
  readonly zoomPercent: number;
  readonly focusMode: boolean;
  /** Whether the laser pointer overlay is currently on. */
  readonly laserPointerActive: boolean;
  /** Whether the highlighter tool is currently on. */
  readonly highlighterActive: boolean;
  /** Whether the comment tool is currently on. */
  readonly commentToolActive: boolean;
  /** Whether the pen tool is currently on. */
  readonly penActive: boolean;
  readonly theme: Theme;
  readonly onExportPdf: () => void;
  readonly onNewTerminal: () => void;
  readonly onOpenTabSearch: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly onSetZoom: (percent: number) => void;
  readonly onOpenWorkspaceInNewWindow: () => void;
  readonly onToggleFocusMode: () => void;
  readonly onToggleLaserPointer: () => void;
  readonly onToggleHighlighter: () => void;
  readonly onToggleCommentTool: () => void;
  readonly onTogglePen: () => void;
  /** Reverts the active page back to no highlights/comments — a one-shot action, not a toggle. */
  readonly onRevertPage: () => void;
  readonly onToggleTheme: () => void;
}

/**
 * The toolbar's right-hand button strip, in five groups split by dividers —
 * nearest the address bar first: page-editing tools (laser pointer, pen,
 * highlighter, comments, revert); page/app tools (PDF, terminal, tab search);
 * zoom; window actions (new window, Focus Mode); appearance (accent color, theme).
 */
export function PageActions({
  canActOnPage,
  canExportPdf,
  canZoom,
  zoomPercent,
  focusMode,
  laserPointerActive,
  highlighterActive,
  commentToolActive,
  penActive,
  theme,
  onExportPdf,
  canExportMenu,
  canExportDocuments,
  onNewTerminal,
  onOpenTabSearch,
  onZoomOut,
  onZoomIn,
  onSetZoom,
  onOpenWorkspaceInNewWindow,
  onToggleFocusMode,
  onToggleLaserPointer,
  onToggleHighlighter,
  onToggleCommentTool,
  onTogglePen,
  onRevertPage,
  onToggleTheme,
}: PageActionsProps) {
  return (
    <div className="page-actions">
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleLaserPointer}
        disabled={!canExportPdf}
        aria-pressed={laserPointerActive}
        aria-label={laserPointerActive ? 'Turn off laser pointer' : 'Turn on laser pointer'}
        data-tooltip={`${laserPointerActive ? 'Turn off laser pointer' : 'Turn on laser pointer'} (${formatShortcut('I')})`}
      >
        <LaserPointerIcon />
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onTogglePen}
        disabled={!canActOnPage}
        aria-pressed={penActive}
        aria-label={penActive ? 'Turn off pen' : 'Turn on pen'}
        data-tooltip={`${penActive ? 'Turn off pen' : 'Turn on pen'} (${formatShortcut('P')})`}
      >
        <PenIcon />
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleHighlighter}
        disabled={!canExportPdf}
        aria-pressed={highlighterActive}
        aria-label={highlighterActive ? 'Turn off highlighter' : 'Turn on highlighter'}
        data-tooltip={`${highlighterActive ? 'Turn off highlighter' : 'Turn on highlighter'} (${formatShortcut('J')})`}
      >
        <HighlighterIcon />
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleCommentTool}
        disabled={!canActOnPage}
        aria-pressed={commentToolActive}
        aria-label={commentToolActive ? 'Turn off comments' : 'Turn on comments'}
        data-tooltip={`${commentToolActive ? 'Turn off comments' : 'Turn on comments'} (${formatShortcut('M')})`}
      >
        <CommentIcon />
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onRevertPage}
        disabled={!canActOnPage}
        aria-label="Revert page (remove all highlights and comments)"
        data-tooltip={`Revert page (${formatShortcut('Shift+R')})`}
      >
        <RevertIcon />
      </button>
      <span className="page-actions__divider" role="separator" aria-hidden="true" />
      <button
        type="button"
        className="page-actions__button page-actions__button--pdf chrome-tooltip"
        onClick={onExportPdf}
        disabled={!canExportPdf}
        aria-label="Export page to PDF"
        data-tooltip="Export page to PDF"
      >
        PDF
      </button>
      <ExportMenu canExport={canExportMenu} canExportDocuments={canExportDocuments} />
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onNewTerminal}
        aria-label="New terminal"
        data-tooltip={`New terminal (${formatShortcut('>')})`}
      >
        {'>_'}
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onOpenTabSearch}
        aria-label="Search tabs"
        data-tooltip={`Search tabs (${formatShortcut('K')})`}
      >
        ⌕
      </button>
      <span className="page-actions__divider" role="separator" aria-hidden="true" />
      <ZoomControl percent={zoomPercent} canZoom={canZoom} onZoomOut={onZoomOut} onZoomIn={onZoomIn} onSetZoom={onSetZoom} />
      <span className="page-actions__divider" role="separator" aria-hidden="true" />
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onOpenWorkspaceInNewWindow}
        aria-label="Open tab in new window"
        data-tooltip={`Open tab in new window (${formatShortcut('Shift+O')})`}
      >
        <OpenInNewWindowIcon />
      </button>
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleFocusMode}
        aria-pressed={focusMode}
        aria-label={focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
        data-tooltip={`${focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'} (${formatShortcut('Shift+F')})`}
      >
        ⛶
      </button>
      <span className="page-actions__divider" role="separator" aria-hidden="true" />
      <ColorPicker />
      <button
        type="button"
        className="page-actions__button chrome-tooltip"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        data-tooltip={`${theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} (${formatShortcut('D')})`}
      >
        {theme === 'dark' ? '☾︎' : '☀︎'}
      </button>
    </div>
  );
}
