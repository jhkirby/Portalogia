# Portalogia User Guide

Welcome to Portalogia. Portalogia is a web browser that also opens PDFs, keeps
notes and runs a terminal, all in one window. You can highlight, draw and
comment on any of them, and organize everything into **workspaces**, one for
each project.

You don't need any technical knowledge to use this guide. Wherever a
keyboard shortcut is shown, such as **Ctrl+T**, hold the first key and press
the second. On a Mac, use **Cmd** instead of **Ctrl**.

**Contents**

1. [Installing Portalogia](#1-installing-portalogia)
2. [A tour of the window](#2-a-tour-of-the-window)
3. [Browsing the web](#3-browsing-the-web)
4. [Working with tabs](#4-working-with-tabs)
5. [Organizing with workspaces](#5-organizing-with-workspaces)
6. [Bookmarks](#6-bookmarks)
7. [History](#7-history)
8. [Finding words on a page](#8-finding-words-on-a-page)
9. [Reading PDFs](#9-reading-pdfs)
10. [Writing notes](#10-writing-notes)
11. [Highlighting, drawing and commenting](#11-highlighting-drawing-and-commenting)
12. [Saving and exporting](#12-saving-and-exporting)
13. [Blocking ads](#13-blocking-ads)
14. [Making Portalogia your own](#14-making-portalogia-your-own)
15. [Using more than one window](#15-using-more-than-one-window)
16. [The terminal (for advanced users)](#16-the-terminal-for-advanced-users)
17. [Your privacy](#17-your-privacy)
18. [Keyboard shortcuts](#18-keyboard-shortcuts)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. Installing Portalogia

Portalogia currently comes as a Windows app. Whoever gave you Portalogia will
usually give you a folder named **Portalogia-win32-x64**.

- **To run it without installing**, open that folder and double-click
  **Portalogia.exe**.
- **To install it**, follow the installation steps in the project's
  [README](../README.md#building-and-installing-on-windows). Installing adds
  Portalogia to your Start Menu and to **Settings > Apps**, so you can
  uninstall it there later.

The first time you open it, Windows may say *"Windows protected your PC"*.
This appears because Portalogia isn't signed by a registered publisher. If
you trust where your copy came from, click **More info**, then **Run
anyway**.

## 2. A tour of the window

```
┌─────────────────────────────────────────────────────────────────┐
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ (drag here to move) ▔▔▔▔▔▔▔▔▔▔  –  □  ×    │  ①
│ [ Tab ] [ Tab ] [ Tab ] [+]                                     │  ②
├───────────┬─────────────────────────────────────────────────────┤
│           │ ◀ ▶ ⟳  [ Search the internet...    ☆ ]  tools ...  │  ③
│ ● Home    ├─────────────────────────────────────────────────────┤
│ ● School  │                                                     │
│ ● Recipes │                 the page you're viewing             │  ⑤
│           │                                                     │
│ + New     │                                                     │
└───────────┴─────────────────────────────────────────────────────┘
     ④
```

1. **The title bar.** The row the tabs sit in. Drag any empty part of it to
   move the window, or double-click it to maximize. The top-right corner shows today's date and the time (24-hour, with seconds),
   with the Wi-Fi signal, the battery and the outside temperature (°F) to their left.
   Point at the tab row and the date and time give way to the buttons to
   minimize, maximize and close.
2. **Tabs.** Each open page is a tab. Click a tab to view it. Point at the
   tab row and click **+** to open a new one.
3. **The toolbar.** Back, forward and reload buttons, the **address bar**
   (where you type a website or a search), and buttons for the tools
   described in this guide. Point at any button to see what it does and its
   shortcut.
4. **The sidebar.** Your **workspaces**. Each one is a separate set of tabs.
5. **The page.** Whatever the current tab is showing.

## 3. Browsing the web

**To visit a website or search:**

1. Click the address bar (it says *Search the internet...*), or press
   **Ctrl+/**.
2. Type a web address (like `wikipedia.org`) or anything you want to search
   for (like `banana bread recipe`).
3. Press **Enter**.

Portalogia works out whether you typed an address or a search. Searches go to
Google.

As you type, Portalogia suggests pages from your bookmarks and history. Click
one, or use the arrow keys and press **Enter**.

| To... | Click | Or press |
| --- | --- | --- |
| Go back a page | ◀ | **Alt+←** |
| Go forward | ▶ | **Alt+→** |
| Reload the page | ⟳ | **Ctrl+R** |
| Stop a page loading | ✕ (while it loads) | |
| Go to the home page | | **Ctrl+H** |

When you're not typing in it, the address bar shows the site's name (for
example `wikipedia.org`), or your bookmark's name if you saved one. Click it
to see the full address.

**To make a page bigger or smaller**, press **Ctrl+=** or **Ctrl+-**. You
can also hold **Ctrl** and turn the mouse wheel, or use the **−** and **+**
buttons at the right of the toolbar. **Ctrl+0** returns the page to normal
size.

**While a page loads**, a line fills along the bottom of the address bar and
a percentage shows at its right end. It's an estimate, worked out from how
many of the page's files have arrived. It stays at 100% for a second, then
goes away.

**The bar along the bottom** of a web page counts its words, characters,
pictures, links and elements (the building blocks the page is made of), and
shows which element the pointer is over. Select some text and its words and
characters appear too.

## 4. Working with tabs

| To... | Do this |
| --- | --- |
| Open a new tab | Click **+**, or press **Ctrl+N** |
| Close a tab | Click the **×** on the tab, or press **Ctrl+W** |
| Switch tabs | Click the tab, or press **Ctrl+→** / **Ctrl+←** |
| Reopen a tab you just closed | **Ctrl+Shift+T** |
| Make a copy of a tab | **Ctrl+Shift+D** |
| Rearrange tabs | Drag a tab left or right |
| Find any open tab | Click the magnifying-glass button, or press **Ctrl+K** |
| Go to the 1st–8th tab | **Ctrl+1** to **Ctrl+8** |

**Ctrl+W closes the tab, never the whole window.** If you close the last tab
in a workspace, a fresh blank tab takes its place.

**Selecting several tabs at once:**

- Hold **Ctrl** and click tabs to pick them one by one.
- Hold **Shift** and click a tab to pick every tab between it and the current
  one.

You can then close them all together (**Ctrl+W**), or drag them all
together into another workspace or another window. A plain click on any tab
ends the selection.

**Searching your tabs.** Press **Ctrl+K** for a list of every open tab in
every workspace. Type a few letters to narrow the list, use the **↑** and
**↓** keys to choose a tab, and press **Enter** to go to it. **Escape**
closes the search.

> **Why can't I open more tabs?** Each workspace holds up to **8 tabs**. When
> it is full, the **+** button disappears. Close a tab, or start a new
> workspace for the next topic (see below).

## 5. Organizing with workspaces

A workspace is a named group of tabs, such as one for school, one for work
and one for a hobby. Switching workspaces swaps every tab at once, so each
project stays tidy.

| To... | Do this |
| --- | --- |
| Make a new workspace | Click **+ New workspace** at the bottom of the sidebar, or press **Ctrl+Shift+N** |
| Switch workspace | Click it in the sidebar, or press **Ctrl+↓** / **Ctrl+↑** |
| Rename a workspace | Double-click its name, type, then press **Enter** |
| Change its color or icon | Click the pencil button, or press **Ctrl+Shift+E** |
| Move a tab into a workspace | Drag the tab onto that workspace in the sidebar |
| Make a workspace from a tab | Drag the tab onto **+ New workspace** |
| Remove a workspace | Click the **×** beside it, or press **Ctrl+Alt+W** |

You always keep at least one workspace, and you can have up to **20**.

**Hiding the sidebar.** Press **Ctrl+L** to shrink the sidebar to a narrow
strip of colored dots. You can still click the dots. Press **Ctrl+L** again
to bring the sidebar back.

### Saving a workspace for later (workspace images)

A **workspace image** is a snapshot of a workspace's tabs that you can
reopen any time, such as "Tax research" or "Trip planning".

1. Click the **workspace images** button in the sidebar, or press
   **Ctrl+Shift+S**.
2. Click **Save** beside the workspace you want to keep.
3. Later, open the same window and click a saved image to bring back all its
   tabs.

From the same window you can rename or delete saved images. Saving a
workspace again never overwrites an older image. It makes a new one, so you
can keep several versions.

## 6. Bookmarks

**To bookmark the page you're on**, click the **☆** star in the address bar,
or press **Ctrl+B**. Give it a name if you like, and click **Save**. The tab
then shows your bookmark's name.

**To remove a bookmark**, click the filled **★** star again.

**To open a bookmark**, start typing its name or address in the address bar.
Bookmarks appear in the suggestions with a star beside them.

PDFs and notes can be bookmarked too, with the star in their own toolbars.

## 7. History

Press **Ctrl+Shift+H**, or click the clock button, to open your history.
It's a list of the pages, PDFs and notes you've opened, newest first.

- **To search your history**, type in the search box at the top.
- **To copy an entry's address**, click its copy button.
- **To delete one entry**, click its delete button.
- **To clear your history**, choose how far back to go at the top right, as a
  number and a unit (for example *2* and *hours*) or *all time*, then click
  **Clear History**. This happens straight away and can't be undone.

## 8. Finding words on a page

Press **Ctrl+F**, or click the find button. Type the word you're looking for.
Portalogia shows how many times it appears and highlights each one.

- Press **Enter** to go to the next match, or **Shift+Enter** for the
  previous one.
- Click **Aa** to match capital letters exactly.
- The other two buttons match whole words only, or (for advanced users)
  search with a "regular expression" pattern.
- Press **Escape** to close the find bar.

The find bar works the same way on web pages, PDFs, notes and the terminal.

## 9. Reading PDFs

1. Press **Ctrl+Shift+P**, or click the PDF button in the toolbar, to open a
   PDF tab.
2. Click **Open PDF**, or press **Ctrl+O**, and choose a file.

In a PDF tab you can:

- **Go to a page.** Type a page number in the box and press **Enter**.
- **Choose how the mouse works.** In **Pan** mode you drag to move around
  the page. In **Select** mode you drag to select text, and links can be
  clicked.
- **Mark it up.** Use the highlighter, pen, comments and text boxes (see
  [section 11](#11-highlighting-drawing-and-commenting)). Your marks are
  saved by Portalogia and never change the original file.
- **Crop pages.** Press **Ctrl+Shift+X** and draw a box around the part you
  want to keep.
- **Export a copy.** Click the export button to save a new PDF with your
  crops, drawings, text boxes and highlights included.
- **Rename it.** Click the file name in the toolbar and type a new one.
- **Close it.** Press **Ctrl+Shift+C**.
- **Jump to a page.** The bar along the bottom shows the page you're on. Click
  the number, type another and press **Enter**.
- **Go back.** After jumping to a page or following a link inside the PDF,
  the **‹** button (or **Alt+←**) takes you back to where you were, and **›**
  (or **Alt+→**) forward again.
- **Count it.** The bar along the bottom also shows the PDF's words,
  characters and links and the file's size. Select some text and its words
  and characters appear too.

## 10. Writing notes

Portalogia can open and write **Markdown notes**. These are plain text files
(ending in `.md`) with simple formatting. They work with other note apps
such as Obsidian.

1. Press **Ctrl+Shift+M**, or click the notes button, to open a notes tab.
2. Click **Create a new note**, or click **Open a note** (**Ctrl+O**) to
   choose one you already have.

**Viewing and editing.** A note has two modes: **View** shows it nicely
formatted, and **Edit** lets you type. Switch with the toggle in the
toolbar, or press **Ctrl+Shift+G**. Your changes are saved automatically.

**Formatting while you type:**

| You type | You get |
| --- | --- |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `==highlight==` | highlighted text |
| `# Heading` | a heading |
| `- item` | a bulleted list |
| `- [ ] task` | a checkbox you can tick in View mode |
| `[[Other note]]` | a link to another note |
| `$x^2$` | a math formula |

**Linking notes together.** Type `[[` and the name of another note to link to
it. Portalogia suggests note names as you type. Clicking a link opens that
note, and the **◀ ▶** buttons step back and forward through the notes you've
followed. The side panel shows the note's outline and every other note that
links to it.

**Pictures.** Pictures saved alongside your notes show up automatically.
Pictures from the internet appear as a placeholder until you click them.
This stops a note from telling a website that you opened it.

**Running code (advanced).** If a note contains a block of program code,
Portalogia can run it and show the result. It always asks you first and shows
you the code. **Only run code from notes you trust**, because it runs on your
computer.

**The bar along the bottom** shows where your cursor is (line, column and
word) and counts the note's words, characters and links. Select some text and
its lines, words and characters appear too.

## 11. Highlighting, drawing and commenting

These tools work on web pages, PDFs and notes. Turn a tool on with its
toolbar button or shortcut. Turn it off the same way, or press **Escape**.
Only one tool is on at a time.

| Tool | Shortcut | How to use it |
| --- | --- | --- |
| **Highlighter** | **Ctrl+J** | Select some text to highlight it |
| **Pen** | **Ctrl+P** | Draw freely over the page |
| **Comments** | **Ctrl+M** | Click a spot to pin a note there, then type |
| **Text box** | **Ctrl+E** | Click to place text. You can change its size and alignment. |
| **Laser pointer** | **Ctrl+I** | Shows a glowing pointer while you present. Nothing is saved. |
| **Crop** (PDFs) | **Ctrl+Shift+X** | Draw a box around the part of a page to keep |

- **Undo** a mark with **Ctrl+Z**, and **redo** it with **Ctrl+Y**.
- **Remove all marks** from the current page with the revert button, or
  **Ctrl+Shift+R**.

Your marks are saved on your computer and come back when you revisit the
page. **Websites can't see your comments or text boxes.**

**Pan and Select.** On web pages, PDFs and notes, the hand and text-cursor
buttons at the left of the tools choose how the mouse works. In **Pan**
mode (**Alt+1**) you drag to move the page around, and clicks don't follow
links. In **Select** mode (**Alt+2**) you select text and click links as
usual. Web pages and notes start in Select mode; PDFs start in Pan mode.

**Edit mode.** Some websites, such as Google Docs, use the same keys as the
tools (Ctrl+I for italic, Ctrl+E to center text). On a web page, click the
**keyboard** button left of the laser pointer, or press
**Ctrl+Alt+Shift+E**, to let the page have those keys. While edit mode is
on, the tools still work from their buttons but not from the keyboard.
Edit mode is set separately for each tab.

## 12. Saving and exporting

Click the **export** button in the toolbar to save what you're looking at:

- **A web page**, as a PDF, or as its web files in a folder so you can open
  it offline later.
- **A note**, as a PDF, a Markdown file, or plain text.
- **A PDF**, as a copy with your marks included (see
  [section 9](#9-reading-pdfs)).

## 13. Blocking ads

Portalogia blocks ads and trackers automatically. The **shield** button in
the toolbar shows how many ads it has blocked on the current page.

- **If a site doesn't work properly**, or you want to support it, click the
  shield (or press **Ctrl+Shift+B**) to allow ads on that site. Click it
  again to block them again.
- **To turn blocking off everywhere**, open the **View** menu and choose
  **Ad Blocker**.

Portalogia also removes common tracking codes (such as `utm_source=...`) from
web addresses.

## 14. Making Portalogia your own

| To... | Do this |
| --- | --- |
| Switch between light and dark | Click the sun/moon button, or press **Ctrl+D** |
| Change the highlight color | Click the **accent color** droplet button and pick a color |
| Hide everything but the page | Press **Ctrl+Shift+F** (Focus Mode). The page fills the window, which keeps its size. Press it again, or **Escape**, to come back. |
| Hide the sidebar | **Ctrl+L** |

The accent color is used for highlights, selections and marks throughout
the app.

## 15. Using more than one window

- **Open a new window:** **Ctrl+Alt+N**.
- **Move a tab to its own window:** drag the tab down out of the tab strip
  and let go anywhere. A new window appears where you drop it.
- **Move a tab into another window:** drag it onto the other window's tabs or
  workspaces.
- **Open the current tab in a new window:** click the open-in-new-window
  button, or press **Ctrl+Shift+O**.

All your windows share the same workspaces. A workspace made in one window
shows up in the others.

**Arranging windows.** Drag a window by its top strip to the left or right
edge of the screen to fill that half, to a corner to fill a quarter, or to
the top to fill the whole screen.

## 16. The terminal (for advanced users)

Press **Ctrl+>** (Ctrl+Shift+.), or click the terminal button, to open a
command-line terminal in a tab. It's a normal terminal on your own computer,
the same as one opened outside Portalogia. If you don't already use a
terminal, you can ignore this feature.

## 17. Your privacy

- Portalogia has **no accounts, no tracking and no data collection**.
  Nothing is sent to the people who make it.
- Your history, bookmarks, tabs and marks are stored **only on your
  computer**.
- Websites can't use your camera, microphone or location. Portalogia turns
  all those requests down.

The full details are in the [privacy policy](privacy.md).

## 18. Keyboard shortcuts

On a Mac, use **Cmd** in place of **Ctrl**.

**Tabs and windows**

| Action | Shortcut |
| --- | --- |
| New tab | Ctrl+N |
| Close tab | Ctrl+W |
| Close all tabs | Ctrl+Shift+W |
| Reopen closed tab | Ctrl+Shift+T |
| Duplicate tab | Ctrl+Shift+D |
| Next / previous tab | Ctrl+→ / Ctrl+← |
| Search tabs | Ctrl+K |
| New window | Ctrl+Alt+N |
| Open tab in new window | Ctrl+Shift+O |
| Minimize window | Ctrl+Alt+M |
| Maximize / restore window | Ctrl+Alt+Enter |

**Workspaces**

| Action | Shortcut |
| --- | --- |
| New workspace | Ctrl+Shift+N |
| Next / previous workspace | Ctrl+↓ / Ctrl+↑ |
| Edit workspace | Ctrl+Shift+E |
| Workspace images | Ctrl+Shift+S |
| Close workspace | Ctrl+Alt+W |

**Browsing**

| Action | Shortcut |
| --- | --- |
| Go to the address bar | Ctrl+/ |
| Back / forward | Alt+← / Alt+→ |
| Reload | Ctrl+R |
| Home | Ctrl+H |
| Find on page | Ctrl+F |
| Bookmark page | Ctrl+B |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 |
| Allow ads on this site | Ctrl+Shift+B |

**PDFs, notes and other tabs**

| Action | Shortcut |
| --- | --- |
| New PDF tab | Ctrl+Shift+P |
| New notes tab | Ctrl+Shift+M |
| Open a file (in a PDF or notes tab) | Ctrl+O |
| Switch note view / edit | Ctrl+Shift+G |
| Close the open PDF or note | Ctrl+Shift+C |
| History | Ctrl+Shift+H |
| Terminal | Ctrl+> |

**Tools**

| Action | Shortcut |
| --- | --- |
| Highlighter | Ctrl+J |
| Pen | Ctrl+P |
| Comments | Ctrl+M |
| Text box | Ctrl+E |
| Laser pointer | Ctrl+I |
| Crop (PDFs) | Ctrl+Shift+X |
| Remove all marks | Ctrl+Shift+R |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Pan / Select | Alt+1 / Alt+2 |
| Go to the 1st–8th tab | Ctrl+1 – Ctrl+8 |
| Edit mode (web pages) | Ctrl+Alt+Shift+E |

**Appearance**

| Action | Shortcut |
| --- | --- |
| Light / dark theme | Ctrl+D |
| Focus Mode | Ctrl+Shift+F |
| Show / hide sidebar | Ctrl+L |

> While you're typing in a box, keys like Ctrl+A, Ctrl+Z and the arrow keys
> work on your text instead of the app. This includes editors that websites
> build inside the page, such as a Google Docs document. Press **Escape** to
> leave the box, and the shortcuts work again. Some websites, Google Docs among
> them, keep Escape for themselves; press **Shift+Escape** there instead.

## 19. Troubleshooting

**Windows says "Windows protected your PC".**
Portalogia isn't signed by a registered publisher yet. Click **More info**,
then **Run anyway**, but only if you trust where your copy came from.

**A website looks broken or won't load something.**
The ad blocker may be blocking part of it. Click the shield button to allow
ads on that site, then reload with **Ctrl+R**.

**A website asks for my camera or location, and nothing happens.**
Portalogia doesn't allow websites to use your camera, microphone or location.

**I can't open another tab.**
The workspace has reached its limit of 8 tabs. Close one, or start a new
workspace with **Ctrl+Shift+N**.

**The tabs and sidebar disappeared.**
You're probably in Focus Mode. Press **Escape** or **Ctrl+Shift+F**.

**A keyboard shortcut does nothing.**
You may be typing in a text box. Press **Escape** (or **Shift+Escape**) first, then try again.

**I want to erase everything Portalogia has saved.**
Close Portalogia, then delete the folder `%APPDATA%\Portalogia`. Paste that
into the File Explorer address bar to find it. Your own notes and PDFs are
kept wherever you saved them, and aren't deleted.
