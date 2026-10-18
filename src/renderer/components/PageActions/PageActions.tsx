// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-18

import { useEffect, useRef } from 'react';
import type { PdfPointerMode } from '@shared/tab-state';
import type { Theme } from '../../hooks/useTheme';
import { formatShortcut } from '../../lib/shortcuts';
import { ColorPicker } from '../ColorPicker';
import { ExportMenu } from '../ExportMenu';
import {
  CommentIcon,
  CropIcon,
  FindIcon,
  HandIcon,
  HighlighterIcon,
  HistoryIcon,
  LaserPointerIcon,
  OpenInNewWindowIcon,
  PenIcon,
  RevertIcon,
  SearchIcon,
  ShieldIcon,
  TextBoxIcon,
  TextSelectIcon,
} from '../icons';

/** The PDF pointer modes' buttons, in toolbar order. */
const POINTER_MODES: readonly { mode: PdfPointerMode; label: string; shortcut: string }[] = [
  { mode: 'pan', label: 'Pan: drag to move the document', shortcut: '1' },
  { mode: 'select', label: 'Select: drag to select text; links can be clicked', shortcut: '2' },
];
import { ZoomControl } from '../ZoomControl';

interface PageActionsProps {
  /** Whether there's an active tab to bookmark — browser-only, unlike `canExportPdf`, since a terminal tab has no URL to bookmark. */
  readonly canActOnPage: boolean;
  /** True on the blank home page, or a PDF tab with no file open: the pen, highlighter, comment, text box and crop tools — and Revert — have nothing to act on, so they're disabled. */
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
  /** Whether the ad blocker button is shown — web pages only (not the home page, a PDF, a terminal or History). */
  readonly showAdBlock: boolean;
  /** Whether the ad blocker is blocking on the active page: on globally, and not turned off for this site. */
  readonly adBlockActive: boolean;
  /** Whether the ad blocker is switched off everywhere — the button then can't turn it on per site. */
  readonly adBlockGloballyOff: boolean;
  /** Requests, popups and elements blocked since the page began loading. */
  readonly adBlockBlockedCount: number;
  /** The active page's hostname, for the button's accessible label. */
  readonly adBlockSite: string;
  /** Turns blocking off or back on for the active page's site. */
  readonly onToggleAdBlock: () => void;
  /** Opens a new PDF viewer tab. */
  readonly onOpenPdfViewer: () => void;
  /** Opens a new Markdown tab. */
  readonly onOpenMarkdown: () => void;
  /** Whether the active tab is a Markdown note, whose export menu lists PDF, `.md` and `.txt`. */
  readonly markdownExport: boolean;
  readonly onNewTerminal: () => void;
  /** Opens a new History tab. */
  readonly onOpenHistory: () => void;
  readonly onOpenTabSearch: () => void;
  /** Whether the find bar is open. */
  readonly findOpen: boolean;
  /** Whether find can search the active tab: a page, a terminal, or a PDF with a file open — not the History tab or an empty PDF. */
  readonly canFind: boolean;
  readonly onToggleFind: () => void;
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
  /** Whether the active tab is a PDF, whose pointer modes (Pan, Select) show beside the tools. */
  readonly showPointerModes: boolean;
  /** The PDF tab's pointer mode — shown pressed only while no tool is on, since a tool takes the pointer over. */
  readonly pointerMode: PdfPointerMode;
  /** The PDF tab has no file open: the modes have nothing to act on. */
  readonly pointerModesLocked: boolean;
  /** Picks a pointer mode, turning off whichever tool is on (as turning one tool on turns off the others). */
  readonly onSetPointerMode: (mode: PdfPointerMode) => void;
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
  showAdBlock,
  adBlockActive,
  adBlockGloballyOff,
  adBlockBlockedCount,
  adBlockSite,
  onToggleAdBlock,
  onOpenPdfViewer,
  onOpenMarkdown,
  markdownExport,
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
  findOpen,
  canFind,
  onToggleFind,
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
  showPointerModes,
  pointerMode,
  pointerModesLocked,
  onSetPointerMode,
  onRevertPage,
  onToggleTheme,
}: PageActionsProps) {
  // With none of the tool buttons showing (a History tab), the divider that closes their group would sit alone at the left edge.
  const showAnyTool =
    showPointerModes ||
    showLaserPointer ||
    showPen ||
    showHighlighter ||
    showCommentTool ||
    showTextTool ||
    showCrop ||
    showRevert;
  // The pointer modes are the tools' resting state: one of them is pressed exactly when no tool is.
  const anyToolActive =
    laserPointerActive || penActive || highlighterActive || commentToolActive || textToolActive || cropActive;

  const stripRef = useRef<HTMLDivElement>(null);

  // In a window too narrow for every tool the strip scrolls sideways, with no scroll bar, so an ordinary (vertical)
  // wheel turn scrolls it; a sideways one (a touchpad, Shift+wheel) already does. Not passive, to keep the turn
  // from going anywhere else.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return undefined;
    }
    const scrollSideways = (event: WheelEvent): void => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      event.preventDefault();
      // A wheel that reports lines rather than pixels.
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      strip.scrollLeft += pixels;
    };
    strip.addEventListener('wheel', scrollSideways, { passive: false });
    return () => strip.removeEventListener('wheel', scrollSideways);
  }, []);

  return (
    <div ref={stripRef} className="page-actions">
      {showPointerModes &&
        POINTER_MODES.map(({ mode, label, shortcut }) => (
          <button
            key={mode}
            type="button"
            className="page-actions__button hover-grow chrome-tooltip"
            onClick={() => onSetPointerMode(mode)}
            disabled={pointerModesLocked}
            aria-pressed={!anyToolActive && pointerMode === mode}
            aria-label={label}
            data-tooltip={`${label} (${formatShortcut(shortcut)})`}
          >
            {mode === 'pan' ? <HandIcon /> : <TextSelectIcon />}
          </button>
        ))}
      {showLaserPointer && (
        <button
          type="button"
          className="page-actions__button hover-grow chrome-tooltip"
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
          className="page-actions__button hover-grow chrome-tooltip"
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
          className="page-actions__button hover-grow chrome-tooltip"
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
          className="page-actions__button hover-grow chrome-tooltip"
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
          className="page-actions__button hover-grow chrome-tooltip"
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
          className="page-actions__button hover-grow chrome-tooltip"
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
          className="page-actions__button hover-grow chrome-tooltip"
          onClick={onRevertPage}
          disabled={!canAnnotate || annotationToolsLocked}
          aria-label="Revert annotations"
          data-tooltip={`Revert annotations (${formatShortcut('Shift+R')})`}
        >
          <RevertIcon />
        </button>
      )}
      {showAnyTool && <span className="page-actions__divider" role="separator" aria-hidden="true" />}
      <button
        type="button"
        className="page-actions__button hover-grow page-actions__button--pdf chrome-tooltip"
        onClick={onOpenPdfViewer}
        aria-label="Open PDF viewer"
        data-tooltip={`Open PDF viewer (${formatShortcut('Shift+P')})`}
      >
        PDF
      </button>
      <button
        type="button"
        className="page-actions__button hover-grow page-actions__button--pdf chrome-tooltip"
        onClick={onOpenMarkdown}
        aria-label="Open Markdown notes"
        data-tooltip={`Open Markdown notes (${formatShortcut('Shift+M')})`}
      >
        MD
      </button>
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onNewTerminal}
        aria-label="New terminal"
        data-tooltip={`New terminal (${formatShortcut('>')})`}
      >
        {'>_'}
      </button>
      {showExportMenu && <ExportMenu canExport={canExportMenu} canExportDocuments={canExportDocuments} markdown={markdownExport} />}
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onOpenHistory}
        aria-label="Open history"
        data-tooltip={`Open history (${formatShortcut('Shift+H')})`}
      >
        <HistoryIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onOpenTabSearch}
        aria-label="Search tabs"
        data-tooltip={`Search tabs (${formatShortcut('K')})`}
      >
        <SearchIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onToggleFind}
        disabled={!canFind}
        aria-pressed={findOpen}
        aria-label={findOpen ? 'Close find' : 'Find'}
        data-tooltip={`${findOpen ? 'Close find' : 'Find'} (${formatShortcut('F')})`}
      >
        <FindIcon />
      </button>
      {showAdBlock && (
        <button
          type="button"
          className="page-actions__button hover-grow page-actions__button--adblock chrome-tooltip"
          onClick={onToggleAdBlock}
          disabled={adBlockGloballyOff}
          // Lit while the blocker is *off* here, so the default (blocking) state stays quiet.
          aria-pressed={!adBlockActive}
          aria-label={adBlockActive ? `Turn off ad blocker for ${adBlockSite}` : `Turn on ad blocker for ${adBlockSite}`}
          data-tooltip={
            adBlockGloballyOff
              ? 'Ad blocker is off (View menu)'
              : adBlockActive
                ? `${adBlockBlockedCount} ${adBlockBlockedCount === 1 ? 'ad' : 'ads'} blocked (${formatShortcut('Shift+B')})`
                : `Ads allowed on this site (${formatShortcut('Shift+B')})`
          }
        >
          <ShieldIcon off={!adBlockActive} />
        </button>
      )}
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
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onOpenWorkspaceInNewWindow}
        aria-label="Open tab in new window"
        data-tooltip={`Open tab in new window (${formatShortcut('Shift+O')})`}
      >
        <OpenInNewWindowIcon />
      </button>
      <button
        type="button"
        className="page-actions__button hover-grow chrome-tooltip"
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
        className="page-actions__button hover-grow chrome-tooltip"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        data-tooltip={`${theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} (${formatShortcut('D')})`}
      >
        {theme === 'dark' ? '☾︎' : '☀︎'}
      </button>
    </div>
  );
}
