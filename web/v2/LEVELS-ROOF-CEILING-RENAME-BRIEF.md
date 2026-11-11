# Brief: no roof cut, storeys without a ceiling, and renaming levels

Three asks from the customer about the Active cut panel and levels.

1. **"There is no such thing as eaves" on the Active cut.** The `Roof · eaves` stop is not at the eaves of any roof. It is the top storey's floor-to-floor plus a fixed 120 mm (`ROOF_EAVES_LIFT_M`). On a one-storey template house that is 3.12 m, while a roof drawn on `01 GFL` sits on the wall plate at 2.8 m and its real eave is lower still. They want it gone.
2. **"Sometimes there is no ceiling, and sometimes it is at a different height."** A ceiling at a different height is already modelled: a ceiling slab has its own `offset`, and Part C reads the lowest ceiling slab over a room. What is missing is a way to say a storey has no ceiling at all. Today its rooms are checked against the template's 2.902 m, a ceiling that does not exist.
3. **Rename levels.** The names come from the template (`01 GFL`, `02 L1`) and cannot be changed.

## Goal

The Active cut rail shows only real stops: each storey's floor, and its ceiling unless the storey has none. Roofs are drawn on the top storey and sit at the top of that storey's walls. A storey can be set to have no ceiling, and Part C then measures its rooms to the top of their walls. Any level can be renamed without anything that points at it changing.

A one-storey template house reads, on the rail:

| Stop | Level | Height |
|---|---|---|
| Foundation | `00 FOUNDATION` | −0.600 |
| Ground floor · floor | `01 GFL` | 0.000 |
| Ground floor · ceiling | `01 GFL` | 2.902 |

## Decisions

These were open questions. They are now decided. Do not reopen them while building.

1. **The roof cut is removed, not renamed.** A stop that does not follow the real roof is the same false claim under another name. A roof plan view, if wanted later, comes from the roofs' own plate and eave heights, never a fixed lift.
2. **A roof sits at the top of the walls of the storey it is on.** Today a roof on `01 GFL` sits at `system.wallHeight`, but a roof on `02 L1` sits at L1's *floor*. After this pass both sit at their storey's wall top. The roof's own `offset` still applies on top.
3. **The ceiling stop stays.** It is the storey's default ceiling height: the height a new ceiling is drawn at, and the cut where ceilings are drawn and edited. A ceiling at another height is that ceiling's `offset`, not a second stop.
4. **"No ceiling" is set per storey.** The customer's call. It is a fact about the building, not a view toggle: hiding ceilings must not be used as the answer to "this storey has none". A single room without a ceiling on a ceilinged storey is not covered in this pass. The user types that room's height (`room.ceilingHeight`), as today.
5. **A room on a no-ceiling storey that is too low at its walls is flagged "check", not "fail".** See Part 2, Part C height.
6. **A renamed level keeps its id.** Every object stores `level: <id>`. Only the display name changes, so nothing is migrated and nothing is re-pointed.
7. **A typed name shows exactly as typed.** The spelling-out in `levelDisplayName` (`GFL` → `Ground floor`) applies to template names only. A user who types `GF` sees `GF`.

## Do not change

- The levels themselves, their elevations, split levels (`parentId`) and reference levels.
- Floor and ceiling offsets (`floorOffsetMm`), and `roomCeilingHeight`'s order: a typed `room.ceilingHeight` wins, then the lowest ceiling slab over the room.
- Roof pitch, overhang and eave drop (`roofEaveDropM`). Only the plate's starting height changes.
- Level ids. No rename touches `id`, `doc.levelElevations` keys or any object's `level`.

## Part 1: remove the roof cut

**Rail and inspector.** `buildHouseStations` stops adding the `roof` station. Delete `roofEavesElevation` and `ROOF_EAVES_LIFT_M`. Remove the `kind === "roof"` branches in `stationDisplay`, `editStationElevation`, the Active cut panel drawing and keyboard paging. `inspectorStations` lists floor and ceiling stops only.

**Floors placed on the eaves.** `atEaves` goes from new records: the floor tool no longer writes it (`commitLinkedOutline`, the rect path near `activeStationKind() === "roof"`), and `eavesPlaceNote` goes. Remove the `atEaves` branches in `objectPlanRole`, `keptByCut`, the plan slab and finish loops, the inspector station and the "Moved to the roof eaves" history label. `isFloorSlab` drops its `atEaves` test.

**Existing documents.** `normalizeDoc` turns a floor with `atEaves: true` into an ordinary floor on the same level with an `offset` that keeps its height. That offset is `(floorToFloor + 0.12) × 1000` mm for its level, worked out once, on load. Then `atEaves` is deleted. The floor draws and prices exactly where it did, and the user can see and change the number. A floor whose level has no floor-to-floor gets an offset of 120 mm, which is what it had. No `DOC_SCHEMA` bump.

**Roof height.** In `compile.js`, the roof plate becomes the top of the walls of `roof.level`: that level's elevation plus `wallHeight`, the same height `deriveDrawnWalls` gives an unattached wall on it. Then add `roofOffsetMm(roof) / 1000`. Remove the `levelZ < 0.05` special case. The 3D shell, the wall-to-roof attach in `massing.js` and the plan label (`${pitch} · eaves …`) all read this one plate. The plan label already names the real eave and stays.

**Roofs only.** With "This level only" ticked, the roof cut showed roofs and hid the storey. Replace it with a "Roofs" checkbox under "This level only" on the Active cut panel. Ticked, the plan shows the top storey's roofs and the storey drawn faded under them, the same ghost as a neighbouring storey. It is a view setting and is not saved.

