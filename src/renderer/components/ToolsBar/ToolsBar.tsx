// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-29

import { Fragment, useRef, type ReactNode } from 'react';
import type { PointerMode } from '@shared/tab-state';
import { useClickRipples } from '../../hooks/useClickRipples';
import { usePointerGlow } from '../../hooks/usePointerGlow';
import { formatAltShortcut, formatShortcut } from '../../lib/shortcuts';
import {
  CommentIcon,
  CropIcon,
  ExportIcon,
  HandIcon,
  HighlighterIcon,
  KeyboardIcon,
  LaserPointerIcon,
  PenIcon,
  RevertIcon,
  SidebarIcon,
  TextBoxIcon,
  TextSelectIcon,
} from '../icons';
import { Mist } from '../Mist';
import { useExportMenu } from '../ExportMenu';

interface ToolsBarProps {
  /** Whether it's shown in full, rather than as a rail of its tools' icons. */
  readonly visible: boolean;
  /** Focus Mode: the sidebar slides away entirely, and its toggle goes with it. */
  readonly focusMode: boolean;
  readonly onToggleVisible: () => void;

  /** True on the blank home page, or a PDF or note with no file open: the marking tools — and Revert — have nothing to act on. */
  readonly annotationToolsLocked: boolean;
  /** Whether the pen, comment and text box tools are usable: web pages, PDFs and notes. */
  readonly canAnnotate: boolean;
  /** Whether there's an active tab for the laser pointer and highlighter to work over. */
  readonly canPoint: boolean;
  /** Whether the active tab is a PDF, a note or a web page, whose pointer modes (Pan, Select) lead the list. */
  readonly showPointerModes: boolean;
  /** The tab's pointer mode — shown on only while no tool is, since a tool takes the pointer over. */
  readonly pointerMode: PointerMode;
  /** The tab has nothing to pan or select: a PDF or note with no file open, or the home page. */
  readonly pointerModesLocked: boolean;
  readonly onSetPointerMode: (mode: PointerMode) => void;
  /** Web pages only, whose pages may bind the tools' keys. */
  readonly showEditMode: boolean;
  readonly editMode: boolean;
  readonly onToggleEditMode: () => void;
  readonly showLaserPointer: boolean;
  readonly laserPointerActive: boolean;
  readonly onToggleLaserPointer: () => void;
  readonly showPen: boolean;
  readonly penActive: boolean;
  readonly onTogglePen: () => void;
  readonly showHighlighter: boolean;
  readonly highlighterActive: boolean;
  readonly onToggleHighlighter: () => void;
  readonly showCommentTool: boolean;
  readonly commentToolActive: boolean;
  readonly onToggleCommentTool: () => void;
  readonly showTextTool: boolean;
  readonly textToolActive: boolean;
  readonly onToggleTextTool: () => void;
  /** PDF tabs only, the one document type it applies to. */
  readonly showCrop: boolean;
  readonly cropActive: boolean;
  readonly onToggleCrop: () => void;
  readonly showRevert: boolean;
  /** Whether the tab has any marks to revert; with none, Revert is disabled. */
  readonly canRevert: boolean;
  /** Takes every mark off the page — a one-off action, not a tool that stays on. */
  readonly onRevertPage: () => void;
  /** Whether Export is shown at all — not on a PDF or a table page, which have nothing to export. */
  readonly showExport: boolean;
  /** Whether there's something to export: an active tab other than the home page or an empty note. */
  readonly canExport: boolean;
  /** Whether the active tab has HTML/CSS/JS to save — web pages only. */
  readonly canExportDocuments: boolean;
  /** Whether the active tab is a note, whose export menu lists PDF, `.md` and `.txt`. */
  readonly exportMarkdown: boolean;
  /**
   * A PDF's or note's own file actions (New, Open, Close, Delete; a PDF's Export too), in a section of their own after
   * the tools — Export's menu, where shown, right after them. Empty for any other tab.
   */
  readonly fileActions: readonly ToolsBarAction[];
  /**
   * Sections of their own between the tools and the file's actions, each set off by a rule: a note's View/Edit and
   * Formatted/Raw buttons, then its formatting buttons. Empty sections are skipped.
   */
  readonly actionSections: readonly (readonly ToolsBarAction[])[];
}

