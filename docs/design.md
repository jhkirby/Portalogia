# Design

This document describes what Portalogia is for, how it is meant to feel, and
the design decisions behind its interface. For how the code is built, see
[architecture.md](architecture.md). For how to use the app, see
[user_guide.md](user_guide.md).

## Purpose

Portalogia is a browser for people who research, study and build. It puts
four things in one window:

- the web,
- the documents you read (PDFs),
- the notes you write (Markdown), and
- the terminal you work in.

You can mark up all of them with the same set of tools. Workspaces keep each
project's tabs apart, and you can save and restore a project's tabs whenever
you want.

## Design principles

1. **One window, every kind of material.** A web page, a PDF, a note, a
   terminal and the history list are all tabs. They open, close, move between
   workspaces and tear off into new windows in the same way.
2. **The same tool works everywhere.** The highlighter, pen, comments and
   text boxes behave the same on a web page, a PDF and a note. There is one
   find bar for every kind of tab. Learn a tool once and it works on
   everything.
3. **Keyboard first, mouse friendly.** Almost every action has a shortcut,
   and every toolbar button's tooltip shows it. Shortcuts that would clash
   with typing step aside while you are typing in a text field.
4. **The content gets the space.** The chrome is compact (92 px tall, with a
   180 px sidebar). The sidebar folds down to a 40 px rail, and Focus Mode
   hides everything but the page.
5. **Private by default.** No accounts, no telemetry, and no cloud. Ads and
   trackers are blocked unless you turn blocking off. Your annotations stay on
   your computer and are hidden from the sites you annotate. See
   [privacy.md](privacy.md).
6. **Limits that keep things tidy.** A workspace holds at most 8 tabs, and
   there can be at most 20 workspaces. Instead of an endless strip of tiny
   tabs, Portalogia nudges you to split work into workspaces or save it as a
   workspace image.

## Window layout

```
┌────────────────────────────────────────────────────────────────────┐
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ drag strip (12 px) ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  – □ ×      │
│ [tab] [tab] [tab] [+]                                  tab strip   │
├──────────┬─────────────────────────────────────────────────────────┤
│          │ ◀ ▶ ⟳  [ address bar ................ ☆ ]  tools  zoom  │
│ Work-    ├─────────────────────────────────────────────────────────┤
│ spaces   │                                                         │
│          │                                                         │
│ ● Home   │                 page content                            │
│ ● Thesis │        (a native view, drawn by the main process)       │
│ ● Lab    │                                                         │
│          │                                                         │
│ + New    │                                                         │
└──────────┴─────────────────────────────────────────────────────────┘
```

- **Drag strip.** The window has no OS title bar. A thin strip above the tabs
  moves the window. It darkens on hover and darkens further while you drag.
  Dragging the window to a screen edge snaps it to a half, a quarter, or full
  screen.
- **Tab strip.** Each tab shows a favicon and its label: the bookmark name if
  the page is bookmarked, otherwise the site's domain. Neighboring tabs share
  a single border.
- **Toolbar.** On the left are back, forward and reload/stop, then the
  address bar. Then come the page tools (laser pointer, pen, highlighter,
  comments, text box, crop, revert), the tab-kind launchers (PDF, notes,
  terminal, history), tab search, find, the ad-block shield, open in a new
  window, Focus Mode, theme, and zoom. PDF and note tabs swap the address bar
  for a toolbar of their own.
- **Sidebar.** Lists workspaces as colored pills with icons. Collapsing it
  leaves a narrow rail of colored dots that you can still click.

## Core concepts

### Tabs

A tab is anything you can look at. Its kind (web, PDF, note, terminal,
history) decides what its page shows and which toolbar appears. All kinds
share the same behavior for opening, closing, reordering, multi-selection
(Ctrl+click, Shift+click) and tear-off.

### Workspaces

A workspace is a named, colored group of tabs, such as one per project or
per class. Switching workspaces swaps the whole tab strip. Workspaces are
shared across windows, so two windows can show the same project.

### Workspace images

A workspace image is a saved snapshot of a workspace's tabs: their
addresses, file paths and order. Reopening it rebuilds the workspace. Saving
never overwrites an existing image, so each save is a separate restore
point.

### Annotation tools

The tools are modes: turning one on changes what a click does on the current
tab. Turning a tool on turns off any other. Each tool's toolbar button shows
whether it is on. Escape leaves the current tool. Marks use the accent
color, belong to that page or file, and are stored by the app rather than
written into the original.

## Visual design

### Themes and color

- **Light and dark themes.** The first launch follows the OS setting. After
  that, Ctrl+D switches theme and the choice is remembered.
- **One accent color.** `--color-accent-rgb` is the single source for the
  app's highlight color: focus rings, the dragging tab, text selection
  (including selection inside web pages) and annotation marks. Changing it
  in the color picker recolors all of these at once.
- **Workspace colors.** A palette of six (blue, red, green, yellow, purple,
  teal) to tell workspaces apart at a glance.

### Styling system

Styles live in `src/renderer/styles/` and are split by role:

| Folder | Holds |
| --- | --- |
| `tokens/colors.css` | Every color, defined once per theme under `[data-theme]` |
| `tokens/sizes.css` | Layout sizes. Some of these must equal constants in `src/shared/constants.ts`, because main positions native views with the same numbers. |
| `components/` | One file per component (`tab-bar.css`, `address-bar.css`, ...) |
| `pages/` | Page-level layout (`app.css`) |

Components use BEM-style class names (`tab-bar__spinner`,
`address-bar__bubble--domain`). Colors and sizes always come from tokens and
are never hard-coded.

### Motion

The sidebar collapse and Focus Mode both slide over 220 ms. The main process
animates the native page view's bounds over the same duration, so the page
moves in step with the chrome. Buttons grow slightly on hover
(`hover-grow`). The find bar slides in over 160 ms.

## Interaction details

- **The address bar shows names when idle.** When it isn't focused, it shows
  a bubble with the bookmark name or domain. Clicking it shows the full URL
  for editing.
- **Typing guesses whether you mean an address or a search.** Text that looks
  like an address opens as one, and anything else is searched on Google.
- **Shortcuts respect text fields.** While you are typing, editing keys
  (arrows with modifiers, Ctrl+A/C/V/X/Z/Y, and so on) go to the text field,
  not to app shortcuts. Escape leaves the text field, and after that the
  shortcuts work again.
- **Closing never surprises you.** Ctrl+W closes the tab and never the
  window. Closing a workspace's last tab leaves a fresh home tab in its
  place. A workspace can't be removed while it is the only one.
- **Dragging gives instant feedback.** While you drag a tab, the strip
  previews the new order. A tab dragged out of the window appears in a new
  window right away, under the cursor.
- **Consent before risk.** Running a code block in a note asks first and
  shows the code. Changing the code asks again.

## Accessibility

- Every icon button has an `aria-label`, and its tooltip includes the
  shortcut.
- The tab strip is a `tablist` of `tab`s, and the workspace list is labeled
  "Workspaces". The end-to-end tests locate elements by these roles and
  labels, which keeps them accurate.
- Everything in the toolbar can be reached with the keyboard.
- Both themes are designed for readable contrast. The accent color can be
  changed, for users who need a stronger one.

## Known gaps

- **Split view** works in the main process and has an exit chip in the
  toolbar, but there is no control to start it yet.
- **Site permissions** are all denied (except full-screen), with no prompt to
  allow one. A per-site prompt is planned.
- There are no download manager and no settings page yet.
- Windows is the only packaged platform. macOS and Linux run from source.
