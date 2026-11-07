# Brief: two roofs, a step in height, and a new roof cutting the old

The house that prompted this has two existing roof sections, the middle one sitting slightly higher, and a later extension whose new roof cuts into the old. Revit models both as separate roofs. This slice does the same. A cut already exists (`hole` or `remove` on the roof, outline left alone). This brief adds the plate height, and makes a proposed roof write the cut instead of the user drawing it by hand.

## Goal

Two existing roofs on the same level can sit at different plate heights. A proposed roof drawn over an existing one leaves the existing outline as it was and stores the overlap as a `remove` cut on the existing roof. Areas follow. Deleting or moving the new roof updates that cut.

## Do not change

- The roof record's outline, form, pitch, ridge, and status. A roof is still one footprint with one form.
- Hand-drawn cuts. `hole` and `remove` stay as they are, still edited on the roof they belong to.
- Two existing roofs do not cut each other. Two proposed roofs do not cut each other. A step in height is not a cut.
- Plan area. `roofPlanAreas` already subtracts cuts once. Keep using it.
- Per-edge pitch, overhang, and plate. An L, a verandah at another pitch, and a true valley are the next roof job, not this one.
- A solid join. No boolean of one roof volume against another, in plan or in 3D. The overlap polygon is the whole of "cuts into."

## Plate height

Each roof gains `offset`, millimetres above its level, default `0`. The same idea as a wall base that is not attached: the level plus an offset. `0` means the plate is on the level. Do not invent a height.

- The roof inspector shows it, in millimetres, whenever a roof is selected. Changing it updates that roof only.
- Compile adds it to the eave elevation already passed into the 3D roof (`level elevation`, or wall height when the level sits at zero). A middle roof at `+150` draws 150 mm above the other.
- The plan outline does not move. Guides, ridge, and form stay on the footprint.
- Copy, move, and mirror carry `offset` with the roof.

The stepped existing house is two roofs, both existing, same level, different `offset`. Their footprints meet at the step. Nothing is joined and nothing is cut.

## A new roof cutting the old

On commit, and again whenever that roof's footprint changes, a **proposed** roof looks at every **existing** roof on the same level.

- The overlap of the two footprints, clipped to the existing outline, is one `remove` cut.
- The cut stores `by` as the proposed roof's id. Overlap below `ROOF_CUT_MIN_AREA` writes nothing.
- Recomputing replaces the cuts with that `by`. It does not touch hand-drawn cuts, and it does not touch cuts written by another roof.
- The existing roof's outline, form, pitch, ridge, status, and `offset` stay. Its scheduled area is the retained area.
- The proposed roof keeps its own full area. Sitting on the old roof does not reduce it.
- Deleting the proposed roof deletes the cuts it authored.
- Moving, stretching, or editing the proposed outline recomputes them.
- A cut with a `by` is drawn with the other remove cuts. Selecting it says which roof cut it. Its corners are not a separate edit; the proposed roof is the edit. Deleting that cut by hand drops it, and a later move of the proposed roof writes it back. To keep a different opening, draw a hand cut.

The extension on the known house is this: the old roofs stay existing, the new roof is proposed, and the piece of old roof under the new one becomes a `remove` cut.

## Acceptance

1. Two existing gables on one level, offsets `0` and `150`. The inspector shows 0 mm and 150 mm. In 3D the second eave is 150 mm higher. Both outlines are unchanged. Neither has a cut. Each keeps its own area.
2. A proposed roof overlapping an existing one writes a `remove` cut on the existing roof, `by` the new id. The existing outline is the same object as before. Existing area falls by the overlap. Proposed area is the whole new roof.
3. A proposed roof that overlaps two existing roofs writes one cut on each, and misses the third it does not touch.
4. Moving the proposed roof moves its cuts. A hand-drawn hole on the existing roof stays where it was. Deleting the proposed roof removes only its cuts.
5. Two existing roofs that overlap, and two proposed roofs that overlap, write no cuts.
6. An overlap smaller than `ROOF_CUT_MIN_AREA` writes no cut.
7. Roof tests cover the offset, the authored cut, the recompute, and the untouched hand cut. Existing cut-area tests still pass.

## Verify in the browser

With a job on one level:

- Draw an existing roof, then a second existing roof beside it. Set the second plate to 150 mm. Open 3D and confirm the step. Confirm neither roof gained a cut.
- Draw a proposed roof over part of the first. The plan shows the bite. The first roof's area drops. The proposed roof's area is its full outline. Delete the proposed roof and the bite is gone.
- Draw a hole by hand on the remaining existing roof. Move a new proposed roof. The hole stays. The authored bite follows the proposed roof.
