# Brief: floor finishes, the same strip as a wall

Walk [`floor-finish-ux-mock.html`](floor-finish-ux-mock.html) once before coding. Build what that picture shows. The wall elevation already has the behaviour this view copies. Do not invent a second strip, a second editor, or a second set of controls.

## Goal

Floor finishes opens a picture of the selected floor, in the same dock a wall elevation already uses. The plan above it only marks which floor. Drawing and Line / Corner happen on the picture. The inspector is a list, one line per finish, each with its area.

## Do not change

- Finish data, coverage, compile, and BoQ. Regions stay `doc.finishRegions`, hosted by a room or a slab.
- The wall elevation: its dock, its maths, its Escape order, its coat marks. Reuse them.
- Building compass elevations (`elevation.js`, Document → Views → Elevation).
- Floor types. The Floors command still picks a structural floor type. Floor finishes does not.
- Up the wall / along the wall. A floor finish is an area. There is no flip-face. “Finish every wall of this room” stays on the wall view.
- Look-and-feel tokens. Match `v2.css` and the wall strip.

## What the mock shows

1. **The plan is a marker.** While the floor is open the plan is a short band, with the kitchen outlined in copper. A drag bar under it gives the plan more room, up to about half the column. The floor picture keeps the rest. Show on plan flashes that outline. Exit returns to the plan.
2. **The copper box is one row, and it does not move the picture.** Swatch, name, area, then Type and Product and Remove. Add a finish sits beside the box, not inside it. Cover whole floor and Draw area appear in that same row. Nothing is stored until one of those is chosen. Screed is the base. Tile, timber, vinyl, carpet, and waterproofing go on top. The type list is those two groups.
3. **The shared-patch mark is the wall’s.** A buried finish is a line just inside, in its own colour, with a pile of swatches labelled “2 finishes” or “3 finishes”. One line under the picture says so. It opens upward and does not push the drawing.
4. **A finish with its own corners shows handles and the length of an edge.** Line moves the edge. Corner adds a point. The same chip as a wall. A finish that follows the whole outline (the screed, until its corners are edited) does not show the chip, the handles, or the length.
5. **Every finish shows its area** on the picture and in the list, and the selected one shows it again in the copper box. One selection in both places.
6. **A click on a shared patch cycles, as on a wall.** The first click selects the top finish. The next click on that same patch selects the one underneath, then the next, then back to the top. The list still jumps straight to the finish on that row.

## Copy from the wall, do not rebuild

These work on a wall face. The mock leaves them named, because a second implementation in the mock would only drift.

- **Scroll to zoom. Middle-drag or Alt-drag to move. Fit shows the whole floor again.** Same gesture as the wall face, on this floor only.
- **Escape leaves the finish and selects the floor. The next Escape closes the floor. Exit closes it in one press.** Same order as a wall: first the finish, then the picture.

## Open the view

`openFloorFinishes()` in `ui.js` still opens the structural floor-type palette. It should open this picture for the selected room or slab, the way `openWallFinishes()` opens the wall face.

- Ribbon **Build → Finishes → Floor finishes** keeps its command id. Change what it does, and the status line.
- No room or slab selected: say to select one. Do not start the room tool and do not open the floor-type list.
- The picture is the wall dock (`syncElevationDock` / the service-profile dock). A floor open and a wall open are the same strip. Opening one closes the other.
- The inspector for that room or slab leads with the picture, then the finish list, then one collapsed row for level and the outline. `roomFinishHtml` / `slabFinishHtml` in `finish-panel.js` currently lead with wall rules and a form. The list replaces that form while the floor is open.
- Add a finish uses the copper row on the strip (`syncFaceEditor` is the wall’s version). Cover whole floor is today’s whole-region on a slab, and the same for a room. Draw area is today’s `startRegion`, on the picture rather than on the plan.
- The first time the strip opens, show the mock’s note (cover the floor, click corners, Line and Corner) with Don’t show again. After that, a small control can bring it back. Same pattern as the wall’s first-open note.

## Acceptance

1. Floor finishes on a selected kitchen opens this picture. The plan is a short marker of that kitchen. Dragging the bar gives the plan more room and the picture keeps the rest. Floors still opens floor types.
2. The copper row stays one height when you change selection or press Add a finish. Cover whole floor and Draw area are on that row. The drawing does not jump.
3. Tile shows  handles and an edge length. Screed that follows the outline does not. Line and Corner match the wall chip.
4. Screed under the tile reads “2 finishes”. Vinyl on that tile reads “3 finishes”. The line under the picture explains it and does not move the drawing.
5. Scroll zooms, drag moves, Fit returns to the whole floor. Escape selects the floor, and the next Escape closes it. Exit closes immediately.
6. Areas on the picture, in the list, and on the selected row agree. Clicking the vinyl where it sits on the tile selects vinyl, then tile, then screed, then vinyl again. Wall rules are not on this view.
7. Existing wall-elevation tests still pass. Add a test that Floor finishes opens the floor picture and does not open the floor-type palette.

## Verify in the browser

With a job that has a room and a finish region:

- Floor finishes opens the picture. The plan marks that floor. Exit returns to the plan.
- Add a finish, choose Draw area, and place a corner on the picture. Cover whole floor fills the outline.
- Select the tile: handles, an edge length, Line and Corner. Select the screed that follows the outline: none of those.
- Scroll, drag, Fit. Escape once, then Escape again. Exit from the open picture.
- Confirm a wall elevation still opens in the same dock, and Document → Views → Elevation is unchanged.
