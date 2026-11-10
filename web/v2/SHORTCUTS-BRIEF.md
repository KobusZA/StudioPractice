# Brief: two-letter shortcuts

Revit users run the program from the keyboard. WA starts a wall, DR a door, MV a move, and they press them without looking at the ribbon. Today the only keys that do anything are Ctrl+Z, Ctrl+Y, Ctrl+A, Ctrl+G, Ctrl+Shift+G, F6, and R, which rotates a selected component. Everything else is a click.

This pass adds the two-letter shortcuts, fixed in a table. Typing one runs the same function as clicking that ribbon button, so a shortcut can never do something the button would not.

## Decisions

1. **A shortcut names a ribbon button, not a command.** Walls, Boundary and Foundations all use the wall tool and differ by which types they open. The shortcut carries the button's id, and the key handler calls `onRibbonFunction` with that button. The running command is put down and the new one starts, because that is what clicking the button does.
2. **The table is fixed.** There is no shortcut editor and nothing is written to the job or the browser. Changing a shortcut means changing the table. An editor is a later pass.
3. **Letters only, case ignored.** Digits stay with the length typing they already do. A key held with Ctrl, Cmd or Alt stays with the shortcuts already there (undo, redo, select all, group) and never enters the buffer.
4. **One second to finish the pair.** The letters typed so far are forgotten one second after the last one, and also on Escape, on any mouse click, and on any key that is not a letter. A letter typed by mistake must not still be waiting when the next thing is typed.
5. **A pair that matches fires at once**, unless those letters are also the start of a longer shortcut. Nothing in the table is longer than two, so every match fires on the second letter.
6. **A second letter that matches nothing starts again.** The buffer keeps that letter and reads it as the first of a new pair. Q then A waits on A, because A begins Align and Attach.
7. **R still rotates a selected component.** R is the first letter of several shortcuts, so it cannot fire on its own. If a component is selected and the second letter has not come when the second runs out, the component rotates, as R does today. If the second letter comes in time, the shortcut wins and nothing rotates.
8. **A shortcut for a button that is greyed out does nothing and says why**, in the same words the button's tooltip uses. "Select something first." when the button needs a selection. "The template has no wall types." when the button's category is empty. The words come from the button, not from a second copy.

## How it reads

While the first letter is waiting, the status line lists what it can finish:

```
W — WA walls · WN windows
```

The ribbon hint is left alone, and it replaces the status line once the shortcut fires, because the hint already says what to do next. Only a refused shortcut sets the status line itself.

Each button's tooltip gains its shortcut at the end, so the Walls tooltip reads as it does now followed by `· WA`. A button with no shortcut is unchanged.

## The table

### Copied from Revit

These are the shortcuts a Revit user already has in their hands. They are copied exactly.

| Keys | Button |
|---|---|
| WA | Walls |
| DR | Doors |
| WN | Windows |
| RM | Room |
| LL | Insert level |
| DI | Dimensions |
| MV | Move |
| CO | Copy |
| RO | Rotate |
| MM | Mirror |
| AL | Align |
| SL | Split |
| TR | Trim to corner |

### Chosen here

Revit leaves these blank, or this program has no single command under Revit's name. Each is two letters from the button's name, and none collides with the copied set or with another row.

| Keys | Button |
|---|---|
| BW | Boundary |
| FN | Foundations |
| RR | Separate (room separation line) |
| FL | Floors |
| RF | Roofs |
| RC | Cut roof |
| CI | Ceiling |
| BM | Beams |
| CL | Columns |
| ST | Staircase |
| EL | Electrical |
| PL | Plumbing |
| WH | Water heating |
| DN | Drainage |
| SR | Draw route |
| FR | Furniture |
| CW | Casework |
| ML | Model (line) |
| DL | Annotate (line) |
| RV | Revision cloud |
| RG | Region |
| SE | Section |
| EV | Elevation |
| PI | Project information |
| PR | Property line |
| SG | SG diagram coordinates |
| BL | Building line |
| SA | Select same type |
| MG | Merge |
| CU | Cut |
| JN | Join |
| TS | Trim single |
| TY | Trim circle |
| AT | Attach base |
| DT | Detach base |
| GP | Group |
| UG | Ungroup |
| VD | 3D |
| VC | Camera |
| CT | Call out |
| SH | Sheets (A0–A4) |
| BQ | BOQ |
| MB | BOM |
| DX | Export CAD |
| IF | Export IFC |
| PU | PDF / image |
| SV | Satellite |
| CK | Check (opens the Check tab) |
| DQ | Data quality |

CK is the one shortcut that is not a button. It opens the Check tab, as clicking the tab does. Run checks is the one compliance button on that tab, and it opens the panel with every part grouped inside it.

