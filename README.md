# Tab Overview for Microsoft Edge

This extension works like macOS Mission Control, but for browser tabs. Press a shortcut and every tab in every Edge window appears as a live thumbnail grid, with one section per window. From there you can click to switch, type to filter, close tabs, or drag them between windows.

It works in Microsoft Edge and should also work in Chrome and other Chromium browsers (only tested in Edge on macOS). There is no build step: it's plain HTML, CSS and JavaScript.

## Install

1. Download this repository: `git clone https://github.com/ShaKy8/edge-tab-overview.git`, or use **Code → Download ZIP** and unzip it.
2. Open `edge://extensions`.
3. Turn on **Developer mode** (bottom-left).
4. Click **Load unpacked** and choose the downloaded folder.
5. Open `edge://extensions/shortcuts` and confirm **Tab Overview → Show or hide Tab Overview** is set to **Control+Shift+Space**. If it's blank, or you'd prefer different keys, click the field and press the combination you want.
6. Optional: pin the icon to the toolbar. Clicking it does the same thing as the shortcut.

After you edit any file, click **Reload** on the extension card in `edge://extensions`.

## Using it

| Action | How |
|---|---|
| Open or close the overview | Control+Shift+Space (Ctrl+Shift+Space on Windows/Linux) or the toolbar icon |
| Switch to a tab | Click it, or select it with the arrow keys and press Return |
| Filter | Start typing; the text matches titles and URLs |
| Close a tab | The × on a card, Cmd+Backspace, or a middle-click |
| Move a tab | Drag it onto another card (drops before or after it) or onto an empty part of a window's section |
| Exit | Esc (the first press clears the filter), or click another Edge window |
| Capture thumbnails | **Refresh all** flips through each tab to take a picture of it |
| Card size | Slider in the top-right |

Dropping a card next to a tab in a group adds it to that group. Dropping it among ungrouped tabs removes it from its group.

## How thumbnails work (and their limits)

- Edge lets an extension take a picture of a tab only while that tab is **visible**. So a thumbnail is captured when you view a tab. Tabs you haven't viewed since Edge started show the site icon and title instead.
- **Refresh all** works around this by switching to each tab for a moment, so you'll see flicker. With "Include sleeping tabs" checked, sleeping tabs are woken (reloaded) so they can be captured; Edge will put them back to sleep later.
- Thumbnails are kept **in memory only** (`chrome.storage.session`). They are wiped when Edge quits and never written to disk. The cap is about 10 MB, roughly 300 thumbnails; beyond that the oldest are dropped.
- Edge doesn't allow captures of `edge://` pages or the extension stores, so those always show a placeholder.

## Privacy and permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Read tab titles, URLs, and favicons to build the grid |
| `tabGroups` | Show group names and colors, and move tabs into or out of groups |
| `storage` | Keep thumbnails in memory, plus two settings (card size, sleeping-tab toggle) |
| `<all_urls>` (host access) | Required by Edge to take screenshots of tabs (`captureVisibleTab`). The extension **does not** inject scripts into or read the content of any page. |

The extension makes no network requests and has no analytics or remote code. It's four small files you can read: `manifest.json`, `background.js`, `overview.html/.css/.js`.

## Optional: other triggers with BetterTouchTool (macOS)

Edge doesn't allow extension shortcuts that combine Cmd and Option, and it can't see trackpad gestures. [BetterTouchTool](https://folivora.ai/) (BTT) can get around both: set up a trigger that applies only to Edge and have it send **Control+Shift+Space**.

- **Keyboard:** in BTT, select Microsoft Edge, add a **Keyboard Shortcut** trigger such as Shift+Option+Cmd+Space, and set the action to **Send Keyboard Shortcut → Control+Shift+Space**.
- **Trackpad:** add a **Trackpad** trigger (for example 4 Finger Swipe Up) with the same action. Pick a gesture macOS isn't already using. If macOS uses it (System Settings → Trackpad → More Gestures), it takes the gesture before BTT sees it.

## Files

```
manifest.json    extension definition (MV3)
background.js    captures thumbnails and opens/closes the overview
overview.html    the overview page
overview.css     styling (follows macOS light/dark mode)
overview.js      grid, filtering, keyboard, drag and drop
icons/           toolbar icons
```

## License

[MIT](LICENSE)
