# BOS review tracker

Source: Floris Slabbert, 1 November 2026, “Drawing tools and BOQ integration”
(`BOS-System-Review-TPS-Memo.docx`).

Bill drop, received after that memo and read on 3 November 2026:

- `From Floris/BOS_QS_Bill_Framework.xlsx` is the ASAQS 2015 model. 27 trades, 4,020 items, trade order checked back to the source.
- `From Floris/t038BOS_QS_Bill_Framework.xlsx` is the G020 Gijzen House tender. 278 lines. Its own 24-trade numbering is marked as recalled; the master file replaces it.
- `From Floris/Quantity Surveying MasteryStudy Guide.docx` restates the same bill shape (preliminaries, trades, provisional sums, summary, VAT, form of tender). It adds no drawing task. Valuations, retention, and penalties in that guide are JBCC administration, not a task here.

Nothing in that drop is built yet. It settles the tile split in BOS-33 and the bill tasks in Wave 5.

This file is the list to work from. One id is one task. Work top to bottom through the five waves. Finish a wave before starting the next. Inside a wave, take the next **to do** row. A row that names an **After** id waits until that id is **done**.

## How to send an agent

Point the agent at the first **to do** id in the earliest unfinished wave. Example:

> Do BOS-16 in `BOS-REVIEW-TRACKER.md`. Change only what that task names. When the acceptance lines are true, set its status to **done** in the summary and on the task, and leave the other rows alone.

Do not assign an id marked **blocked**. The unblock line says what has to arrive first, and which wave it joins.

When a task starts, set its status to **in progress**. When acceptance is met, set it to **done**.

## Status

| Status | Meaning |
|---|---|
| **done** | Already in the product, or finished against this memo. |
| **to do** | Safe to assign. The task below is enough to start. |
| **in progress** | An agent is on it. |
| **blocked** | Do not build yet. |

Difficulty is 1 (local change) to 5 (new product area).

## Summary

Counts: **19 done**, **9 to do**, **0 in progress**, **6 blocked**.

### Wave 1 — Defaults lost on every placement

Do these before any later wave. BOS-17 waits for BOS-16. BOS-01 and BOS-02 are the same drawing-defaults fix and go together.

| Id | Area | Call | Diff. | Status |
|---|---|---|---|---|
| BOS-16 | Doors | Bug. Door type dropped after each placement | 1 | done |
| BOS-01 | Walls | Bug. Thickness falls back to 110 mm | 2 | done |
| BOS-02 | Walls | Bug. Location line does not survive leaving the tool | 2 | done |
| BOS-17 | Doors | Feature. Recently used doors | 2 | done |
| BOS-25 | Finishes | Bug. Paint does not show its bill item | 2 | done |
| BOS-06 | Walls | Feature. New walls red, existing walls white | 2 | done |
| BOS-09 | Walls | Feature. See PDF openings; toggle sheet and model | 2 | done |
| BOS-24 | Finishes | Feature. Guideline down from the top of the wall | 2 | done |

### Wave 2 — Accuracy

Wave 2 is done. BOS-03 settled the drawn width, BOS-08 the stored direction, and BOS-15 the shared corner.

| Id | Area | Call | Diff. | Status |
|---|---|---|---|---|
| BOS-03 | Walls | Bug. 220 mm wall measures about 240 mm | 3 | done |
| BOS-08 | Walls | Bug. Wall sits slightly off the intended line | 3 | done |
| BOS-15 | Floors | Bug. Floor levels do not line up | 3 | done |

### Wave 3 — Editing tools

Wave 3 is done. BOS-20 keeps a plug on its wall and a floor point inside its floor.

Start only after Wave 2 is done. BOS-10 and BOS-07 wait on BOS-08.

| Id | Area | Call | Diff. | Status |
|---|---|---|---|---|
| BOS-10 | Walls | Feature. Correct the face of an existing wall | 3 | done |
| BOS-07 | Walls | Feature. Snap and split on a selected wall | 3 | done |
| BOS-12 | Floors | Feature. Move one floor edge | 3 | done |
| BOS-14 | Floors | Feature. One Move control | 3 | done |
| BOS-20 | Electrical | Feature. Socket stays on its surface | 3 | done |

### Wave 4 — Model and client document

Start only after Wave 3 is done. BOS-19 is last in this wave so the boards do not swallow the queue. BOS-32 follows BOS-31. BOS-34, when it unblocks, follows BOS-33. The G020 bill now specifies the tile split BOS-33 writes. Wave 5 starts when this wave is done.

| Id | Area | Call | Diff. | Status |
|---|---|---|---|---|
| BOS-11 | Floors | Feature. Floor follows external walls | 4 | done |
| BOS-22 | Columns | Feature. Live column dimensions | 4 | to do |
| BOS-31 | Client document | Feature. Costing names the finish in each place | 3 | to do |
| BOS-32 | Client document | Feature. Internal elevations in the client document | 4 | to do |
| BOS-33 | Client document | Feature. Installation price separate from tile supply | 4 | to do |
| BOS-19 | Electrical | Feature. Boards, circuits, breakers | 5 | to do |

