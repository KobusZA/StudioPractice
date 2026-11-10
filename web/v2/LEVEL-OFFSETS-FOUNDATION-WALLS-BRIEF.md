# Brief: floor offsets instead of extra levels, and foundation walls drawn for you

The customer does not want a level for every floor height. One section of theirs has seven heights. A step down of 170 mm, or a balcony 85 mm below the first floor, is an offset from the storey's level, not a level of its own. The builder reads it as a spot level (`FFL −0.170`), not as another level line.

The customer also wants the foundation walls drawn for them. When a ground floor wall is drawn, a 220 mm foundation wall appears under it, centred on the same line, from the foundation level up to where that wall starts. Their worry is duplication. Today a foundation wall can only run from the foundation level to the ground floor level. Where the floor is stepped down 170 mm, the wall above starts 170 mm lower, so the two overlap. This brief ties the foundation wall's top to the wall it carries, not to a level, so it cannot overlap.

Foundations stay on one level for now (`00 FOUNDATION`, −600 in the template). Stepped footings and slab thickenings are a later job.

## Goal

Floors, rooms and ceilings carry an offset from their level. Every masonry wall on the ground storey starts at the top of the slab beside it and gets a derived 220 mm foundation wall below it, from the foundation level to that slab top. Nothing is drawn twice. Part C reads the real floor-to-ceiling height of each room.

## Decisions

These were open questions. They are now decided. Do not reopen them while building.

1. **A wall at a step starts at the lower floor.** The higher slab butts against it. The foundation wall under it stops at the lower slab top.
2. **The foundation wall stops at the DPC, and the DPC is at the slab top.** SANS 10400-K:2011 clause 4.5.3.3 puts the DPC in a masonry wall at the level of the top of a concrete slab resting on the ground. The ground floor wall starts there as well, because the brickwork is continuous with the DPC between the courses. Finished floor level (FFL) is above the slab top by the floor build-up (screed, tiles). Clause numbers are from the firm's own reading of the standard; confirm them against the published text before they are quoted on a drawing.
   - **Ground clearance is a second rule, not an alternative.** Clause 4.5.3.7 says no horizontal DPC less than 150 mm above adjacent finished ground. On a stepped or sloping site the slab-top DPC can fail it (slab top 99.970 against ground 99.900 is only 70 mm). This pass does not move the DPC to fix that. There is no "DPC height above slab" setting, because the standard ties the DPC to the slab top and a conflict with the ground level is for the designer to resolve. Check flags it where the app knows the ground level (see Check).
   - **The DPM under the slab is separate** (SANS 10400-J, floors). It is not modelled in this pass.
3. **Foundation walls are 220 mm.** The customer said 220. The template types named "220mm Foundation" state 240 overall. That is plaster that foundation brickwork does not have. Draw 220 and report it to the firm (see Template ask).
4. **Every masonry wall on the ground storey gets one, 110 partitions included.** A 220 foundation wall under a 110 wall (130 overall) is centred and stands about 45 mm proud each side. Boundary walls, fences and pool walls are excluded. They have their own foundations.
5. **A sunken room's ceiling stays where it is.** The ceiling hangs from the structure above, and a floor step does not move that structure. Keeping the ceiling only makes the room taller, so it can never quietly fail Part C. A ceiling can be lowered by its own offset, never by a new level.

## Later (not in this pass)

- **Slab edges and steps with no wall above them** (a patio or stoep edge, a fill area, a step inside one space) get no derived foundation wall. The user draws those by hand, and the hand-drawn wall's default 600 mm top makes that workable. The customer asked for foundation walls under walls only, and they have put slab thickenings in a later phase. Open question for the customer: "Under a patio or stoep edge with no wall on it, do you want a foundation wall drawn automatically, or drawn by you?" If yes, add exposed ground-storey slab edges as a second source in `deriveFoundationWalls`, through the same one-per-line grouping.
- **Elevations** do not print spot levels. A floor level seldom shows on an elevation. Add it only if the customer asks.
- **Roofs** already carry `offset` in millimetres (`roofOffsetMm`). The new floor offset deliberately works the same way, so "the same principle applies to roofs" is already met. No roof change in this pass.

## Do not change

- Levels. The template's four storeys stay as they are, and `00 FOUNDATION` stays at −600. No level is created for an offset.
- Split levels (`parentId`). They keep working for a job that wants a named level. They are not the way to do a step.
- Base attach (`baseAttach`) and the `baseOffset` that Detach writes. A wall with either one keeps the base it resolves today.
- Upper storeys. Walls on `02 L1` and above start at their level as now. Floor build-up applies to the ground storey only in this pass.
- The implied footing recipe (600×200 per metre of masonry wall). Derived foundation walls do not count as a drawn foundation for it, so the footing is still priced.
- A document with no offsets and no build-up draws exactly as today, apart from the new derived foundation walls.

## Data

All additive. No `DOC_SCHEMA` bump.

