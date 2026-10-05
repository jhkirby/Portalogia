// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';
import { ColorPicker } from '../ColorPicker';
import { ExportMenu } from '../ExportMenu';
import {
  CommentIcon,
  CropIcon,
  HighlighterIcon,
  HistoryIcon,
  LaserPointerIcon,
  OpenInNewWindowIcon,
  PenIcon,
  RevertIcon,
  TextBoxIcon,
} from '../icons';
import { ZoomControl } from '../ZoomControl';

interface PageActionsProps {
  /** Whether there's an active tab to bookmark — browser-only, unlike `canExportPdf`, since a terminal tab has no URL to bookmark. */
  readonly canActOnPage: boolean;
  /** True on a PDF tab with no file open: the pen, highlighter, comment, text box and crop tools have nothing to mark, so they're disabled. */
  readonly annotationToolsLocked: boolean;
  /** Whether the pen and comment tools are usable — browser tabs and PDF tabs, unlike `canActOnPage` (a PDF has no URL to bookmark or revert). */
  readonly canAnnotate: boolean;
  /** Whether there's an active tab to export to PDF — unlike `canActOnPage`, true for a terminal tab too (its `WebContentsView` prints its on-screen output same as a browser tab prints its page). */
  readonly canExportPdf: boolean;
  /** Whether there's an active tab to zoom — unlike `canActOnPage`, true for a terminal tab too (zoom isn't browser-only). */
  /** Whether the export dropdown is usable — unlike `canExportPdf`, false on the built-in home page, which has no real content to export. */
  readonly canExportMenu: boolean;
  /** Whether the active tab has HTML/CSS/JS to save — browser tabs only, unlike `canExportPdf`. */
  readonly canExportDocuments: boolean;
  /** Whether the export dropdown is shown at all — hidden on a PDF tab, which has nothing to export. */
  readonly showExportMenu: boolean;
  /** Whether the comment tool is shown — hidden on a terminal tab, which has no document to anchor a comment to. */
  readonly showCommentTool: boolean;
  /** Whether the text box tool is shown — hidden on a terminal tab, like the comment tool. */
  readonly showTextTool: boolean;
  /** Whether the laser pointer is shown — hidden on a History tab. */
  readonly showLaserPointer: boolean;
  /** Whether the zoom control is shown — hidden on a History tab, which doesn't zoom. */
  readonly showZoom: boolean;
  /** Whether the pen is shown — hidden on a terminal tab, which has no document to draw on. */
  readonly showPen: boolean;
  /** Whether the highlighter is shown — hidden on a terminal tab. */
  readonly showHighlighter: boolean;
  /** Whether Revert Annotations is shown — hidden on a terminal tab, which can't be annotated. */
  readonly showRevert: boolean;
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
  /** Whether the text box tool is currently on. */
  readonly textToolActive: boolean;
  /** Whether the pen tool is currently on. */
  readonly penActive: boolean;
  /** Whether the PDF crop tool is currently on. */
  readonly cropActive: boolean;
  /** Whether the crop tool is shown — PDF tabs only, the one document type it applies to. */
  readonly showCrop: boolean;
  readonly theme: Theme;
  /** Opens a new PDF viewer tab. */
  readonly onOpenPdfViewer: () => void;
  readonly onNewTerminal: () => void;
  /** Opens a new History tab. */
  readonly onOpenHistory: () => void;
  readonly onOpenTabSearch: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly onSetZoom: (percent: number) => void;
  readonly onOpenWorkspaceInNewWindow: () => void;
  readonly onToggleFocusMode: () => void;
  readonly onToggleLaserPointer: () => void;
  readonly onToggleHighlighter: () => void;
  readonly onToggleCommentTool: () => void;
  readonly onToggleTextTool: () => void;
  readonly onTogglePen: () => void;
  readonly onToggleCrop: () => void;
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
  canAnnotate,
  annotationToolsLocked,
  canExportPdf,
  canZoom,
  zoomPercent,
  focusMode,
  laserPointerActive,
  highlighterActive,
  commentToolActive,
  textToolActive,
  penActive,
  cropActive,
  showCrop,
  theme,
  onOpenPdfViewer,
  canExportMenu,
  canExportDocuments,
  showExportMenu,
  showCommentTool,
  showTextTool,
  showLaserPointer,
  showZoom,
  showPen,
  showHighlighter,
  showRevert,
  onNewTerminal,
  onOpenHistory,
  onOpenTabSearch,
  onZoomOut,
  onZoomIn,
  onSetZoom,
  onOpenWorkspaceInNewWindow,
  onToggleFocusMode,
  onToggleLaserPointer,
  onToggleHighlighter,
  onToggleCommentTool,
  onToggleTextTool,
  onTogglePen,
  onToggleCrop,
  onRevertPage,
  onToggleTheme,
}: PageActionsProps) {
  // With none of the tool buttons showing (a History tab), the divider that closes their group would sit alone at the left edge.
  const showAnyTool =
    showLaserPointer || showPen || showHighlighter || showCommentTool || showTextTool || showCrop || showRevert;

  return (
    <div className="page-actions">
      {showLaserPointer && (
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
      )}
      {showPen && (
        <button
          type="button"
          className="page-actions__button chrome-tooltip"
          onClick={onTogglePen}
          disabled={!canAnnotate || annotationToolsLocked}
          aria-pressed={penActive}
          aria-label={penActive ? 'Turn off pen' : 'Turn on pen'}
          data-tooltip={`${penActive ? 'Turn off pen' : 'Turn on pen'} (${formatShortcut('P')})`}
        >
          <PenIcon />
        </button>
      )}
      {showHighlighter && (
        <button
          type="button"
          className="page-actions__button chrome-tooltip"
          onClick={onToggleHighlighter}
          disabled={!canExportPdf || annotationToolsLocked}
          aria-pressed={highlighterActive}
          aria-label={highlighterActive ? 'Turn off highlighter' : 'Turn on highlighter'}
          data-tooltip={`${highlighterActive ? 'Turn off highlighter' : 'Turn on highlighter'} (${formatShortcut('J')})`}
        >
          <HighlighterIcon />
        </button>
      )}
      {showCommentTool && (
        <button
          type="button"
          className="page-actions__button chrome-tooltip"
          onClick={onToggleCommentTool}
          disabled={!canAnnotate || annotationToolsLocked}
          aria-pressed={commentToolActive}
          aria-label={commentToolActive ? 'Turn off comments' : 'Turn on comments'}
          data-tooltip={`${commentToolActive ? 'Turn off comments' : 'Turn on comments'} (${formatShortcut('M')})`}
        >
          <CommentIcon />
        </button>
      )}
      {showTextTool && (
        <button
          type="button"
          className="page-actions__button chrome-tooltip"
          onClick={onToggleTextTool}
          disabled={!canAnnotate || annotationToolsLocked}
          aria-pressed={textToolActive}
          aria-label={textToolActive ? 'Turn off text box' : 'Turn on text box'}
          data-tooltip={`${textToolActive ? 'Turn off text box' : 'Turn on text box'} (${formatShortcut('E')})`}
        >
          <TextBoxIcon />
        </button>
      )}
      {showCrop && (
        <button
          type="button"
          className="page-actions__button chrome-tooltip"
          onClick={onToggleCrop}
          disabled={annotationToolsLocked}
          aria-pressed={cropActive}
          aria-label={cropActive ? 'Turn off crop' : 'Turn on crop'}
          data-tooltip={`${cropActive ? 'Turn off crop' : 'Turn on crop'} (${formatShortcut('Shift+X')})`}
        >
          <CropIcon />
        </button>
      )}
      {showRevert && (
        <button
          type="button"
          className="page-actions__button chrome-tooltip"
          onClick={onRevertPage}
          disabled={!canAnnotate}
          aria-label="Revert annotations"
          data-tooltip={`Revert annotations (${formatShortcut('Shift+R')})`}
        >
          <RevertIcon />
        </button>
      )}
      {showAnyTool && <span className="page-actions__divider" role="separator" aria-hidden="true" />}
      <button
        type="button"
        className="page-actions__button page-actions__button--pdf chrome-tooltip"
        onClick={onOpenPdfViewer}
        aria-label="Open PDF viewer"
        data-tooltip={`Open PDF viewer (${formatShortcut('Shift+P')})`}
      >
        PDF
      </button>
      {showExportMenu && <ExportMenu canExport={canExportMenu} canExportDocuments={canExportDocuments} />}
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
        onClick={onOpenHistory}
        aria-label="Open history"
        data-tooltip={`Open history (${formatShortcut('Shift+H')})`}
      >
        <HistoryIcon />
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
      {showZoom && (
        <>
          <ZoomControl
            percent={zoomPercent}
            canZoom={canZoom}
            onZoomOut={onZoomOut}
            onZoomIn={onZoomIn}
            onSetZoom={onSetZoom}
          />
          <span className="page-actions__divider" role="separator" aria-hidden="true" />
        </>
      )}
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