### Wave 5 — Bill from the model

Start only after Wave 4 is done. The structure is settled; do not invent a different one. BOS-05 and BOS-23 wait for BOS-29. BOS-30 waits for BOS-29 and BOS-33. BOS-23 also waits for BOS-22.

| Id | Area | Call | Diff. | Status |
|---|---|---|---|---|
| BOS-29 | Bill | Feature. Write the bill from the model in the ASAQS order | 4 | to do |
| BOS-05 | Walls | Feature. One bill line per wall specification | 4 | to do |
| BOS-30 | Finishes | Feature. Tile quantities roll up and stay traceable | 3 | to do |
| BOS-23 | Columns | Feature. Count steel columns by section and length | 4 | to do |

### Waiting

These stay **blocked**. When the unblock line is true, set the status to **to do** and do the id at the end of the wave named here.

| Id | Joins | Call | Diff. | Status |
|---|---|---|---|---|
| BOS-18 | Wave 1 | Apply Floris’s line colours | 1 | blocked |
| BOS-04 | After Wave 2 | Duplicate a wall type and edit thickness | 4 | blocked |
| BOS-34 | After BOS-33 | Sales wording for the two-part tile price | 1 | blocked |
| BOS-21 | After BOS-19 | Automatic cable route to a board | 5 | blocked |
| BOS-26 | After Wave 5 | Import an architect’s bill | 5 | blocked |
| BOS-28 | After Wave 5 | Measure in BOS Admin | 3 | blocked |

### Done

| Id | Area | Call | Diff. | Status |
|---|---|---|---|---|
| BOS-13 | Floors | Undo | 1 | done |
| BOS-27 | Bill | Redraw, then price | 1 | done |

---

---

## Wave 1 — Defaults lost on every placement

Do these before any later wave. BOS-01 and BOS-02 go in one pass. BOS-17 starts only after BOS-16.

### BOS-16 — Keep the door type

- **Status:** done
- **Kind:** bug. **Difficulty:** 1
- **Prompt:** Do BOS-16 in `BOS-REVIEW-TRACKER.md`.

`placeOpening` in `web/v2/ui.js` sets the tool back to Select after one door. The next door requires the library again.

**Done when**

- After a door is placed, the same door type stays armed.
- The user can place several without reopening the library.
- Choosing another type, or leaving the tool, stops that repeat.

**Look in:** `web/v2/ui.js` (`placeOpening`).

**Do not:** build the Recently used row here. That is BOS-17.

### BOS-01 — Keep the wall thickness

- **Status:** done
- **Kind:** bug. **Difficulty:** 2
- **Prompt:** Do BOS-01 in `BOS-REVIEW-TRACKER.md`.

Re-arming Walls sets the type to the first wall in the pack. In `web/samples/tsp-pack.json` that is the 110 mm wall, so a 220 mm choice is lost. `onRibbonFunction` in `web/v2/ui.js` assigns `placeSkuId` from the first matching SKU.

**Done when**

- Choosing 220 mm, leaving the wall tool, and starting Walls again still draws 220 mm.
- The same holds for any other wall type the user picked.
- A deliberate pick of 110 mm still draws 110 mm.

**Look in:** `web/v2/ui.js` (`onRibbonFunction`, `placeSkuId`), `web/v2/ribbon.js` (Walls command).

**Do not:** change the pack order, or invent a new default type.

### BOS-02 — Keep the location line

- **Status:** done
- **Kind:** bug. **Difficulty:** 2
- **Prompt:** Do BOS-02 in `BOS-REVIEW-TRACKER.md`.

Centreline, exterior face, and interior face are remembered only while the wall tool stays armed (`wallLocation` in `web/v2/ui.js`). Leaving the tool and coming back presents centreline again. Changing type must not clear the choice either.

**Done when**

- Exterior or interior, once chosen, is still the active line after the tool is left and Walls is started again.
- Changing from 110 mm to 220 mm, or the reverse, leaves that line selected.
- The control on screen matches the line the next wall will use.

**Look in:** `web/v2/ui.js` (`wallLocation`, wall-loc buttons), `web/v2/click-draw.js`.

**Do not:** change how a face-drawn wall is stored. The segment stays a centreline, with `location` recorded on it.

### BOS-17 — Recently used doors

- **Status:** done
- **Kind:** feature. **Difficulty:** 2
- **Prompt:** Do BOS-17 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-16.

Depends on BOS-16 being done, so the tool no longer disarms after one door.

**Done when**

- The door library has a Recently used row at the bottom.
- A type placed in this session can be picked again from that row.
- The row does not replace the full library.

**Look in:** `web/v2/ui.js` (palette, `renderPalette`), `web/v2/library.js`.

**Do not:** persist the row across jobs unless it falls out of the session with no extra storage.

### BOS-25 — Paint shows its bill item

- **Status:** done
- **Kind:** bug. **Difficulty:** 2
- **Prompt:** Do BOS-25 in `BOS-REVIEW-TRACKER.md`.

Choosing paint does not show the bill item that paint will price as. Finish rows already carry `rateRef`, and a finish with no product is labelled as an allowance (`web/v2/finish-model.js`, `web/v2/finish-data.js`).