- **`offset` on rooms and slabs** (floors and ceilings), in millimetres, default 0, left off the record when 0. It works the same way as the roof's `offset`. Read it with one helper, `floorOffsetMm(obj)`, next to `roofOffsetMm`.
- **`doc.floorBuildUp`**: millimetres from FFL down to the slab top on the ground storey. `null` means not stated. It is then treated as 0, and Check says so once.
- **`foundation: false` on a drawn segment**: this wall gets no derived foundation wall. Absent means it does get one.
- **`system.foundationWallThickness`** in the pack: 220 (mm, converted to metres by `normalizePackUnits` like `wallHeight`). `build-pack.js` writes it as a customer-stated fact.
- **`system.defaultFoundationWallSku`** in the pack: the foundation type that is not a strip footing, preferring "No-plaster" in the name (`TSP_FND_MASONARY_WALL_220MM_FOUNDATI`). `build-pack.js` picks it the way it picks `defaultFoundationSku`.

## Heights

One set of rules, all in `compile.js` and read by every caller. Nothing works out an elevation on its own.

- **Floor (FFL) of a room or slab**: level elevation + `offset`.
- **Slab top**: FFL − floor build-up on the ground storey, or FFL elsewhere.
- **Ceiling slab**: level elevation + the level's floor-to-ceiling + its own `offset`. It ignores the offset of the room under it.
- **Ground storey wall base**, for a wall with no attach and no `baseOffset`: the lowest slab top beside it. Sample both sides of the wall, half its thickness plus 50 mm out, at its start, middle and end. Use the rooms and floor slabs on its storey, including split levels whose parent is that storey. With no floor beside it, use the level datum minus the build-up. The wall's top does not move. A wall that runs up to the level above gets taller by the drop.
- **Room-derived walls** follow the same rule. This is a base from the floor, not an attach, so `LEVEL-ATTACH-PLAN.md`'s "room walls are level-datum only" still holds for attach.
- **Openings** already follow their host wall's resolved base. Keep that.
- **Part C ceiling height of a room**: the elevation of a ceiling slab over the room's centre, minus the room's FFL. With no ceiling slab, use the level's floor-to-ceiling minus the room's `offset`. A typed `room.ceilingHeight` still wins. `ceilingHeightFor` becomes this.

## Derived foundation walls

A new `deriveFoundationWalls(doc, pack, walls)` in `walls.js`. `deriveWalls` appends its result. Each foundation wall is computed on every compile and never stored, so it moves, shortens and disappears with its wall.

- **Source**: each masonry wall (category `wall`) whose resolved base is on the ground storey (`footingBelongsUnder` already answers this). Skip walls marked `foundation: false`. Skip a wall that already has a drawn foundation wall along it. Use the same parallel-and-close test as `coveredByDrawn`, against drawn foundation segments that are not strip footings. A hand-drawn one always wins.
- **Plan**: the wall's own centreline and arc, at `system.foundationWallThickness`. Corners meet the way the walls above them meet.
- **Height**: from the foundation storey's elevation up to the wall's resolved base.
- **One per line**: group by foundation storey and line key, the way `deriveRoomWalls` groups shared room walls, then split into intervals. Two collinear walls meeting end to end give two foundation walls. Where pieces overlap, the higher top wins, and the piece carries a conflict that Check lists.
- **Record**: `category: "foundation"`, `sku: system.defaultFoundationWallSku`, `level` set to the foundation storey, `drawn: false`, `derived: true`, `hostWallId` set to the wall above, and the host's status. Ids are stable: `f:<host wall id>:<lo>:<hi>`.
- **Schedule**: they are Walls rows with length, area and volume, like any foundation wall. The row says `derived: true`.
- **No foundation storey in the pack**: derive nothing, and say so once in Check.

**Convert to drawn**: selecting a derived foundation wall offers "Draw as its own wall". It writes a segment on the foundation storey with that height, and the drawn one then suppresses the derived one. Reuse the `drawnSegmentFromWall` pattern.

## Fixes that ship with this

1. **Hand-drawn foundation walls are 3 m tall.** The foundation-wall type states no height, so it falls back to `system.wallHeight`. A foundation-category wall drawn on the foundation storey defaults its top to "up to level above" (600 mm). `syncWallTop` and `syncHeightFields` stop hiding the Top and height controls for foundation walls. Strip footings keep their depth.
2. **"Up to level above" on a split level stops at its parent.** `levelAboveRise` returns 0.17 m from a −170 split. It must look above the parent storey, so it returns 3.17 m. The same goes for a balcony split under `02 L1`.
3. **`addFoundationUnderWall` hangs the footing directly under the wall.** On a ground storey wall it now puts the footing's top at the foundation level, so a 600×200 footing sits from −800 to −600. Elsewhere it behaves as now.

## UI