/** One of a file's actions in the Tools sidebar: a row like a tool's, never "on". */
export interface ToolsBarAction {
  readonly id: string;
  readonly name: string;
  /** What a click does, for assistive technology, where the row's name says what it is now; defaults to `name`. */
  readonly label?: string;
  readonly icon: ReactNode;
  readonly disabled: boolean;
  /** Its tooltip: what a click does, with its shortcut. */
  readonly tooltip: string;
  readonly onClick: () => void;
}

/** One row of the list: what it's called, its icon, and what it does. */
interface Tool {
  readonly id: string;
  readonly name: string;
  /** What a click does, for assistive technology: "Turn on pen", where the row itself just says "Pen". */
  readonly label: string;
  readonly icon: ReactNode;
  /** `null` for an action (Revert), which is never "on". */
  readonly pressed: boolean | null;
  readonly disabled: boolean;
  /** Its tooltip: what a click does, with its shortcut. */
  readonly tooltip: string;
  readonly onClick: () => void;
}

/**
 * The Tools sidebar on the window's right edge: the page tools, in the order
 * the toolbar used to show them — Pan and Select, Edit mode, the laser
 * pointer, Pen, Highlighter, Comment, Text box, Crop and Revert — each only
 * where the active tab can use it. Each row is the tool's name, then its icon
 * at the right; a tool that's on is filled in, as the selected workspace is.
 *
 * The workspace sidebar mirrored: its heading (its show/hide button on the
 * outer side, toward the page, then "Tools"), its glow on hover and ripple on
 * click, the drifting mist and the
 * pointer's glow behind. Hidden, it keeps a rail of just the icons, the names
 * squeezed away as it narrows; main moves the page's right edge in step with
 * it (`TabManager.targetRightInset`).
 */