**Done when**

- Selecting paint shows which bill item it belongs to.
- That same item is identifiable on the drawing and in the compiled bill.
- An allowance stays labelled as an allowance when no product is chosen.

**Look in:** `web/v2/finish-panel.js`, `web/v2/finish-model.js`, `web/v2/compile.js`, `web/v2/schedule.js`.

**Do not:** invent a rate. If the pack has no rate reference, show that gap.

### BOS-06 — New walls red, existing walls white

- **Status:** done
- **Kind:** feature. **Difficulty:** 2
- **Prompt:** Do BOS-06 in `BOS-REVIEW-TRACKER.md`.

Planned walls draw in copper (`#b2451e`) and existing walls in grey (`#8a8074`), from `statusStroke` in `web/v2/ui.js`. Floris wants new work red and existing work white.

**Done when**

- A wall placed as new work reads red on the plan.
- A wall marked existing reads white, and stays visible on the plan background.
- Other families are unchanged by that pair of colours.

**Look in:** `web/v2/ui.js` (`COLOUR`, `statusStroke`, `drawWall`).

**Do not:** add a free colour per family. Colour in the pack is a material class (`SCHEMA.md`). That larger request stays out of this task.

### BOS-09 — PDF openings visible while a wall is selected

- **Status:** done
- **Kind:** feature. **Difficulty:** 2
- **Prompt:** Do BOS-09 in `BOS-REVIEW-TRACKER.md`.

After the walls are drawn, garage doors, doors, and windows on the PDF need to stay visible when a wall is selected. A toggle between the PDF and the model is the extra check.

**Done when**

- Selecting a wall does not hide the underlay openings the user is trying to match.
- One control switches between the sheet and the modelled walls.

**Look in:** `web/v2/underlay.js`, `web/v2/ui.js` (underlay opacity and draw order), `web/v2/ribbon.js` (Sheet group).

**Do not:** remove the existing opacity control, or change scale and alignment (that is BOS-15).

### BOS-24 — Finish guideline from the top of the wall

- **Status:** done
- **Kind:** feature. **Difficulty:** 2
- **Prompt:** Do BOS-24 in `BOS-REVIEW-TRACKER.md`.

Wall finishes are drawn on the elevation. There is no construction line at a typed distance down from the top of the wall.

**Done when**

- The user can enter an offset measured down from the top of the wall.
- A guideline appears at that height on the elevation.
- A finish boundary can be drawn against that line.

**Look in:** `web/v2/wall-elevation.js`, `web/v2/finish-panel.js`, `web/v2/ui.js` (elevation dock).

**Do not:** change finish quantities or the bill mapping. `WALL-FINISH-UX-BRIEF.md` keeps that model as it is.

---

## Wave 2 — Accuracy

Do these before Wave 3. BOS-03 settled the drawn width and BOS-08 the stored direction. A floor that follows walls still sits on the sheet alignment.

### BOS-03 — 220 mm described, about 240 mm measured

- **Status:** done
- **Kind:** bug. **Difficulty:** 3
- **Prompt:** Do BOS-03 in `BOS-REVIEW-TRACKER.md`.

A wall named 220 mm measured about 240 mm. The live pack is `web/samples/tsp-pack.json`. “Masonary wall 220mm (plaster)” stores overall `geometry.thickness` 240, and the 110 mm plastered wall stores 130. `drawnWallThickness` draws that overall width. The 20 mm was folded into the masonry thickness. `planner-pack-v2.json` stores 220 with no extra millimetres; that file was the wrong place to read this from.

**Fixed**

- The three plastered masonry walls state `coreThickness` (110 or 220). Overall thickness is unchanged, so the stroke, the location line, and a face-to-face measure stay on 240 mm and 130 mm.
- The type label reads `220 mm masonry + plaster (240 mm overall)`, and the same form for the 110 mm wall.
- The 220 mm no-plaster foundation stays 240 mm, and its label does not call the extra plaster.
- Plaster on the bill stays the computed coat. Paint does not thicken the wall. Masonry volume stays on the overall width.

**Done when**

- The cause of the 20 mm gap is identified from the description, the stroke, and the measure the user would take (dimension, PDF, or on-screen width).
- Description, drawn width, and measured quantity use one width: the overall width, with the core and the plaster named beside it.
- The extra 20 mm on a plastered type is stated as plaster, not folded silently into the masonry thickness.

### BOS-08 — Wall sits off the intended line

- **Status:** done
- **Kind:** bug. **Difficulty:** 3
- **Prompt:** Do BOS-08 in `BOS-REVIEW-TRACKER.md`.

A wall can land slightly off the angle or alignment the user aimed at. A small error breaks dimensions and junctions.

**Fixed**

- While a wall is being drawn, the direction is chosen before the length. A run within the snap tolerance of an axis is stored on that axis. A run within that tolerance of an existing wall, with the start on that wall, is stored on that wall’s direction. Any other aim keeps its ray; only the length snaps to a round millimetre.
- Typing a length or a heading no longer rounds X and Y separately, which was tilting a wall whose start was off the grid.

