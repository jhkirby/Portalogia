# Northstar Privacy Policy

*Effective: October 6, 2026*

Northstar is a desktop web browser made by Joshua H. Kirby. This policy
explains what Northstar stores, what it sends over the network, and what it
does not do.

**The short version:** Northstar has no accounts, no analytics, no telemetry,
and no servers of its own. Everything it saves stays on your computer. The
developer never receives any of your data.

## What Northstar stores on your computer

Northstar saves the following in its profile folder so that it can work
between restarts. None of it leaves your computer.

| Data | What it is |
| --- | --- |
| Browsing history | Pages and PDFs you've opened, with titles and times |
| Session and workspaces | Your open tabs and workspaces, so they come back after a restart |
| Workspace images | Saved sets of tabs you can reopen later |
| Bookmarks | Pages and notes you've bookmarked |
| Annotations | Highlights, comments, text boxes and pen marks you add to web pages, PDFs and Markdown notes |
| Ad-blocker settings | Whether blocking is on, the sites you've allowed, and a cached copy of the filter lists |
| Website data | Cookies, cache, and site storage (such as local storage) that the websites you visit save, the same as in any browser |

Markdown notes you create or edit are saved wherever you choose to save them.
Code you run from a note runs on your own computer with interpreters you
already have installed, and its temporary files are deleted afterward. The
built-in terminal is a normal shell on your own computer.

### Where it's kept, and how to delete it

The profile folder is:

- **Windows:** `%APPDATA%\Northstar`
- **macOS:** `~/Library/Application Support/Northstar`
- **Linux:** `~/.config/Northstar`

You can clear your history from the History page inside Northstar. To erase
everything, quit Northstar and delete the profile folder. Uninstalling
Northstar may leave this folder behind, so delete it yourself if you want it
gone.

## What Northstar sends over the network

Northstar only connects to the internet to do what you ask it to do, plus one
background download:

- **Websites you visit.** Like any browser, Northstar sends the sites you
  visit the usual information browsers send, such as your IP address, the
  page you're requesting, cookies those sites set earlier, and a user-agent
  string identifying the browser. What those sites do with it is governed by
  their own privacy policies.
- **Web searches.** When you type something into the address bar that isn't
  a web address, Northstar sends it to Google Search. Google's privacy policy
  applies: <https://policies.google.com/privacy>.
- **Ad-blocking filter lists.** When the ad blocker is on, Northstar
  periodically downloads public filter lists maintained by Ghostery from
  GitHub (`raw.githubusercontent.com`). This request contains no information
  about you or your browsing. Blocking happens entirely on your computer.
- **Spell-check dictionaries (Linux only).** On Linux, Chromium may download
  spell-check dictionaries from Google the first time they're needed. Windows
  and macOS use the operating system's built-in spell checker.

Northstar does **not**:

- collect usage statistics, analytics, or crash reports;
- check in with or send anything to the developer;
- sell, share, or rent any information to anyone;
- show ads or track you for advertising.

## Site permissions

Northstar denies websites access to your camera, microphone, location,
notifications, and other device permissions. The only permission it grants is
full-screen mode for web pages, such as a video player's full-screen button.

## Children

Northstar doesn't collect personal information from anyone, including
children under 13.

## Changes to this policy

If a future version of Northstar changes what it stores or sends, this policy
will be updated and its effective date changed. A new version of the policy
ships with each copy of the app.

## Contact

Questions about this policy can be sent to Joshua H. Kirby, the developer of
Northstar.
