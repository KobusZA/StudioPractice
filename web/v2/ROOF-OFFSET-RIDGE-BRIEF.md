# Brief: move the ridge of a gable roof off centre

A gable roof can have its ridge off the middle, and its two slopes can differ. The wall on the shorter side then rises on its own to meet the roof. It works on the rectangle model only, like every other roof today.

Status: built. See "What was built" at the end.

## Goal

A gable roof gets a ridge position and an optional second slope. The default is the middle with one pitch, so every roof that exists today looks the same. The plan guide line, the 3D, and the wall tops all follow one profile.

## Do not change

- Form, status, plate height, overhang, `base`, and the roof edge.
- Flat, shed, and hip roofs. The ridge position applies to gable only.
- Roofs saved before this change. A roof with no ridge position or second slope is built exactly as before.
- Plan area and the schedule.
- The 3D is still built on the bounding rectangle (`roofRectFromForm`).
- `conformWallsToRoofs`. It already follows the roof surface and the kinks.

## Data

On a roof:

- `ridgeOffset`: millimetres from the low wall to the ridge. The low wall is the one at the top (or left) of the roof in plan, the smaller coordinate across the span. It is measured from the wall (the bearing line), not from the edge of the overhang. Missing means the middle. Held between 5% and 95% of the span between the walls.
- `pitch2`: degrees, 5 to 60. The slope of the shorter side. Missing means the same pitch on both sides.

Bad values are dropped when a job opens. Copy, move, rotate, and mirror carry both. Mirror and rotate keep the ridge by the same wall: when the low side swaps, `ridgeOffset` becomes the span between the walls minus the old value.

## Heights

`pitch` is the pitch of the longer side. That side's wall sits at the plate, and its run sets the ridge height. The shorter side takes `pitch2`, or the same pitch. So with one pitch and the ridge off centre, the shorter side's wall meets the roof higher than the plate: that wall rises by itself. This is what the customer described.

- ridge height above the plate = longer run x tan(pitch)
- shorter-side wall rise = ridge height - shorter run x tan(second slope)

A second slope steeper than the longer side's would lower or even remove the rise. A wall is never cut below the plate by this.

With an overhang, the eave on each side drops by its own slope times the overhang. A centred ridge with one pitch gives the same numbers as the overhang brief.

One function owns this: `gableProfile` in `roof.js`. All four places read it, and none copy the arithmetic:

- `roofGuideLines` in `roof.js` (the plan ridge line)
- `roofModel` kinks and `roofHeightAt` in `massing.js` (wall tops)
- the gable branch of `pushRoofShell` in `massing.js` (the 3D roof)
- `roofUndersideAt` in `service-obstructions.js` (clash checks)

## Drawing and editing

- The roof inspector, for a gable, shows Ridge from top/left wall (mm, empty is the middle), Other slope (degrees, empty is the same pitch), and a plain sentence with the two slopes and how much the wall rises.
- In plan, a selected gable has a diamond handle on its ridge line. Dragging it moves the ridge across the span, lands on the middle when close, and the status line says the result.
- Changing the form away from gable keeps the values but ignores them.
- Changing the ridge direction (long or short) resets the ridge to the middle, since the span changed.
- Undo restores the previous position.

## Acceptance

1. A centred gable with one pitch is identical to before in plan, 3D, and wall heights.
2. 10 x 8 m, 30 degrees, ridge along the long side, ridge 2000 mm from the top wall. The ridge is at 2.0 m in plan and in 3D. Ridge height is 6 x tan 30 = 3.464 m above the plate. Both slopes are 30 degrees. The wall under the ridge rises 2.309 m above the plate. The far wall stays at the plate.
3. The same roof with a second slope of 45 degrees: the near slope is 45 degrees and the near wall rises 3.464 - 2 = 1.464 m.
4. Plan guide line, 3D ridge, and the wall kink are at the same position. A test compares them.
5. An offset under 5% or over 95% is held to 5% or 95%. The box shows what was kept.
6. Mirror across the span moves the ridge to the other wall. Copy keeps both values. A half turn moves the ridge to the other wall, a quarter turn keeps it by the same wall.
7. With an overhang, the ridge is measured from the wall, and mirror flips it about the walls.
8. A roof with no values opens unchanged.
9. Existing tests still pass.

## What was built

- `roof.js`: `gableProfile`, `gableForForm`, `roofRidgeOffsetMm`, `roofPitch2Deg`, and the ridge in `roofGuideLines`.
- `massing.js`, `service-obstructions.js`, `compile.js`, `model.js`, `modify.js`: read the profile, pass the three values through, and keep the ridge by its wall on mirror and rotate.
- `ui.js`, `index.html`, `v2.css`: the inspector fields, the note, the ridge handle and its drag.
- `tests/roof-ridge.test.js`: 14 tests covering the profile, the guide line, the 3D and wall agreement, old roofs, bad values, mirror, rotate, and copy.

Not done: it has not been checked by hand in the browser. A centred ridge with a second slope set can swap sides on mirror, because a tie puts the main pitch on the low side.

## Verify in the browser

Draw a box of walls with a gable roof. Select the roof and drag the diamond on the ridge across. Open 3D: the roof is asymmetric, the wall by the ridge is taller, the far wall is unchanged. Type 2000 in Ridge from top/left wall and 45 in Other slope and check the sentence. Clear both and check it matches the original.