**Done when**

- A wall drawn on an axis, or onto an existing wall or grid line, stores that direction.
- The miss Floris described is reproduced, then gone, with a test that fails on the old behaviour.

**Look in:** `web/v2/snap.js`, `web/v2/click-draw.js`, `web/v2/ui.js` (wall commit), `web/v2/tests/snap.test.js`.

**Do not:** loosen snap so the wall “usually” looks right. The stored line has to be the line that was intended.

### BOS-15 — Line up two floor levels

- **Status:** done
- **Kind:** bug. **Difficulty:** 3
- **Prompt:** Do BOS-15 in `BOS-REVIEW-TRACKER.md`.

Both drawings can be scaled to the same dimensions while the walls on those levels still do not coincide. Align sheets (`align-floors` in `web/v2/ribbon.js`) moves underlays onto the sheet that stays put. Walls already drawn stay in model coordinates.

**Done when**

- The user can pick the same reference point on each level, such as a building corner, and the sheets and the walls drawn from them share that point.
- Two levels scaled to the same known dimension land on the same model size.

**Look in:** `web/v2/underlay.js`, `web/v2/sheet-set.js`, `web/v2/ui.js` (align command), `web/v2/tests/underlay.test.js`.

**Do not:** move a wall by silently changing its stored length. Alignment moves position, not size, except where the user is scaling.

---

## Wave 3 — Editing tools

Start only after Wave 2 is done.

### BOS-10 — Correct the face of a wall already drawn

- **Status:** done
- **Kind:** feature. **Difficulty:** 3
- **Prompt:** Do BOS-10 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-08.

The face (centreline, exterior, interior) is chosen while drawing and stored on the segment. `rethickenAboutLocation` in `web/v2/click-draw.js` keeps that face when the thickness changes. There is no control that moves an existing wall onto a different face.

**Done when**

- A selected wall can be switched to centreline, inner face, or outer face.
- The wall shifts so the chosen line stays where the old location line was.
- Joins at both ends stay closed.
- Centreline is available, including for a wall drawn on a grid.

**Look in:** `web/v2/click-draw.js`, `web/v2/modify.js`, `web/v2/ui.js` (inspector).

**Do not:** change the rule that the stored segment is the centreline.

### BOS-07 — Snap and split on a selected wall

- **Status:** done
- **Kind:** feature. **Difficulty:** 3
- **Prompt:** Do BOS-07 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-08.

Snap is available while a wall is being drawn. A selected wall has no snap control, and a wall cannot be split into two segments.

**Fixed**

- One selected wall shows Snap and Split just off the wall. Snap uses the same magnets as drawing a wall: click an end, then the point it should meet. Split takes a click on the wall.
- The head keeps its id. An opening stays on the piece that holds its centre. A finish stays on the piece it covered, a finish that crosses the cut is divided, and a whole-face finish covers both pieces.
- Modify → Cut still cuts at the midpoint.

**Done when**

- With a wall selected, a control offers snap for an accurate edit.
- The user can split that wall into two segments at a chosen point.
- Openings and finishes stay on the piece they belonged to.

**Look in:** `web/v2/snap.js`, `web/v2/ui.js` (selection, wall draft), `web/v2/walls.js`, `web/v2/finish-model.js`.

**Do not:** add a second snap system. Use the snap the drawing tool already uses.

### BOS-12 — Move one floor edge

- **Status:** done
- **Kind:** feature. **Difficulty:** 3
- **Prompt:** Do BOS-12 in `BOS-REVIEW-TRACKER.md`.

Corner handles exist. The user also needs to select one boundary line of a floor and move that line, without rebuilding the outline.

**Fixed**

- With one floor selected, and not a finish, Line selects one boundary edge. Dragging it moves both ends of that edge together. The other corners stay.
- The line drawn on the plan is that edge, including after a click that does not drag yet.
- Corner still drags one corner, and Corner still adds a point on an edge.
- A finish edge is still stopped on the floor. The floor outline is not.

**Done when**

- One edge of a floor boundary can be selected and moved.
- The other edges stay put.
- Corner editing still works.

**Look in:** `web/v2/ui.js` (shape editing, `moveEdge`), `web/v2/geom.js`.

**Do not:** build this only on the floor-finish picture. Floris is editing the floor outline.

### BOS-14 — Move a PDF, a wall, or a tiled area

- **Status:** done
- **Kind:** feature. **Difficulty:** 3
- **Prompt:** Do BOS-14 in `BOS-REVIEW-TRACKER.md`.

There is no single Move command. A sheet can be dragged (`underlay-adjust` in `web/v2/ribbon.js`, `moveUnderlayTo` in `web/v2/underlay.js`). A wall end can be pulled. A tiled region is edited through its corners.

**Fixed**

- Modify → Move is the one command. It takes one selected wall, the selected sheet, or the tiled area being edited.
- The first click is the point to move from. The next click is where that point lands, using the same snap as drawing. A typed distance sets the length along that aim. Enter places it. Esc cancels.
- The move is one undo step. A tiled area stops on the floor. A pinned sheet is refused.

