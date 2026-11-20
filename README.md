# UI Editor

Dependency-free UI and application feedback overlay for local development and protected preview environments.

[![UI Editor launch film](docs/ui-editor-launch.gif)](https://raw.githubusercontent.com/cerealbox39/ui-editor/main/docs/ui-editor-launch.mp4)

[Watch the launch film with sound (MP4, 41s)](https://raw.githubusercontent.com/cerealbox39/ui-editor/main/docs/ui-editor-launch.mp4)

## Install

Easiest method:
Download this folder and tell your coding agent to add this to your webapp

Alternatively:
Copy this folder into your app's public/static assets directory and add these tags before `</body>`:

```html
<link rel="stylesheet" href="/ui-editor/ui-editor.css">
<script src="/ui-editor/ui-editor.js"></script>
```

Adjust the folder path if you rename or relocate it.

## Use

Open the app with `pin=1` in the query string:

```text
http://localhost:3000/dashboard?pin=1
```

If the URL already has query parameters, append `&pin=1`.

Click the floating feedback button or press `Alt+Shift+P`, select an element, complete the feedback form, and save. The generated Markdown report can be copied from the overlay.

In inspect mode, a small dot on each element with saved feedback shows its number in the feedback list. The dots renumber when you delete a note and disappear when you leave inspect mode or use **Clear all**.
Select a note in the feedback list to bring its element into view and highlight it while editing, or select a numbered dot to highlight its note in the list.

This version supports:

- Issue types: UI/UX, Data, and New Feature
- Optional UI quick actions for UI/UX feedback: Remove, Bold, Reduce font, Increase font, and Standardise (max 3 font sizes)
- A single comments field
- Row context from tables for Data and New Feature feedback
- Automatic migration of feedback saved by earlier versions into the new format
- Compact agent-ready reports with the page URL, exact selector, visible text, and requested change
- Extra parent or nearby-text context only when selector confidence is low

## Important

- Use only in development or protected preview environments.
- `pin=1` is an activation switch, not authentication.
- Clipboard access requires localhost or HTTPS and browser permission.
- Remove the stylesheet and script tags to uninstall the overlay.