### Deliberately left out

| Revit shortcut | Why it has no row |
|---|---|
| GR grid | Grids are not built. When they are, they take GR. |
| OF offset | There is no offset tool. When there is, it takes OF. |
| CS create similar | There is no create-similar command. Select same type is the nearest and it has SA. |
| CM component | There is no single component button. Furniture is FR and casework is CW. |
| DM mirror, draw axis | There is one mirror command, on MM. |
| ZE, ZR, ZO zoom | The wheel zooms. There are no zoom commands. |
| UN undo, RD redo | Ctrl+Z and Ctrl+Y already do these, and the plan strip has the buttons. They are not on the ribbon. |
| Delete | The Delete key already does this. The button stays on the tab for the selection. |
| This level only | The Active cut panel has the checkbox. |
| Ramp, railings, contours, platform, DWG, CAD, print | The button is not built, so it gets no shortcut. |
| Split here, Snap end, Show face, Flip face, Flip hinge, Flip swing, Existing, Proposed, and the other selection-only buttons | They act on what is already selected and live on its tab. |

## Where it lives

A new `shortcuts.js` with no DOM and no imports, so it can be tested on its own.

- `SHORTCUTS`: the table above, each entry `{ keys, itemId }`, plus the one `{ keys: "CK", tabId: "check" }`.
- `shortcutFor(itemId)`: the keys for a button, or null.
- `nextShortcut({ buffer, at, key, now })`: the pure step. `buffer` is the letters waiting and `at` is when the last one arrived. Returns `{ buffer, at, fire }`, where `fire` is the matching entry or null. A gap of a second or more between `at` and `now` clears the buffer before the new letter is read. Escape, passed as `key: null`, clears it.

`ribbon.js` imports `shortcutFor` and `renderRibbon` appends ` · WA` to the tooltip it already builds. Nothing else in the ribbon changes.

`ui.js` holds the buffer. For a bare letter, with no modifier and no field focused, it calls `nextShortcut` and then:

- an entry with `itemId`: the same greyed-out checks the button goes through, and either the refusal sentence or `onRibbonFunction` with that button;
- an entry with `tabId`: the Check tab, as clicking it does;
- otherwise: the status line, when the buffer is non-empty.

A one-second timer calls the same step with no key, so a buffer that runs out clears itself, and rotates the selected component when the buffer was exactly R. A mousedown anywhere clears the buffer.

## Do not change

- The meaning of any key that already does something: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+A, Ctrl+G, Ctrl+Shift+G, F6, Escape, Enter, Tab, Space, the arrows, Delete, Backspace, and the bracket keys on the circle trim.
- R on its own with a component selected. It still rotates that component; it only waits the second first.
- Typing a length. Digits never reach the buffer, and a field that has the focus takes every key, as now.
- What any button does. The shortcut calls the button's function and adds no behaviour of its own.

## Acceptance

1. W then A, inside the second, arms Walls with the wall types open. The same for DR doors, WN windows, FN foundations and FL floors, each opening its own types.
2. W then A, with the A more than a second later, does not arm Walls. The A starts a fresh buffer and the status line offers Align and Attach.
3. W on its own shows `W — WA walls · WN windows` and arms nothing. Escape clears it, and so does a click.
4. MV with nothing selected shows "Select something first." and arms nothing. MV with a wall selected starts the move.
5. A button whose category has no types reports that and arms nothing.
6. TR starts Trim to corner. TS starts Trim single. CK opens the Check tab.
7. Ctrl+Z still undoes, including while a buffer is waiting. A digit typed while a wall is being drawn still sets its length.
8. R with a component selected and no second letter rotates it once the second has passed. RO inside the second starts Rotate and the component is not rotated.
9. The Walls tooltip ends with `· WA`. A button with no shortcut keeps its tooltip word for word.
10. Q then A leaves the buffer as A and offers the A shortcuts. It does not clear.
11. Tests cover `nextShortcut`: a completed pair, a pair split by more than a second, a second letter that restarts the buffer, Escape, a first letter that only waits, and R waiting rather than firing. The existing keyboard behaviour is covered by the checks above.

## Verify in the browser

- Press WA. A wall tool is armed and the type list shows wall types. Draw one segment and press DR. The wall command is gone and a door wants a wall.
- Press MV with nothing selected. The status line says to select something. Select a wall, press MV, and the move starts.
- Press W and wait. The status line offers the W shortcuts, and a moment later it clears without arming anything.
- Press R twice, slowly, with a component selected. It rotates once per press. Press RO quickly and Rotate starts instead.
- Hover Walls. The tooltip shows WA.
