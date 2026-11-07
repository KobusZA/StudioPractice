# Brief: the contextual ribbon

Today a wall's actions are in four places. Move and Rotate are on the **Site & modify** tab, Rotate and Copy and Delete are again in the strip on the plan, Snap and Split are in the "This wall" pill on the canvas, and Cut into this roof and Edit as polygon are buttons inside the inspector. Someone who has clicked a wall has to know which of the four to look in.

Revit answers this with a contextual tab. Select a wall and a green **Modify | Walls** tab opens on its own, holding every action for that wall. We are doing the same.

The rule that keeps it findable: **actions are on the ribbon, values are in the inspector, and the canvas keeps only the handles you drag.**

A working prototype is `web/v2/contextual-ribbon-mock.html`. Open it in a browser first. It is a standalone page with its own data and no imports; it is the agreed behaviour, not code to copy. The small grey tags on its buttons ("Ribbon", "Plan header") exist only to show where each action lives today. They are not shipped.

## Do not change

- What any command does. `onRibbonFunction`, `runCommand`, `armPlacement` and the command bodies stay as they are. This brief moves buttons; it does not touch behaviour.
- `ribbon-fit.js`. Its glyphs, its shrink ladders and `decorateRibbon` keep working, and the new tabs go through them unchanged.
- The drawing itself. Door swings, window symbols, sanitary symbols, the wall-end drag handles, the floor edge handles and the wall-top drag in the elevation all stay.
- Select, Pan, Undo, Redo, History and the Both / Existing / Proposed segment in the plan strip. Those are how you look at the plan, not commands on a selection.
- The inspector's elevation preview picture (`#v2-ctx-elev`). The second-screen brief depends on it.
- `HINTS` in `ribbon.js` as the one source of next-step text.

## Part 1 — remove Simple mode

Full becomes the only ribbon. Do this first and land it on its own, so the contextual work starts from one code path.

- Delete `SIMPLE_TABS`, `simpleTabsForState`, `visibleInSimple` and `SHEET_LOADERS` from `ribbon.js`. Delete `firstTabId`'s `mode` argument and return `RIBBON[0].id`.
- In `renderRibbon`, delete the `mode` branch and the `selectionLocked` block with its "Select a wall, door or slab…" note. Part 3 replaces what that note was for.
- `state.sheetLoaded` and `state.hasSelection` were read only by the Simple paths. `hasSelection` comes back in Part 3; `sheetLoaded` goes.
- In `ui.js`: delete the `density` variable and its `localStorage` read and write, `setDensity`, the `[data-density]` listener loop, the pressed-state sync near line 13699, and the `density ===` tests in the `drawRibbon` refresh check near line 4046. Drop `mode: density` from the `drawRibbon` state.
- In `index.html`: delete the `.ribbon-density` block (the Toolbar label and the Simple / Full segment, lines 79–85).
- In `v2.css`: delete `.ribbon-density`, `.ribbon-density-label`, `.ribbon-density .seg button` and the media-query rule near line 2226. `.ribbon-tabrow` loses its second child, so check the tab row still sits correctly.
- Tests: `tests/finishes.test.js` and `tests/ribbon-fit.test.js` both import `SIMPLE_TABS`. Remove those imports and the assertions that only cover Simple. Keep every `RIBBON` assertion.
- Leave `ribbon-mock.js` and `ribbon-mock.html` alone. They are a dated evaluation of Simple against Full, and they do not import the live Simple code.

## Part 2 — contextual tabs

Add to `ribbon.js`, beside `RIBBON`:

```js
export const CONTEXT_TABS = { wall: {...}, opening: {...}, ... };
```

Each entry holds a `label` and `groups`, where the groups list **item ids** resolved against `ITEM_INDEX`, exactly as the old `SIMPLE_TABS` did. A command is still defined once in `RIBBON`, so its label, command, tool, categories, todo, glyph and hint follow it onto every tab. New actions that have no `RIBBON` entry (Snap end, Show face, Flip face, Second screen, Flip hinge, Flip swing, Cut into this roof, Edit as polygon, Follow external walls) get one, on the tab where they belong.

