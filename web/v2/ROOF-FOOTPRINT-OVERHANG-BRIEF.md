# Brief: draw a roof along the walls, with the overhang shown as you draw

The customer does not want Revit's list of roof tools. He wants one: Revit's Roof by Footprint. You click the anchor points along the walls, and the roof edge is drawn an overhang outside them while you draw. Pitch and form are chosen as now. Later you can change the overhang and the edge follows.

Revit does this with an Overhang value on the options bar. The line you draw (or the wall you pick) is the bearing line. The roof edge is that line pushed out by the overhang. The roof's plate height is measured at the wall ("Truss": the outside face of the wall), not at the eave. So a bigger overhang drops the eave, and the walls stay the height they are. This brief does the same.

## Goal

A roof is drawn by its anchor points on the outside face of the walls. It stores those points and an overhang. The roof edge is worked out from them, shown live while drawing, and rebuilt whenever the overhang or an anchor changes. In 3D the roof meets the wall at plate height and the eave sits lower by the overhang times the slope.

## Do not change

- Form, pitch, ridge, status, and cuts. A roof is still one outline with one form.
- Plan area and the schedule. Both use the roof edge, overhang included, through `roofPlanAreas`.
- Roofs that are already drawn. A roof with no `base` behaves exactly as today: its outline is the edge, its overhang is 0, and its 3D is unchanged.
- The Sketch mode. It still draws the roof edge itself, with no overhang.
- The 3D roof is still built on the bounding rectangle (`roofRectFromForm`). Polygon hips and valleys, per-edge slope, and per-edge overhang are a later job.

## Data

Each roof gains:

- `base`: the anchor outline, a polygon shape on the outside face of the walls. Missing on old roofs.
- `overhang`: millimetres, default from the pack (600 when the pack has none). Ignored when there is no `base`.
- `offset`: the plate height from `ROOF-SECTIONS-BRIEF.md`, millimetres above the level, default 0. Build it here if that brief has not landed.

When `base` is present, `shape` is derived: `base` pushed out by `overhang`. It is never edited directly. Add `offsetPolygonOutward(poly, distance)` to `geom.js`, beside `offsetPolygonInward`, with the same rules. Normalise the winding first so click order does not matter. Return null when the offset folds (a deep notch with a large overhang). Never return a silently wrong outline.

Copy, move, rotate, and mirror carry `base`, `overhang`, and `offset`, and move `base` with the roof.

## Drawing

The roof ribbon gets an **Overhang** box in millimetres, next to form and pitch. It keeps its value between roofs.

A new placement mode, **Along walls**, becomes the default for roofs:

- Each click is an anchor. Clicks snap to the outside corners and outside faces of walls first, then the usual snaps.
- The canvas shows the anchor line thin and the roof edge, at the overhang, solid. The edge follows the cursor before each click.
- Enter, or a click on the first anchor, closes it. Fewer than three anchors is refused with the same message as other outlines.
- When the overhang folds the outline, the edge preview turns to the warn colour and commit is refused: "That overhang is too big for this corner."

**Click inside the external walls** (the footprint mode) uses the same overhang. It needs the outside face of the external walls. `footprintFace` returns the inside face. Add `footprintOuterFace` in `room-bound.js` and use it here and for Follow external walls on a roof. Floors keep using the inside face.

**Click a room** does not change.

## Editing

The roof inspector shows Overhang and Plate height, in millimetres, whenever a roof is selected.

- Changing the overhang rebuilds the edge from `base`. A fold is refused and the old value kept.
- On a roof with a `base`, corner and edge drags move the anchors, not the edge. The edge follows. The anchor line is drawn thin while the roof is selected.
- A roof that follows the external walls rebuilds `base` from `footprintOuterFace` wherever linked outlines are refreshed today.
- Stop following keeps `base` and `overhang`.
- On an old roof (no `base`), Overhang is shown as 0. Setting it takes the current outline as `base`, then pushes it out. That is the one way an old roof gains an overhang.

## Heights in 3D

Compile passes the plate height, not the eave, as the roof's reference:

- Plate is the level elevation as now (wall height when the level sits at zero), plus `offset`.
- A pitched roof's eave, at the edge, is plate minus overhang × tan(pitch). A flat roof sits at the plate.
- `pushRoofShell` keeps building from the eave at the edge, so only the number passed in changes.
- Walls whose top is at the plate meet the roof at their outside face and keep their height. `conformWallsToRoofs` still runs them up into a gable. It must not stretch a wall because of the overhang.
- `plateCallouts` reports the plate, not the eave.

## Acceptance

1. A 10 × 8 m box of walls. Along walls, 600 mm overhang: click the four outside corners. The preview shows the edge 600 mm out. The committed roof has `base` on the corners and an edge of 11.2 × 9.2 m. Plan area is the edge area.
2. The same box, click inside the external walls with 600 mm: the same `base` and edge as test 1.
3. Change the overhang to 900 mm in the inspector. The edge grows. `base` is unchanged. Undo puts back 600.
4. A 30° gable on that box, plate 0, level 0, wall height 2.8 m. The roof at the outside wall face is at 2.8 m. The eave is 2.8 − 0.6 × tan 30° ≈ 2.454 m. The long walls stay 2.8 m. The gable walls run up to the ridge.
5. At 900 mm overhang the eave drops to ≈ 2.280 m and wall heights do not change.
6. Plate height 150 mm raises both the meeting line and the eave by 150 mm.
7. Dragging an anchor corner moves the edge with it. The edge cannot be dragged on its own.
8. An overhang that folds a notched outline is refused while drawing and in the inspector.
9. A roof saved before this change opens with the same outline, the same 3D, and the same area. Its inspector shows overhang 0.
10. Copy and mirror keep `base`, `overhang`, and `offset`.
11. Tests cover `offsetPolygonOutward` (box, L-shape, fold refused, winding), the derived edge, the eave height, wall heights unchanged, and the old-roof case. Existing roof and massing tests still pass.

## Verify in the browser

On a job with a closed box of walls:

- Roof, Along walls, overhang 600. Click the outside corners and watch the edge run 600 mm out as you go. Press Enter.
- Open 3D. The eave sits below the wall top. The walls have not grown.
- Set the overhang to 900. The edge grows in plan. The eave drops in 3D. Walls unchanged.
- Drag one anchor corner out by a metre. The edge follows.
- Draw an L of walls and put a hip on it. It still draws as the bounding rectangle in 3D. That is the later job, not this one.