export function ToolsBar(props: ToolsBarProps) {
  const { visible, focusMode, onToggleVisible } = props;
  const sidebarRef = useRef<HTMLElement>(null);
  usePointerGlow(sidebarRef);
  const ripples = useClickRipples();
  const tools = toolsFor(props);
  const { fileActions } = props;
  // Every section after the tools, in order, each set off from what's above it by a rule: the note's own sections,
  // then the file's actions (Export's menu follows those, in the same section).
  const sections = [...props.actionSections, fileActions].filter((section) => section.length > 0);
  const hasExportSection = fileActions.length === 0 && props.showExport;
  // Export opens its menu (its own overlay, beside the sidebar) rather than turning on.
  const exportMenu = useExportMenu({
    canExport: props.canExport,
    canExportDocuments: props.canExportDocuments,
    markdown: props.exportMarkdown,
  });

  /** The ripples drawn under one row, its own id's. */
  const rippleLayer = (ownerId: string): ReactNode => (
    <span className="tools-sidebar__effects" aria-hidden="true">
      <span className="tools-sidebar__on-fill" />
      {ripples.ripples
        .filter((ripple) => ripple.ownerId === ownerId)
        .map((ripple) => (
          <span
            key={ripple.id}
            className="click-ripple"
            style={{
              left: ripple.x - ripple.size / 2,
              top: ripple.y - ripple.size / 2,
              width: ripple.size,
              height: ripple.size,
            }}
            onAnimationEnd={() => ripples.remove(ripple.id)}
          />
        ))}
    </span>
  );

  return (
    <aside
      ref={sidebarRef}
      className={`tools-sidebar pointer-glow-host${visible ? '' : ' tools-sidebar--hidden'}${focusMode ? ' tools-sidebar--focus-mode' : ''}`}
      aria-label="Tools"
    >
      {/* Mist drifting up and down the sidebar, then the accent glowing around the pointer, under everything in it. */}
      <Mist variant="tools" />
      <div className="pointer-glow" aria-hidden="true" />
      <div className="tools-sidebar__inner">
        {/* Mirrored from the workspace sidebar's: the show/hide button on the outer side, toward the page, then the title. */}
        <div className="sidebar__header tools-sidebar__header">
          {/* Omitted in Focus Mode, like the workspace sidebar's: nothing there should be reachable then. */}
          {!focusMode && (
            <button
              type="button"
              className="sidebar__toggle hover-glow chrome-tooltip"
              onClick={(event) => {
                onToggleVisible();
                event.currentTarget.blur();
              }}
              aria-label={visible ? 'Hide tools' : 'Show tools'}
              aria-expanded={visible}
              data-tooltip={visible ? 'Hide tools' : 'Show tools'}
            >
              <SidebarIcon open={visible} side="right" />
            </button>
          )}
          <span className="sidebar__title">Tools</span>
        </div>
        <div className="tools-sidebar__list">
          {tools.map((tool, index) => (
            <Fragment key={tool.id}>
              <button
                type="button"
                className={`tools-sidebar__tool hover-glow chrome-tooltip${tool.pressed ? ' tools-sidebar__tool--on' : ''}`}
                onClick={(event) => {
                  ripples.add(tool.id, event);
                  tool.onClick();
                }}
                disabled={tool.disabled}
                aria-pressed={tool.pressed ?? undefined}
                aria-label={tool.label}
                data-tooltip={tool.tooltip}
              >
                {/* Under the row's content: the "on" colour, grown in like the selected workspace's, and the ripples. */}
                {rippleLayer(tool.id)}
                <span className="tools-sidebar__name">{tool.name}</span>
                <span className="tools-sidebar__icon" aria-hidden="true">
                  {tool.icon}
                </span>
              </button>
              {/* Pan and Select only move the pointer; the tools after them mark the page. A rule keeps the two apart. */}
              {tool.id === 'select' && index < tools.length - 1 && (
                <span className="tools-sidebar__divider" role="separator" aria-hidden="true" />
              )}
            </Fragment>
          ))}
          {/* A note's modes and formatting, then the file's own actions and Export: sections of their own, as they act on
              the note or the file rather than mark it. */}
          {sections.map((section, sectionIndex) => (
            <Fragment key={section[0]!.id}>
              {(tools.length > 0 || sectionIndex > 0) && <span className="tools-sidebar__divider" role="separator" aria-hidden="true" />}
              {section.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="tools-sidebar__tool hover-glow chrome-tooltip"
                  onClick={(event) => {
                    ripples.add(action.id, event);
                    action.onClick();
                  }}
                  disabled={action.disabled}
                  aria-label={action.label ?? action.name}
                  data-tooltip={action.tooltip}
                >
                  {rippleLayer(action.id)}
                  <span className="tools-sidebar__name">{action.name}</span>
                  <span className="tools-sidebar__icon" aria-hidden="true">
                    {action.icon}
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
          {/* Export with no file actions above it (a web page's): a section of its own. */}
          {hasExportSection && (tools.length > 0 || sections.length > 0) && (
            <span className="tools-sidebar__divider" role="separator" aria-hidden="true" />
          )}
          {props.showExport && (
            <>
              <button
                ref={exportMenu.anchorRef}
                type="button"
                className={`tools-sidebar__tool hover-glow chrome-tooltip${exportMenu.isOpen ? ' tools-sidebar__tool--on' : ''}`}
                onClick={(event) => {
                  ripples.add('export', event);
                  exportMenu.toggle();
                }}
                disabled={!props.canExport}
                aria-haspopup="menu"
                aria-expanded={exportMenu.isOpen}
                aria-label="Export"
                data-tooltip="Export"
              >
                {rippleLayer('export')}
                <span className="tools-sidebar__name">Export</span>
                <span className="tools-sidebar__icon" aria-hidden="true">
                  <ExportIcon />
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * The tools the active tab can use, in the toolbar's old order.
 * @param props The sidebar's props.
 * @returns Its rows.
 */
function toolsFor(props: ToolsBarProps): readonly Tool[] {
  const {
    annotationToolsLocked,
    canAnnotate,
    canPoint,
    pointerMode,
    pointerModesLocked,
    laserPointerActive,
    penActive,
    highlighterActive,
    commentToolActive,
    textToolActive,
    cropActive,
  } = props;
  // The pointer modes are the tools' resting state: one of them is on exactly when no tool is.
  const anyToolActive = laserPointerActive || penActive || highlighterActive || commentToolActive || textToolActive || cropActive;
  const marking = !canAnnotate || annotationToolsLocked;
  const toggle = (on: boolean, name: string): string => `Turn ${on ? 'off' : 'on'} ${name}`;
  const tools: Tool[] = [];

  if (props.showPointerModes) {
    // Alt+1 / Alt+2: Ctrl+1–8 jump to tabs.
    tools.push(
      {
        id: 'pan',
        name: 'Pan',
        label: 'Pan: drag to move the document',
        icon: <HandIcon />,
        pressed: !anyToolActive && pointerMode === 'pan',
        disabled: pointerModesLocked,
        tooltip: `Pan: drag to move the document (${formatAltShortcut('1')})`,
        onClick: () => props.onSetPointerMode('pan'),
      },
      {
        id: 'select',
        name: 'Select',
        label: 'Select: drag to select text; links can be clicked',
        icon: <TextSelectIcon />,
        pressed: !anyToolActive && pointerMode === 'select',
        disabled: pointerModesLocked,
        tooltip: `Select: drag to select text; links can be clicked (${formatAltShortcut('2')})`,
        onClick: () => props.onSetPointerMode('select'),
      },
    );
  }
  if (props.showEditMode) {
    tools.push({
      id: 'edit-mode',
      name: 'Edit mode',
      label: props.editMode ? 'Turn off edit mode' : 'Turn on edit mode',
      icon: <KeyboardIcon />,
      pressed: props.editMode,
      disabled: false,
      tooltip: `${
        props.editMode ? "Turn off edit mode: the tools' shortcuts work again" : "Turn on edit mode: the page gets the tools' shortcut keys"
      } (${formatShortcut('Alt+Shift+E')})`,
      onClick: props.onToggleEditMode,
    });
  }
  if (props.showLaserPointer) {
    tools.push({
      id: 'laser-pointer',
      name: 'Laser pointer',
      label: toggle(laserPointerActive, 'laser pointer'),
      icon: <LaserPointerIcon />,
      pressed: laserPointerActive,
      disabled: !canPoint,
      tooltip: `${toggle(laserPointerActive, 'laser pointer')} (${formatShortcut('I')})`,
      onClick: props.onToggleLaserPointer,
    });
  }
  if (props.showPen) {
    tools.push({
      id: 'pen',
      name: 'Pen',
      label: toggle(penActive, 'pen'),
      icon: <PenIcon />,
      pressed: penActive,
      disabled: marking,
      tooltip: `${toggle(penActive, 'pen')} (${formatShortcut('P')})`,
      onClick: props.onTogglePen,
    });
  }
  if (props.showHighlighter) {
    tools.push({
      id: 'highlighter',
      name: 'Highlighter',
      label: toggle(highlighterActive, 'highlighter'),
      icon: <HighlighterIcon />,
      pressed: highlighterActive,
      disabled: !canPoint || annotationToolsLocked,
      tooltip: `${toggle(highlighterActive, 'highlighter')} (${formatShortcut('J')})`,
      onClick: props.onToggleHighlighter,
    });
  }
  if (props.showCommentTool) {
    tools.push({
      id: 'comment',
      name: 'Comment',
      label: toggle(commentToolActive, 'comments'),
      icon: <CommentIcon />,
      pressed: commentToolActive,
      disabled: marking,
      tooltip: `${toggle(commentToolActive, 'comments')} (${formatShortcut('M')})`,
      onClick: props.onToggleCommentTool,
    });
  }
  if (props.showTextTool) {
    tools.push({
      id: 'text-box',
      name: 'Text box',
      label: toggle(textToolActive, 'text box'),
      icon: <TextBoxIcon />,
      pressed: textToolActive,
      disabled: marking,
      tooltip: `${toggle(textToolActive, 'text box')} (${formatShortcut('E')})`,
      onClick: props.onToggleTextTool,
    });
  }
  if (props.showCrop) {
    tools.push({
      id: 'crop',
      name: 'Crop',
      label: toggle(cropActive, 'crop'),
      icon: <CropIcon />,
      pressed: cropActive,
      disabled: annotationToolsLocked,
      tooltip: `${toggle(cropActive, 'crop')} (${formatShortcut('Shift+X')})`,
      onClick: props.onToggleCrop,
    });
  }
  if (props.showRevert) {
    tools.push({
      id: 'revert',
      name: 'Revert',
      label: 'Revert annotations',
      icon: <RevertIcon />,
      pressed: null,
      // Only with something to take off the page.
      disabled: marking || !props.canRevert,
      tooltip: `Revert annotations (${formatShortcut('Shift+R')})`,
      onClick: props.onRevertPage,
    });
  }
  return tools;
}