**Done when**

- One Move command repositions a selected PDF, a selected wall, or a selected tiled area.
- The move can be placed accurately (snap or a typed distance).
- The move is undoable.

**Look in:** `web/v2/ribbon.js`, `web/v2/underlay.js`, `web/v2/ui.js`, `web/v2/finish-model.js`.

**Do not:** add three different move gestures that the user has to discover separately.

### BOS-20 — Socket stays on a wall or a floor

- **Status:** done
- **Kind:** feature. **Difficulty:** 3
- **Prompt:** Do BOS-20 in `BOS-REVIEW-TRACKER.md`.

A placed item is a free point (`placeItem` in `web/v2/ui.js`). A wall socket can sit off the wall. A floor socket can sit off the floor.

**Fixed**

- A plug (single, double, shaver) stores the wall and the face it was clicked on, and follows that wall when the wall is moved, split, or realigned. Dragging the plug slides it along that wall.
- A floor light, a recessed floor light, and an underfloor heating point store the floor, move with that floor, and are pulled back inside if an edge edit would leave them outside.
- A click with no wall, or no floor, places nothing. Ceiling plugs, slab plugs, switches, and every other fitting stay free points.

**Done when**

- A wall socket attaches to the selected wall and moves with that wall.
- A floor socket stays inside the selected floor and moves with that floor.
- A socket with no surface is refused, not left floating.

**Look in:** `web/v2/ui.js` (`placeItem`), `web/v2/placement-warn.js`, `web/v2/service-model.js`.

**Do not:** route a cable. That is BOS-21.

---

## Wave 4 — Model and client document

Start only after Wave 3 is done. BOS-19 is last. The G020 bill specifies the tile split in BOS-33. Wave 5 starts when this wave is done.

### BOS-11 — Floor follows the external walls

- **Status:** done
- **Kind:** feature. **Difficulty:** 4
- **Prompt:** Do BOS-11 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-03, BOS-08, and BOS-15.

A floor should be made by picking a room or by sketching a boundary. A ground-floor slab across the footprint should stay linked to the external walls, so moving a linked wall updates the floor. The same link should be available for an upper slab or a roof. A large layout change, such as a new wall, must still allow the boundary to be edited by hand.

A room can already take its outline from the walls around a seed (`web/v2/room-bound.js`, `bound` and `seed`). A slab and a roof are rectangles (`commitSlab`, `commitRoof` in `web/v2/ui.js`) and are not tied to walls.

**Done when**

- The user can create a floor from a room, or from a sketched outline.
- A linked floor updates when a linked external wall moves.
- The link can be dropped, and the boundary edited by hand, without rebuilding the floor.
- An upper slab and a roof can use the same link when the user asks for it.

**Look in:** `web/v2/room-bound.js`, `web/v2/ui.js` (slab and roof commit), `web/v2/geom.js`.

**Do not:** make every floor follow walls with no way to detach it.

### BOS-22 — Column size typed and shown live

- **Status:** to do
- **Kind:** feature. **Difficulty:** 4
- **Prompt:** Do BOS-22 in `BOS-REVIEW-TRACKER.md`.

Columns exist as fixed catalog sizes, drawn with the beam tool (`category: "column"`, `draw: "beam"` in `web/samples/tsp-pack.json`). Example: 450 × 450 mm and 450 × 600 mm. The user cannot type a width and see the drawing update.

The G020 bill counts a steel column by its section and its length (150 × 150 × 8 mm and 150 × 150 × 6 mm square hollow sections, each with its own length). A concrete column is still width and depth, or a diameter. This task stores those fields. BOS-23 writes the bill line.

**Done when**

- The user can place a round column and a square column.
- Width, depth, or diameter is typed in a field and the plan updates immediately.
- A steel column also stores its wall thickness, separate from the outer size.
- Selecting a placed column shows those dimensions and accepts a change.

**Look in:** `web/v2/ui.js` (beam and column placement, inspector), `web/v2/schema.js`, `web/samples/tsp-pack.json`.

**Do not:** describe them on the bill in this task. That is BOS-23. Do not treat a column as a wall. Do not add an I-section. The November drop has no I-section list.

### BOS-31 — Client costing names each finish

- **Status:** to do
- **Kind:** feature. **Difficulty:** 3
- **Prompt:** Do BOS-31 in `BOS-REVIEW-TRACKER.md`.

The model can hold two finishes on one wall (a band and the remaining wall). The client document does not state, for each place, which finish, how far it extends, and what it costs. Floris’s example: 750 mm of mosaic above the kitchen cupboards, porcelain on the remaining scullery walls.

G020 line 17.001 measures bathroom wall tiling as wall-face area times a tiling height per room. That height has to be on the finish before a later bill line can use it. This task puts the height, the product, and the cost in the client document. Rolling those lines up is BOS-30.

**Done when**

- The client document lists each finish by place.
- Extent and specification are stated (height of a band, product or allowance, area).
- Two finishes on one wall appear as two costs.
- A tiled wall records the height the tiling covers, measured on that wall.

**Look in:** `web/v2/finish-model.js`, `web/v2/schedule.js`, `web/v2/compile.js`.