The tab appears right after the permanent **Modify** tab, not at the far right as in Revit. It sits next to the related tab and does not move when the tab row changes.

The tabs, by selection kind:

- **Walls.** Edit: Move, Copy, Rotate, Mirror, Align, Delete. Wall: Split here, Snap end, Join, Select same type. Trim and extend: Trim to corner, Trim single, Trim circle. View: Show face, Flip face, Second screen. Finishes: Wall finishes. Height: Attach base, Detach base. Arrange: Group, Ungroup.
- **Doors.** Edit: Move, Copy, Rotate, Mirror, Align, Delete, Select same type. Door: Flip hinge, Flip swing.
- **Windows.** Edit: Move, Copy, Rotate, Mirror, Align, Delete, Select same type.
- **Floors.** Edit as above. Floor: Edit as polygon, Follow external walls, Floor finishes.
- **Roofs.** Edit as above. Roof: Cut into this roof, Edit as polygon.
- **Service routes and nodes.** Edit: Move, Delete. Route: Add node, Rise / drop, Connect, Change size / type, Drainage slope. These five carry `needs: "service"` in `RIBBON` today and are shown conditionally on Build. Move them here and drop the condition.
- **Multi-Select**, for a mixed selection: only the actions every selected kind can take. Compute it as the intersection of the kinds' Edit groups, not a hand-written list.
- **Selection**, for a kind with no tab of its own (a beam, a column, furniture, a stair, a dimension, a line): the shared Edit actions. A room is not this tab.

A **room** gets no tab. Its only action is Delete, which is already on Modify, and its name and use stay in the inspector. A **site boundary** (`propertySelected`) gets none either.

### When the tab opens and closes

- The selection changing to a kind that has a tab shows that tab and makes it active.
- Switching to a permanent tab by hand leaves the green tab on the row, inactive. Clicking it returns.
- Clearing the selection removes the tab and returns to the permanent tab the user was on before it opened. Track that as `previousTab`, set when the tab first opens, not on every render.
- The selection changing from one kind to another swaps the tab in place and keeps it active.

### What leaves its old home

- **Plan strip:** delete `#v2-header-modify` with its Rotate, Copy and Delete buttons, and `syncHeaderModify`. The door relabelling it does (Rotate becomes Flip hinge, Copy becomes Flip swing) becomes two real buttons on the Doors tab, so `selectedDoor` and `flipDoors` stay, with the relabelling gone.
- **Canvas pill:** delete `#v2-wall-edit` with its Snap and Split buttons, and `placeWallEdit`'s positioning. The `wallEdit` state machine, `handleWallEditClick`, `previewWallEdit` and `drawWallEditPreview` all stay — the ribbon buttons arm them instead.
- **Inspector:** `#v2-ctx-roof-cut-start`, `#v2-ctx-shape-poly`, `#v2-ctx-follow`, `#v2-ctx-elev-flip` and `#v2-ctx-elev-open` move onto their tabs. Their handlers stay where they are and are called from the ribbon. The hint paragraphs that sit under them (`#v2-ctx-shape-poly-hint`, `#v2-ctx-follow-note`, `#v2-ctx-roof-cut-note`) go through `setRibbonHint` instead.

After this, the inspector holds type, status, name, use, dimensions, the elevation preview picture and the finish panel. No command buttons.

## Part 3 — settings on the ribbon, sizes on the canvas

The running command's settings are not a strip under the ribbon. That strip cost a row of height on every screen, and the buttons sat above the ribbon, away from the cursor.

- Wall location line, arc and corner, the floor/roof outline link (Sketch / Room / External walls), and the roof-cut Hole / Remove segment are a **Settings** group on the open tab. It is shown only while those controls apply, and it does not shrink.
- **Disjoin** sits beside Move, and only while Move is armed. Move keeps the selection tab active.
- **Cut roof** is not a placing tab. Cutting stays on Modify | Roofs (or on whatever tab is open), and Esc stops the cut without clearing the roof.
- Length, angle, width and height stay in `#v2-plan-options`, overlaid on the canvas next to the hint. They are what you type with your hands already on the drawing.

