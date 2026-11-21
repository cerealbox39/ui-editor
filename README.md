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

**Hold Shift and click to select multiple elements** in desktop inspect mode, including while New feedback is open. Shift-click a selected element to remove it; a plain click starts a single selection as before. Numbered outlines show the selection order. Save creates one note for all selected elements, and Copy all lists every element and its selector. Multi-element notes survive reload. Phone selection remains single-element.

This version supports:

- Issue types: UI/UX, Data, and New Feature
- Optional UI quick actions for UI/UX feedback: use the pencil to rename, add, or remove buttons, or choose **Restore to default** to bring back the original set. **Save actions** applies your changes for this site in your browser; it does not change feedback you already saved.
- A single comments field
- Row context from tables for Data and New Feature feedback
- Automatic migration of feedback saved by earlier versions into the new format
- Compact agent-ready reports with the page URL, exact selector, visible text, and requested change
- Extra parent or nearby-text context only when selector confidence is low

### Annotate a change

Select one or more elements in inspect mode, then choose **Annotate** (squiggle) in the **UI Quick Actions** row. Each selected element gets a padded ring automatically. The editor and feedback list move out of the way; your issue type, chosen action, and comment stay in the draft.

- **Move**: draw just an arrow from the selected element or group to where it should go.
- **Remove**: save the red ring immediately; an X is optional.
- **Highlight**: save the ring immediately.

Use a mouse, pen, or touch. Tap the selected-element step (**Circle something else**, or the compact **✓ Circle** button on phones) to draw a manual circle instead of the automatic rings. Circles fit the drag box. Choose a step in the top prompt to redraw it; another drag replaces that step's mark. A replacement circle clears the arrow/X, matching manual redraw. Switching mark type keeps the rings or circle and clears the second mark. **Save** becomes available when all required steps are complete. Older notes containing only a manual circle still render.

**Save** creates a normal numbered feedback note with a Move, Remove, or Highlight action. Your comment is kept; if empty, a plain request is generated. For Move, the arrowhead identifies a nearby page element and relative position (for example, just left of the search field). **Copy all** and auto-copy include this context and selectors in the Markdown report, not on screen. No screenshots are captured or attached.

**Cancel** or **Escape** discards the new marks and returns to your unchanged editor draft. **Exit inspect** or **Alt+Shift+P** also cancels annotation and retains the draft for when you select that element again.

Marks and numbered dots are stored with their notes in this browser for the exact page URL, restored after reload, and shown in inspect mode. They use document coordinates, so they stay in place when you scroll (they do not follow elements after page layout changes). Deleting a note or using **Clear all** removes its marks; editing an existing note and choosing Annotate replaces its marks only when saved.

## Try it

`demo/` holds a fake Northline Orders dashboard with the overlay already loaded. Run `python3 demo/server.py 8080` from the repo root and open `http://localhost:8080/` (it adds `pin=1` for you).

## Important

- Use only in development or protected preview environments.
- `pin=1` is an activation switch, not authentication.
- Clipboard access requires localhost or HTTPS and browser permission.
- Remove the stylesheet and script tags to uninstall the overlay.