**Do not:** merge those two finishes into one tile line. That roll-up is BOS-30. Do not write the supply allowance here. That is BOS-33.

### BOS-32 — Internal elevations in the client document

- **Status:** to do
- **Kind:** feature. **Difficulty:** 4
- **Prompt:** Do BOS-32 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-31.

The wall elevation used while editing (`web/v2/wall-elevation.js`) is not a page of the client document, and it is not referenced to a wall the client can find on the model.

**Done when**

- The client document can include an internal elevation of a tiled wall.
- The elevation shows where each finish starts and stops.
- Each elevation names the wall it comes from.

**Look in:** `web/v2/wall-elevation.js`, `web/v2/sheets.js`, `web/v2/elevation.js`.

**Do not:** replace the building compass elevation (`elevation.js`, Document → Views → Elevation). That is a different view. Do not change the elevation maths.

### BOS-33 — Installation price separate from tile supply

- **Status:** to do
- **Kind:** feature. **Difficulty:** 4
- **Prompt:** Do BOS-33 in `BOS-REVIEW-TRACKER.md`.

Tiling is two prices. The G020 bill already splits them, and this task follows that split.

Installation is the tiling trade. The description includes fixing, adhesive, and grout, and it says the tiles themselves are a prime-cost sum elsewhere. G020 keeps separate installation lines for bathroom walls, interior floors, exterior floors, shower floors, and 100 mm cut-tile skirtings. Pool mosaic is the same pattern. Edge trims and movement joints are manual lines, not part of this split.

Supply is a prime-cost line per tile type, not folded into installation. On G020 those lines are porcelain floors at R350/m², shower floors at R350/m², bathroom wall porcelain at R600/m², pool mosaic at R800/m², and carpet tiles at R450/m². The rates are examples from that tender. An unchosen product stays a PC allowance (`PC_ALLOWANCE_LABEL` in `web/v2/finish-model.js`). The quantity on the supply line names the area it covers.

**Done when**

- The client document shows an installation total and, separately, a supply allowance per tile type.
- Installation describes fixing, adhesive, and grout, and does not contain the tile price.
- Each allowance names the area or finish it covers, and a low supply allowance cannot sit inside the installation total.
- Bathroom walls, floors, shower floors, and skirtings can be separate installation lines when their specification differs.

**Look in:** `web/v2/finish-model.js`, `web/v2/finish-data.js`, `web/v2/schedule.js`, `web/v2/compile.js`. G020 lines 17.001 to 17.005 and 17.008, and prime-cost lines 24.007, 24.008, 24.009, 24.014, and 24.019 in `From Floris/t038BOS_QS_Bill_Framework.xlsx`.

**Do not:** write the sales paragraph here. That is BOS-34, and it waits until this split exists. Do not invent rates. Use the pack rate, or show the allowance with no rate.

### BOS-19 — Distribution boards and circuits

- **Status:** to do
- **Kind:** feature. **Difficulty:** 5
- **Prompt:** Do BOS-19 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-11, BOS-22, BOS-31, BOS-32, and BOS-33.

Electrical is one service system, drawn as a network (`electrical` in `web/v2/service-model.js`). There is no distribution board, no breaker, and no circuit.

**Done when**

- The user can place more than one distribution board, including boards on different floors.
- A circuit belongs to one breaker on one board.
- Lights and other points can be associated with a circuit.
- The first electrical point can prompt for a board, and a board placed later can be linked.
- Load limits are not included.

**Look in:** `web/v2/service-model.js`, `web/v2/services.js`, `web/v2/service-panel.js`, `web/v2/SCHEMA.md`.

**Do not:** generate cable routes. That is BOS-21 and it is blocked. Do not add load-limit rules. The G020 bill marks the whole electrical trade as manual, not drawn, so this task places boards and circuits and does not measure cable.

---

## Wave 5 — Bill from the model

Start only after Wave 4 is done. BOS-05 and BOS-23 start after BOS-29. BOS-30 starts after BOS-29 and BOS-33. BOS-23 also starts after BOS-22.

Settled by the November workbooks, and binding on every task in this wave:

- Trade order is the 27 ASAQS trades in `From Floris/BOS_QS_Bill_Framework.xlsx`. The 24-trade numbering in the G020 file is not the order.
- A line has a ref, trade, heading, description, item, unit, DAVE measure (m, m², m³, No, tonne, or a lump sum), CAD source, and a status: drawn, derived, manual, or prime cost.
- Net cost per unit is material + plant + labour. Selling rate is net divided by (1 − margin). The default margin is 15 percent of the selling price. VAT is 15 percent. A line may override the margin. Both materials libraries arrived with no prices, so an empty rate stays empty.
- A job may split quantities by section, as G020 does (Guest Suite, Gazebo, Gym, Pool and Boma, General, site prep, preliminaries). The same specification keeps one description and separate section quantities.
- Of the 278 G020 lines, 67 are drawn and 97 are derived. Those are the lines the model feeds. The 77 manual lines and 37 prime-cost lines stay a QS entry.
- Opening-deduction thresholds, laps, and waste factors are still unset. Do not invent them. Deduct openings where the recipe already says “openings deducted”, and leave waste blank.