- **Room and floor/ceiling inspector**: an **Offset from level** box in millimetres, shown whenever a room or slab is selected. Blank or 0 clears it.
- **Levels panel**: a **Floor build-up** box in millimetres for the job. It is blank until set, and the hint says that blank means the DPC is taken at FFL.
- **Wall inspector, ground storey masonry wall**: a **Foundation wall** checkbox, on by default. It writes `foundation: false`.
- **Section and sheets**: where a section cuts a room or slab with a non-zero offset, print `FFL −0.170` at its floor, using the same `fflLabel` format. Zero offsets print nothing, so a drawing is not cluttered. Sheets reuse the section drawing code, so a sheet's section viewport prints the same labels. The customer's reason for offsets is drawings a builder can read, and their own example is a section.
- **Plan**: an offset room or slab shows `FFL −0.170` under its name, using the `fflLabel` format. The foundation plan draws derived foundation walls like drawn ones, with a lighter outline so a user can tell they were not drawn.
- **Check**:
  - "Floor build-up not stated; the DPC is taken at finished floor level." Shown once, only when the ground storey has walls.
  - Foundation wall conflicts.
  - "DPC is less than 150 mm above the natural ground level." Shown for a ground storey wall when the job has an NGL reference level and the wall's resolved base (the DPC) is under 150 mm above it. Advisory only, it never moves the wall. Silent when there is no NGL, because the ground level is then unknown.
  - "This template has no foundation storey, so no foundation walls were drawn."

## Template ask

Add to `TEMPLATE-ASKS.md` under "Decisions only the firm can make": the two "Masonary wall 220mm Foundation" types state a 240 mm thickness. Foundation walls are drawn and priced at 220 because the firm's brief says all foundation walls are 220. Ask the firm to correct the type, or to say why it is 240.

## Acceptance

Template levels: `00 FOUNDATION` at −600, `01 GFL` at 0, `02 L1` at 3000. Build-up is blank unless stated.

1. A 5 × 4 m room on the ground floor in 220 plastered walls. Four derived foundation walls, each 220 thick, centred on the wall lines, from −0.600 to 0.000. Four Walls rows marked `derived`. The implied footing row is still there.
2. Set the build-up to 30. The foundation walls run from −0.600 to −0.030. The ground floor walls start at −0.030, are 3.030 tall, and still top out at 3.000.
3. Two rooms share a wall, and one room has offset −170. The shared wall starts at −0.170. One foundation wall under it runs from −0.600 to −0.170, with nothing above −0.170. The sunk room's outer walls also start at −0.170. The plan shows `FFL −0.170`.
4. A 110 partition across the room. Its foundation wall is 220, centred on the partition's line.
5. Mark one wall "no foundation wall". Its derived foundation wall disappears, and undo brings it back.
6. Draw a foundation wall by hand along one wall. The derived one under that wall disappears. The hand-drawn one defaults to 600 mm tall, and the inspector shows its Top control.
7. "Draw as its own wall" on a derived foundation wall leaves one stored segment with the same height and no derived wall under it.
8. Move a ground floor wall 1 m. Its foundation wall moves with it. Delete the wall, and the foundation wall goes too.
9. A balcony slab on `02 L1` with offset −85 sits at 2.915. No foundation walls appear on any upper storey.
10. A sunk −170 room with a ceiling slab at its level. The ceiling stays at 2.902, and Part C reads 3.072. Give the ceiling offset −170, and it sits at 2.732 while Part C reads 2.902.
11. A wall on a −170 split level, set to "up to level above", is 3.170 tall.
12. `addFoundationUnderWall` on a ground floor wall places a 600×200 footing from −0.800 to −0.600.
13. A document saved before this change opens with every wall, floor and roof at the same elevation and height. The only additions are the derived foundation walls and their rows.
14. A section through a −170 room prints `FFL −0.170` at its floor. A section through a room with offset 0 prints no spot level. A sheet viewport of that section prints the same label.
14a. With an NGL reference level at −0.100 and a ground floor wall whose base is 0.000, Check lists the 150 mm clearance advisory. With NGL at −0.200 it does not. With no NGL it says nothing.
15. A patio slab on the ground storey with no wall on it gets no derived foundation wall.
16. Tests cover the height rules, `deriveFoundationWalls` (centring, one per line, overlap conflict, opt-out, hand-drawn wins, no foundation storey), the split-level rise, the foundation wall default top, and Part C with offsets. Existing tests still pass.

## Verify in the browser

On a new job with the TSP template:

- Draw a room in 220 walls on the ground floor. Open the foundation plan. Four foundation walls sit under the walls, centred.
- Open 3D or a section through the room. The foundation brickwork runs from −600 up to the floor, and the wall carries on above it with no overlap.
- Draw a second room beside it and set its offset to −170. In section, the shared wall drops to −170 and the foundation wall under it shortens. Nothing overlaps.
- Set the floor build-up to 30. The foundation tops drop 30 mm, and the walls grow by 30 mm without their tops moving.
- Draw a 110 partition. Its foundation wall is 220 and centred.
- Draw a slab on the first floor with offset −85. It steps down in section, and nothing appears below it.
- Cut a section through the −170 room. `FFL −0.170` is printed at its floor. Put that section on a sheet and check the label is there too.
