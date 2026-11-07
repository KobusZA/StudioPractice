# Brief: the wall elevation on a second screen

Someone with two monitors keeps the plan on one and the wall elevation on the other. The elevation edits the same drawing the plan holds. When it is on the second screen, the strip under the plan does not open.

## Goal

From an open wall face, one click moves the elevation into a separate window that can be dragged to another monitor. Every edit there (wall height, openings, finishes, foundations) changes the plan immediately and is one undo step on the plan. **Done** clears that window and leaves it open, waiting for the next wall. Opening the next wall's face shows it in that window, not in the strip.

## Do not change

- How an elevation edit is applied. `applyWallTopEdit`, `applyBandEdit`, `applyOpeningEdit`, `applyOutlinePoints`, and `finishCommit` stay as they are, and they still run in the plan tab, on `store.doc`.
- The save path. Only the plan tab saves. The second window holds no document, no `sync.js`, and no revision.
- The route profile and the floor picture. Both stay in the strip under the plan.
- The small elevation preview in the inspector (`#v2-ctx-elev`). It is a preview, not the elevation, and it stays.
- Undo labels, status messages, and the Escape order on the face. They are the same in either place.

## Where the elevation is

There is one setting, `elevationHost`, with two values: `strip` or `screen`.

- `strip` is today's behaviour.
- `screen` means a second window is open. While it is, the strip never shows a wall face. "Open this face" sends the face to the second window and brings that window forward.
- `screen` lasts only as long as the window does. When the user closes the second window, `elevationHost` goes back to `strip` and any open face is closed. The plan keeps its selection. The status bar says "The second screen was closed." and offers **Open this face**, which reopens the face in the strip.

## Opening the second screen

- A **Second screen** button goes in the wall-face header, next to **Fit** and **Show on plan**.
- The click calls `window.open(url, "tsp-wall-elevation", "popup,width=…,height=…")`. It has to happen inside the click, or the browser blocks it. The fixed name means a second click finds the window that is already open, wherever it is, and brings it forward. It never opens another one.
- If the browser blocks the window, the face stays in the strip and the status bar says "The browser blocked the second screen. Allow pop-ups for this site, then try again."
- The face that was open moves across, with its zoom and pan, and the strip closes in the same frame.

## The second window

- It is a small page, `wall-screen.html`, served next to `index.html` and loading the same `v2.css`. It contains the wall-face container and a waiting message, and has no logic of its own.
- **Waiting.** It shows "Waiting for a wall. Select a wall on the plan and choose Open this face." The window title is "Wall elevation · {job name}".
- **Showing a face.** It shows the same header, face editor band, info bar, edge-mode buttons, SVG, and coach as the strip. The title is "Wall elevation · {wall name}, {side}".
- **Done** is in the header where **Exit** sits in the strip. It ends the face and returns the window to waiting. The window stays open. It does what `closeOpenFace()` does today, except the host stays `screen`.
- The plan selection still drives it the way it drives the strip. Selecting another wall while a face is showing moves the elevation to that wall. Selecting something that is not a single wall face (empty plan, a room, several objects) returns the window to waiting rather than closing it.
- The plan tab handles keyboard shortcuts typed in the second window: Escape, Delete, Ctrl+Z / Ctrl+Y, arrows, and typed gaps. Ctrl+Z there undoes the last edit wherever it was made, as it does on the plan.

## Finishes and edits update the plan

Every control in the second window is handled by `ui.js` in the plan tab, against `store`. The second window never changes data itself. So:

- Changing a finish's type, product, or colour, its millimetres up or along the wall, or Add, Remove, Whole face, Up to 150 mm, Up to 1.2 m, or Draw area each commits through `finishCommit` (or the existing `pushUndo` and `persist` beside it). The plan, inspector, schedules, and finish areas redraw at once.
- Wall-top drags, opening drags, corner and edge drags, and outline edits still commit once, on release, in `endElevationDrag`.
- An edit made on the plan or in the inspector (moving the wall, changing the opening, undo) redraws the second window in the same `render()`.

## Implementation notes

- **Split the face out of the route-profile dock.** Move the wall-face parts (the title row's face buttons, `#v2-face-editor`, `#v2-elev-info-bar`, `#v2-elev-edge-mode`, `#v2-elevation-body`, `#v2-elev-coach`, and `#v2-face-flash-live`) into one `#v2-wall-face` container. Mount that container in the strip for `strip` and in the second window's document for `screen`.
- **Look elements up from that container, not from `document`.** Today `el.elevBody` and the rest are fetched from the main document once. They should be resolved from the mounted container, and fetched again whenever the host changes.
- **Bind listeners on the container.** Listeners that sit on `document` or `window` today also have to be bound on the second window's `document`: the outside-click that closes the info note, the keyboard handlers, the pointer move and up during a drag, and the resize used for the SVG fit. `setPointerCapture` and `getBoundingClientRect` work across windows of the same origin.
- **Do not compare by realm.** Avoid `instanceof HTMLElement`-style checks on nodes from the second window. They fail across windows.
- **Reconnecting.** `wall-screen.html` keeps a reference to `window.opener`. If the plan tab reloads, then once its document is loaded it calls `window.open("", "tsp-wall-elevation")` from **Open this face**, which finds the existing window without navigating it, and remounts the container. Until then, the second window shows "The plan was reloaded. Choose Open this face on the plan to continue." If the plan tab is closed, the second window shows "The plan is closed." and offers **Close window**.
- **Remember the choice.** The browser remembers `elevationHost` only for the current session. A new session starts in `strip`, because a blocked pop-up on load would be worse than one extra click.

## Acceptance

1. With a wall face open in the strip, **Second screen** opens one window, the face moves into it, and the strip closes. A second click does not open another window.
2. While the second screen is open, "Open this face" on any wall shows it there and never opens the strip.
3. Changing a finish's colour in the second window changes the plan and the inspector straight away, and is one undo step. Ctrl+Z, in either window, puts the colour back in both.
4. Adding a finish (Whole face) and drawing an area in the second window both show on the plan and in the finish areas, and both are saved.
5. Dragging the wall top in the second window changes the wall height on the plan on release, as one undo step.
6. **Done** clears the second window to waiting and leaves it open. The plan keeps its selection. The next "Open this face" fills the same window.
7. Selecting empty plan while a face is showing returns the second window to waiting. It does not close it.
8. Closing the second window sets the host back to the strip, closes the face, and offers **Open this face**. The next "Open this face" uses the strip.
9. The route profile and the floor picture still open in the strip while the second screen is open.
10. If the browser blocks the pop-up, the face stays in the strip and the message says so.

## Verify in the browser

With a job that has a few walls:

- Open a wall face, then choose **Second screen**, and drag the window to the other monitor. Confirm the strip has closed.
- Change a finish's colour and its top millimetres there. Watch the plan and inspector update. Press Ctrl+Z on the plan, then confirm the second window steps back too.
- Choose **Done**. Then select another wall on the plan and choose **Open this face**. It should appear in the same window.
- Reload the plan tab. The second window should say the plan was reloaded. Choose **Open this face**, and the face should come back in that window.
- Close the second window, and confirm the next face opens in the strip.