### BOS-29 — Write the bill in the ASAQS order

- **Status:** to do
- **Kind:** feature. **Difficulty:** 4
- **Prompt:** Do BOS-29 in `BOS-REVIEW-TRACKER.md`.
- **After:** Wave 4.

The memo asked for his Excel bill as the structure. Both workbooks are that structure. The master file is the order and the column contract. The G020 file is the worked house: which CAD element feeds which line, and how a quantity is split by section. Today `compile()` rolls instances up by SKU (`web/v2/compile.js`, `web/v2/schedule.js`) and does not write this bill.

**Done when**

- The bill is ordered in the 27 ASAQS trades from the master workbook.
- Each emitted line carries ref, heading, description, item, unit, CAD source, and drawn, derived, manual, or prime cost.
- A drawn or derived quantity comes from the model. A manual or prime-cost line is present and stays editable, and the model does not invent its quantity.
- Section quantities stay separate when the job is split, and the same specification is still one line.
- Material, plant, labour, margin, and VAT use the cost rule above. An empty rate is shown as empty.
- A line can be followed back to the element that produced it.

**Look in:** `web/v2/compile.js`, `web/v2/schedule.js`, `web/v2/SCHEMA.md`. Recipes and columns: `From Floris/BOS_QS_Bill_Framework.xlsx` (Bill Framework, CAD Recipes, Trade Order, Cost Inputs) and `From Floris/t038BOS_QS_Bill_Framework.xlsx`.

**Do not:** paste the 4,020 ASAQS model descriptions into the shipped pack. The master read-me says internal use of the structure is fine, and distributing those descriptions needs ASAQS permission. Use the G020 wording for the house recipes. Do not price the library. Do not build wall grouping, tile roll-up, or the column count here. Those are BOS-05, BOS-30, and BOS-23.

### BOS-05 — One bill line per wall specification

- **Status:** to do
- **Kind:** feature. **Difficulty:** 4
- **Prompt:** Do BOS-05 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-29.

The memo said walls that need different descriptions or rates must not be grouped, and that the approach still needed refining. The G020 masonry bill is that refinement. Half-brick (110 mm) is m². One-brick (220 mm) is m². Mass brickwork is m³. A 330 mm cavity wall is its own m² line. Brick reinforcement is a derived length, separate for 75 mm and 150 mm. Identical specification rolls up. Section columns keep each section’s quantity.

**Done when**

- 110 mm, 220 mm, mass, and cavity walls land on different bill lines when their descriptions differ.
- Two walls of the same specification and the same section add into one quantity.
- The line states the thickness and the unit the recipe uses.
- Plaster and paint stay derived from the wall faces, with openings deducted, and paint uses the plaster area. They are not folded into the masonry line.

**Look in:** `web/v2/compile.js`, `web/v2/walls.js`, `web/samples/tsp-pack.json`. G020 lines 07.001 to 07.008 and the Wall rows of CAD Recipes in `From Floris/t038BOS_QS_Bill_Framework.xlsx`.

**Do not:** author a new wall type. That is BOS-04 and it is blocked. Do not invent an opening-deduction threshold. Do not change the drawn overall thickness settled in BOS-03.

### BOS-30 — Tile quantities roll up and stay traceable

- **Status:** to do
- **Kind:** feature. **Difficulty:** 3
- **Prompt:** Do BOS-30 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-29 and BOS-33.

The memo left tile grouping to be refined. G020 groups by specification and by surface, not into one tile total. Bathroom walls, interior floors, exterior floors, shower floors, and 100 mm skirtings are separate lines. Pool mosaic is separate again. Each line names its CAD source (room wall faces times tiling height, or floor area by room and finish, or perimeter less doors). A summary quantity still traces back to the room and the surface.

**Done when**

- Those surfaces do not collapse into one tile line when the specification differs.
- The same specification in the same section does add up.
- Each quantity names the room and the surface it came from.
- The supply allowance from BOS-33 stays a prime-cost line. It is not added into the installation quantity.

**Look in:** `web/v2/finish-model.js`, `web/v2/compile.js`, `web/v2/schedule.js`. G020 lines 17.001 to 17.005 and 17.008.

**Do not:** measure edge trims or movement joints from the model. G020 marks those manual. Do not invent the tiling height. BOS-31 records it.

### BOS-23 — Count steel columns by section and length

- **Status:** to do
- **Kind:** feature. **Difficulty:** 4
- **Prompt:** Do BOS-23 in `BOS-REVIEW-TRACKER.md`.
- **After:** BOS-22 and BOS-29.

Columns are not measured like walls. On the G020 bill a steel column is a number, counted by its section and its length. The lines in that tender are 150 × 150 × 8 mm square hollow sections at 2,705 mm and 2,790 mm, and 150 × 150 × 6 mm at 1,365 mm and 3,000 mm. A base plate is an extra-over, one per column end. Paint is derived as girth times length. Purlins in that bill are tonnes from an engineer’s schedule, and they stay manual.