## Part 2: a storey with no ceiling

**Data.** `doc.levelNoCeiling = { [levelId]: true }`, laid over the levels the same way `doc.levelElevations` is, so it works for template and inserted levels alike. Absent means the storey has its ceiling, as today. `normalizeDoc` keeps only an explicit `true`. The level's `floorToCeiling` is not touched, so turning the ceiling back on returns the same height.

**Pack.** `applyNoCeiling(levels, map)` in `level-view.js`, pure, called in `syncPackLevels` next to `applyLevelElevations`. For a storey in the map it sets `floorToCeiling: null` and `noCeiling: true`. The `noCeiling` flag is what tells "this storey has no ceiling" apart from "the height is not known yet", which is also `null` today.

Because `floorToCeiling` is null, the things that already skip a missing height follow without further change: `buildHouseStations` drops the ceiling stop, and the Active cut panel's section drawing leaves out that storey's ceiling line (`ui.js`, the `ceilings` filter).

**Turning it off.** A "Ceiling" checkbox on the Active cut panel for the active storey, ticked by default. Unticking writes the entry, with the undo label "Set Ground floor to no ceiling". If ceilings are already drawn on that storey, it refuses: "Ground floor has 3 ceilings drawn. Delete them first." While the storey has no ceiling, the ceiling tool is greyed out on it, with the hint "Ground floor has no ceiling. Tick Ceiling on the Active cut panel to draw one."

**Part C height** (`roomCeilingHeight`), in this order:

1. A typed `room.ceilingHeight` wins, as today.
2. The lowest ceiling slab over the room's centre, as today. A no-ceiling storey has none, because the ceiling tool is off there.
3. On a no-ceiling storey, the height is the lowest top of the walls around the room minus the room's FFL.
4. Otherwise, the level's floor-to-ceiling less the room's offset, as today.

With no ceiling, a room's real height runs up to the underside of the roof. Under a pitched roof that is lowest at the walls and higher towards the ridge. The app knows the wall height but not yet the height under the roof across the room. So, measured at the walls:

- **At or above the minimum:** pass. The room cannot be lower than its walls.
- **Below the minimum:** "check", not "fail" (Check's `advisory`). The room may still be high enough in the middle. Message: "Lounge has no ceiling. The walls are 2 300 mm high, below the 2 400 mm minimum. Check the height under the roof." Measuring under the roof slope (the 70%-of-area rule) is a later job.

**Sections.** A storey with no ceiling gets no ceiling line in a section.

**A ceiling at a different height** needs nothing new. Draw it on the ceiling stop and set its offset in the inspector. The only change is the label: on a ceiling slab the offset field reads "Offset from ceiling height", and the inspector shows the resolved height next to it ("2 702 mm above floor").

## Part 3: rename levels

**Data.** `doc.levelNames = { [levelId]: "name" }`, laid over the template's levels the same way `doc.levelElevations` is. A level the user inserted (in `doc.levels`) is renamed in place: its `name` changes and its `id` does not. Clearing a template level's name removes the entry, so it goes back to the template name.

**Pack.** `applyLevelNames(levels, names)` in `level-view.js`, pure, called in `syncPackLevels` alongside `applyLevelElevations`. Every reader of `level.name` follows: the rail, inspector, level pickers, history labels, sheet titles, schedules, service panel and IFC storey names.

**Validation.** `validateLevelRename(levels, levelId, text)`:

- Trimmed and not empty: "Name the level, e.g. Ground floor."
- At most 40 characters.
- Not the same as another level's id or name, ignoring case. Lookups match `l.id === x || l.name === x`, so a name equal to another level's id would point objects at the wrong level.

`validateLevelInsert` already checks new names against ids and names, so a new level cannot take a renamed level's old id.

**UI.** Double-click a level's name on the Active cut rail to edit it, the same pattern as the elevation field (`editStationElevation`): Enter commits, Escape and blur cancel. Undo label: "Renamed 01 GFL to Ground". The ceiling stop shows the new name too ("Ground · ceiling").

**Display.** `levelDisplayName` spells out only names that come from the template. A name from `doc.levelNames`, or on a user-inserted level, is shown as typed, with no code split.

**Remove floor.** Where Remove floor clears `doc.levelElevations` for the hidden storeys, it clears `doc.levelNames` for them as well.

## Tests

- `level-view.test.js`: a fresh one-storey document's stations are foundation, ground floor and its ceiling, with no roof. Update the four tests that expect `Roof · eaves`. A storey with no floor-to-floor has no extra stop.
- `core.test.js`: a document with an `atEaves` floor loads as a floor with the matching offset and no `atEaves`, and compiles to the same elevation as before.
- `massing.test.js` / `roof-ridge.test.js`: a roof on `01 GFL` has its plate at the wall height. A roof on `02 L1` has its plate at L1's elevation plus the wall height, not at L1's floor.
- `placement-warn.test.js`: remove the two roof-eaves-cut tests.
- `level-view.test.js`: a storey in `doc.levelNoCeiling` has no ceiling stop, and its `floorToCeiling` comes back unchanged when the entry is removed. Turning the ceiling off is refused while ceilings are drawn on that storey.
- `floor-levels` / `rules.test.js`: a room on a no-ceiling storey is measured to its wall top. Walls at or above the minimum pass, and walls below it give "check", not "fail". A typed `room.ceilingHeight` still wins. A storey whose height is simply not known still reports "not known yet", not "no ceiling".
- `level-view.test.js`: `applyLevelNames` renames without touching ids. Rename refuses empty, over 40 characters, and a clash with another level's id or name in any case. Clearing goes back to the template name. Remove floor clears the name.