The hint (`#v2-ribbon-hint`) stays where it is. The Settings group is for choices you click; the hint is for what to do next.

## Part 4 — the placing tab

Arming a draw tool opens a green tab too: **Modify | Place Wall**, **Modify | Place Door**, and so on. It shows the group the tool came from, so a wrong type is one click away, and it puts the tool's settings on the options bar.

Derive the label from the item: a `tool` on a `RIBBON` item means it places something. Do not hand-write ten more tab definitions. A short override covers captions that do not name the thing placed, so Staircase reads Place Stair and Water heating reads Place Water heater.

Esc already steps back through a half-drawn shape. Add one step to the end of that chain: the Esc that disarms the tool also closes the placing tab and returns to the previous permanent tab. It must not also clear a selection in the same press.

## Which actions wait for a selection

Only these grey out with nothing selected: Move, Copy, Rotate, Mirror, Delete, Group, Ungroup, Select same type, Attach base, Detach base, Snap end.

These stay live, because they ask you to pick as you go, which their hints already say: Align, Join, Split, Trim to corner, Trim single, Trim circle.

## Icons

Every ribbon button already gets a glyph from `GLYPHS` in `ribbon-fit.js`, filled in by `decorateRibbon`. The ids that move keep theirs. Add glyphs in the same 24×24 stroked style for the new ids: `snap`, `edit-face`, `flip-face`, `second-screen`, `flip-hinge`, `flip-swing`, `roof-cut`, `edit-poly`, `follow-walls`. Anything without one falls back to the generic box, which is a visible gap, not a crash.

## Width

The Walls tab has about eighteen buttons across five groups, the widest of the new tabs. Give its Edit group a protected `GROUP_PRIORITY` (−1, as Walls has today) so it is last to shrink. Check the tab at 1280px before calling it done.

## Acceptance

1. There is no Simple / Full switch, and no stored density. A first load shows Build.
2. Clicking a wall opens a green **Modify | Walls** tab and makes it active. Every wall action is on it.
3. Rotate, Copy and Delete no longer appear in the plan strip, and the "This wall" Snap / Split pill no longer appears. Both still work, from the ribbon.
4. Clicking Build with the wall still selected leaves the green tab on the row. Clicking the green tab returns to it. Esc removes it and lands back on Build.
5. Selecting a wall while on Document, then pressing Esc, returns to Document.
6. Selecting a wall and then a door swaps the tab to **Modify | Doors** with Flip hinge and Flip swing on it.
7. Shift-selecting a wall and a door opens **Modify | Multi-Select** with only the shared actions.
8. Selecting a room opens no green tab. Delete still works from Modify, and the room's name is still editable in the inspector. Selecting a beam, column or piece of furniture opens **Modify | Selection** with the shared Edit actions.
9. Clicking Walls opens **Modify | Place Wall** and puts the location line, arc and corner in a Settings group on that tab. Space still flips the face. Esc stops the tool and returns to the previous tab, without clearing anything else.
10. Move puts Disjoin beside the Move button and keeps the selection tab active. Esc cancels the move and keeps the wall selected.
11. With nothing selected, Align, Join, Split and the trims are clickable; Move, Copy, Rotate, Mirror and Delete are not.
12. The inspector has no command buttons. Cut into this roof, Edit as polygon, Follow external walls, Show face and Flip face are all on the ribbon. The elevation preview picture is still in the inspector.
13. Every button on every tab has an icon, and the ribbon still shrinks to one row at 1280px.
14. `node --test web/v2/tests` passes.

## Verify in the browser

Load the demo house, then:

- Click a wall. Split it from the ribbon, then undo. Snap an end from the ribbon, then undo.
- Click a door and flip its hinge, then its swing, from the Doors tab.
- Click a roof and cut into it from the Roofs tab, not the inspector.
- Click Walls, change the location line in the Settings group, draw a wall, and press Esc twice: once to stop drawing, once to close the tab.
- Select a wall, press Move, tick Disjoin beside Move, move it, and confirm the joined walls came apart.
- Narrow the window to 1280px with the Walls tab open, and confirm the ribbon is still one row.