The drop is this house, not a general tube catalogue. There is no I-section list, and the 3 mm, 10 mm, and 12 mm thicknesses from the memo are not in the workbook. Bill the section the model stores. Do not add sections the drop does not contain.

**Done when**

- A steel column from BOS-22 becomes a count of one section and one length, in number, not in metres or cubic metres.
- Two columns of the same section and the same length add. A different length is a different line.
- A base plate is a separate extra-over, one per end.
- Paint on that column is girth times length, and it is not inside the column count.
- The bill names shape, outer size, and steel wall thickness.

**Look in:** `web/v2/compile.js`, `web/v2/schema.js` (`schedule.report`). G020 lines 14.001 to 14.006 and 21.005 to 21.006.

**Do not:** add I-sections, lipped channels, or a wall thickness the model does not store. Purlins stay manual. Do not change how a concrete column is drawn. That is BOS-22.

---

## Waiting

Do not assign these. When the unblock line is true, set the status to **to do** and do the id at the end of the wave named in the summary.

### BOS-18 — Sewer line colours

- **Status:** blocked
- **Kind:** feature. **Difficulty:** 1
- **Unblock when:** Floris sends the colour convention.
- **Already true:** drainage, cold water, hot water, electrical, and gas already use different colours in `SERVICE_SYSTEM_INFO` (`web/v2/service-model.js`). Drainage is `#796548`.
- **Done when, after the list arrives:** sewer lines use his colours. Soil, waste, and vent are separate colours only if his list says so.

### BOS-04 — Duplicate a wall type and edit its thickness

- **Status:** blocked
- **Kind:** feature. **Difficulty:** 4
- **Unblock when:** the product owner accepts user-authored wall types. `CUSTOMER-VISION.md` currently keeps type authoring out of the app. Types come from the firm pack.
- **Ask:** duplicate a 220 mm wall as a starting point for a 280 mm wall, keep it available, and identify it on the bill.
- **Already true:** the G020 recipes bill known types (110 mm, 220 mm, cavity, mass). They do not author a type. Once a type exists, BOS-05 gives it a line.
- **Look in:** `web/v2/schema.js`, `web/samples/tsp-pack.json`, `CUSTOMER-VISION.md`.

### BOS-34 — Sales wording for the tile allowances

- **Status:** blocked
- **Kind:** copy. **Difficulty:** 1
- **Unblock when:** BOS-33 is done.
- **Ask:** the client document says, in plain language, that installation and tile supply are separate so tenders can be compared, and that the supply allowance changes when the client chooses the tiles.
- **Do not:** build a new pricing engine for this paragraph.

### BOS-21 — Automatic cable route to a board

- **Status:** blocked
- **Kind:** decision. **Difficulty:** 5
- **Unblock when:** the product owner accepts automatic cable routing. `CUSTOMER-VISION.md` keeps services as placed symbols and PC sums, not routed cables. Hand-drawn electrical runs already exist. The G020 bill marks the electrical trade manual, with nothing drawn, which agrees with leaving routes out.
- **Ask:** link each plug to a board and generate the route. Several boards means the user confirms which board.
- **Depends on:** BOS-19.

### BOS-26 — Import an architect’s bill

- **Status:** blocked
- **Kind:** decision. **Difficulty:** 5
- **Unblock when:** Floris sends a bill whose item codes are the architect’s, and the product owner agrees those codes replace the ASAQS structure. The November workbooks are not that bill. They are the QS framework and the G020 tender, and BOS-29 builds from them.
- **Ask:** keep the architect’s item structure, and link measured work to those items.
- **Joins:** the end of Wave 5, after BOS-29.

### BOS-28 — Measure inside BOS Admin

- **Status:** blocked
- **Kind:** decision. **Difficulty:** 3
- **Unblock when:** someone says “BOS Admin” is a second product. The G020 read-me says BOS writes the bill from the CAD model, which is this app. If that reading is accepted, this id closes when BOS-29 is done, because the line already names its CAD source.
- **Already true here:** a sheet can be scaled (`calibrate` / underlay) and quantities compile from the model (`web/v2/compile.js`).
- **Ask, if Admin is a second product:** scale the drawing, measure, and keep a visible link from the source drawing to the measurement to the bill item.
- **Joins:** the end of Wave 5.

---

## Done

Already in the product. No build unless the note says the claim turned out false.

### BOS-13 — Undo

- **Status:** done
- **Kind:** already in the product. **Difficulty:** 1
- **Where:** ribbon command `undo` in `web/v2/ribbon.js`, handled in `web/v2/ui.js`.
- **Note:** Floris asked for Undo. It is already there. No build unless a named action cannot be reversed. If that happens, record the action here and set this row back to **to do**.

### BOS-27 — Redraw the plans, then price

- **Status:** done
- **Kind:** already the product path. **Difficulty:** 1
- **Where:** draw in `web/v2`, quantities in `web/v2/compile.js`, prices from the rate book.
- **Note:** “Once the project is finalised, the builder redraws and the model supports pricing” describes the app. No separate task unless a redraw drops the link to the bill. If that is found, set this row back to **to do** and name the broken link.
