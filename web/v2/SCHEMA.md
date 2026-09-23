# SKU pack v2 — frozen schema

Why any of this is shaped the way it is: [../../PHILOSOPHY.md](../../PHILOSOPHY.md).
This file states the schema and the decisions; that one states the three
principles the decisions come from, and which kinds of "no" are allowed to
refuse a feature.

Status: **frozen** for the four-week demo build. Version `sp.pack/3`.
Machine-readable definition and validator: [schema.js](schema.js).
Migrated pack: [../samples/planner-pack-v2.json](../samples/planner-pack-v2.json).

Freezing means additive changes only: new optional keys and new enum members are
fine, renaming or removing a key is not. Anything that would break the frozen
surface waits for the next schema version.

## Changelog

**`sp.pack/3`** (see [../../UNITS-MIGRATION-PLAN.md](../../UNITS-MIGRATION-PLAN.md)):
every SKU's `geometry.*` field (`thickness`, `width`, `height`, `depth`, `sill`,
`diameter`, `riser`, `going`) and `system.wallHeight` changed from metres to
**millimetres**, matching the QS workbook (`calculators/*.csv`) and the wall-type
naming convention already in the template ("220mm Foundation Perimeter", etc.).
`system.wallHeight` moved with `geometry.height` rather than staying with the
other `levels[]` fields because it is that same value promoted to a
document-wide default (`walls.js`'s `sku.geometry.height ?? pack.system.wallHeight`
fallback needs both sides in one unit). `levels[].elevation`/`.floorToFloor`/
`.floorToCeiling` did **not** move: a level is a position in the plan's
coordinate space, not a named dimension a QS workbook or wall-type name states
in mm, and SANS 10400-C phrases ceiling heights in metres (2.4 m, 2.1 m) rather
than mm. Areas and volumes were never affected - they stay m²/m³.

This is a pack/JSON-representation change only. Every internal consumer
(`walls.js`, `compile.js`, `openings.js`, `dimensions.js`, `modify.js`,
`snap.js`) still works in metres exactly as before -
[`normalizePackUnits()`](schema.js) converts a loaded pack's geometry and
`wallHeight` from millimetres back to metres once, at the point a pack's JSON
is parsed (`ui.js`'s pack fetch, and the equivalent load in each test file that
reads a pack JSON fixture from disk). Moving those files' own internal
geometry math to millimetres too is a separate, later decision - see the units
plan's rollout order.

## Why the shape is what it is

### 1. A SKU carries physical facts, never a verdict

`thickness: 0.22`, `plastered: true` and `surfaceDensity: 470` belong in the
pack. "Complies with SANS 10400-XA" does not. Compliance is a function of the
facts, the energy zone, the room, and the edition of the standard in force on the
submission date. If a verdict were baked into the pack, every rule change would
force the firm to reissue their catalog, and a stale pack would put a wrong
statement on a drawing that a registered professional has signed.

Consequence: `compliance` blocks are inputs to the week-2 rule engine, and the
rule engine is the only thing allowed to say "pass".

### 2. Unknown is `null`, never a plausible default

Every compliance key must be present, and `null` is a legal value meaning "the
firm has not supplied this". The validator returns it as a warning and
`complianceGaps()` lists it. A guessed R-value that reaches a plans examiner is
worse than a blank one, because a blank gets queried and a wrong one gets built.

The migration currently reports **75 unknown facts across 18 SKUs**. That list is
the customer ask, not a bug.

### 3. Five separate concerns, five separate blocks

| Block | Owner | Changes when |
|---|---|---|
| `geometry` | the firm's Revit template | a family is edited |
| `cost` | the QS | rates escalate |
| `compliance` | the firm plus product suppliers | a supplier certificate arrives |
| `drawing` | the regulation | NBR notation changes |
| `schedule` | the QS workbook | the BoQ mapping changes |

They are split because different people supply them on different cycles. A rate
change must not require re-reviewing thermal properties.

### 4. Rates are referenced, not embedded

`cost.rateRef` points into a separate rate book
([../samples/tsp-rates.json](../samples/tsp-rates.json)). Pricing changes far
more often than the catalog, multiple rate books coexist (different clients,
different escalation dates), and a pack containing prices could not be shared
between contractors.

### 5. The schedule block is the contract with the QS workbook

`schedule.report` declares which measures a SKU contributes. The values come from
the TSP schedules in `calculators/`, so
[TSP WALL SCHEDULE(1).csv](../../calculators/TSP%20WALL%20SCHEDULE\(1\).csv)'s
columns (Model, Family, Type, Length, Area, Volume, Count) all still fall out of
a compiled row. `REQUIRED_MEASURES` in [schema.js](schema.js) enforces the
minimum per category, and the validator fails a pack that under-reports.

`compile()` attaches only declared measures, so a wall never carries a stray
`perimeter` and a door never carries a meaningless `volume`. This replaces v1's
hardcoded per-category switch with data.

### 6. Colour is a class, not a hex value

`drawing.colourClass` is one of the SANS 10400-A / NBR A8 notation classes
(masonry, concrete, steel, timber, glass, other, and the drainage set). The
regulation dictates the mapping from class to colour, and it differs between a
new-building submission and an alterations submission, so the renderer owns the
mapping and the pack only states the material class.

## Structure

```
{
  schema: "sp.pack/3",
  id, name, version, revision,
  locale:  { country, municipality, energyZone },
  system:  { wallHeight, defaultWallSku, defaultFloorSku, defaultFoundationSku,
             defaultRoofSku, defaultCeilingSku, defaultLevel },
  levels:  [ { id, name, elevation, floorToFloor, floorToCeiling } ], // metres
  skus:    [ SKU ],
  recipes: { requires, allowedHosts, maxSpan, minLength }
}
```

`system.wallHeight` is millimetres (see the changelog above); `levels[].elevation`/
`.floorToFloor`/`.floorToCeiling` are metres.

A SKU:

```
{
  id, name, family?, category, unit, draw, defaultLevel?,
  // millimetres - see the changelog above
  geometry:   { thickness?, height?, width?, depth?, sill?, diameter?, riser?, going? },
  cost:       { rateRef, wasteFactor },
  compliance: { ...category-specific facts... },
  drawing:    { colourClass, hatch, symbol },
  schedule:   { report: [measures], scheduleName }
}
```

`CATEGORIES`, `DRAW_VERBS`, `COLOUR_CLASSES`, `SCHEDULE_MEASURES`,
`REQUIRED_MEASURES`, required geometry keys and the compliance facts per category
are all enumerated in [schema.js](schema.js) and enforced by `validatePack()`.

Categories now include the non-SACAP work types the first release targets:
`boundarywall`, `pool`, `carport`, plus `stair`, `ceiling`, `sanitary`,
`waterheater`, `drainage` and `column`, none of which existed in v1.

## What the migration found

Run `npm run migrate-pack` in this directory to reproduce.

**Inferred from the firm's own data (20 items, each reported for confirmation).**
Only ever from what the v1 pack already states — a name containing "plaster", a
foundation being load bearing by definition, a door leaf clearing its full
opening.

**One finding that changes the demo.** Every window in the pack carries
`family: "Fixed"`. A fixed pane does not open, so it contributes nothing to the
SANS 10400-O requirement for openable ventilation of at least 5% of floor area.
As the catalog stands, **no room can pass Part O ventilation**. This is pinned by
the test `fixed windows contribute light but no ventilation`. The firm needs to
add opening window types, or confirm the real families, before Part O checking
can show a pass in the demo.

**Material notation unconfirmed (7 SKUs).** Doors, the WC, vanities and the
socket fall back to colour class `other` because v1 never stated their material.
Doors matter: timber is yellow and steel is blue on a submission drawing.

## The pack is now built from the template, not transcribed

`planner-pack-v2.json` was 24 placeholder SKUs with invented family names. The
real template has 113 placed model types, so the app now loads
[../samples/tsp-pack.json](../samples/tsp-pack.json), generated by
[build-pack.js](build-pack.js) from a raw type catalog.

| Source | Command | Produces |
|---|---|---|
| Revit, the real thing | Export Catalog on the ribbon | `output/type-catalog.json` |
| The family report, as a stand-in | `npm run catalog-from-tsv` | `../samples/tsp-template-catalog.json` |
| Either catalog | `npm run build-pack` | `../samples/tsp-pack.json` |

`build-pack.js` owns every judgement, so the mapping is testable without Revit.
The C# side emits facts only. Two rules carry over from the migration and one is
new:

1. Compliance facts still come only from what the template states, and 139
   remain null across 45 SKUs.
2. A Revit category that is neither mapped nor explicitly excluded is reported,
   never silently dropped.
3. **Dimensions may fall back**, because the schema requires them and the family
   report carries no parameters. Every fallback is listed under "Dimensions
   assumed". Running Export Catalog replaces almost all of them with real values.

What the real catalog changed:

- **Part O is no longer categorically blocked.** The template has one openable
  type, `TSP_Window-Casement-Triple-Side-Transom`, against four fixed types. Its
  `openableAreaFraction` is still null, so Part O reports "cannot check" rather
  than a wrong pass. The firm still has to confirm the openable types they use.
- **Door notation is confirmed.** The type names state the material, so timber
  doors are notated as timber instead of falling back to `other`.
- **Electrical is 64 count-only SKUs.** Every conduit, cable tray, duct and
  piping type in the template is unplaced; the firm counts points and prices
  them as PC sums. We place symbols and count them, and never route services.
- **Levels come from Export Catalog; the TSV path still infers.** The family
  report lists Levels as an annotation category with a placed count, never
  names or elevations, so `catalog-from-tsv.js` can only guess: a placed
  cast-in-place stair is evidence of a second storey, so it synthesises two
  levels named "(inferred)" so the level switcher has something to switch
  between in tests, and `build-pack.js` prints `INFERRED` when it sees this.
  That inference is a stand-in for the TSV pipeline only - the app's real
  pack is built from `output/type-catalog.json` (Export Catalog), which
  states the template's actual storey names and elevations directly, so
  `build-pack.js` reads them verbatim rather than inferring anything.

## The plan canvas is level-aware

Every drawable object (room, slab, roof, drawn wall, beam, item) carries a
`level` id, defaulting to `system.defaultLevel` when absent (migrated v1 docs,
for instance). `deriveRoomWalls` groups shared walls by `(level, line)`, not
just line identity, because two rooms that align in plan on different storeys -
the normal case, since upper floors usually repeat the footprint below them -
must never be merged into one wall spanning two levels. An opening has no level
of its own; it inherits its host wall's level. `web/v2/ui.js` filters drawing,
hit-testing and marquee selection to the active level, and stamps new objects
with it, so a two-storey house draws as two separate plans rather than one
plan with everything stacked on top of itself.

### Levels the user inserts

The template's four storeys are the plan's **default** stack, not its limit
([../../PHILOSOPHY.md](../../PHILOSOPHY.md) principle 2). Two separate commands:
`+ Add floor` reveals a storey the template already defines (capped at
`MAX_FLOORS_TO_ADD`), while **Insert level** adds one it does not — a third
storey, a mezzanine, a different floor-to-floor.

An inserted level lives on the document as `doc.levels[]` (additive, no
`DOC_SCHEMA` bump), never written into the pack: the pack is regenerated from
the template by `build-pack.js`, so a job editing it would be both overwritten
and shared with every other job. `ui.js`'s `syncPackLevels()` merges the two
stacks into the `pack` object every consumer reads, so `compile.js`, `walls.js`
and the level switcher see one ordered stack and never need to know which
storey came from where. An inserted level carries `userSupplied: true`, which is
what keeps it always visible in the switcher and out of `+ Add floor`'s count.

This is not a hole in "unknown is `null`": an elevation the user types is a
supplied fact, the same as a calibration distance or an erf number. What is
*not* asked for stays null — `floorToFloor` and `floorToCeiling` on an inserted
level are null rather than copied from the storey below, and the status message
says so when the level is created rather than letting the Part C check be the
first place the user finds out.

## Week 2: the compliance rule engine

[rules.js](rules.js) is the versioned, dated rule pack the point above promises.
`RULE_PACK` carries an `effectiveDate` and a `version` and never touches a SKU
pack or a drawn document directly - `evaluateCompliance(doc, pack, rulePack)`
reads the facts both already expose (`compile()`'s room measures,
`roomOpeningAreas`'s per-opening compliance facts, a stair SKU's geometry and
compliance block) and turns them into one of four verdicts per finding: `pass`,
`fail`, `advisory` (a geometry upper bound, or a regulation-permitted
configuration this engine does not fully model, e.g. open risers), or
`unknown` (a required fact is `null` - this is deliberately not a pass).

Covers, against the open decisions below:

- **Part C** - per-room ceiling height against habitable/passage minimums, and
  the "no dimension less than 2 m" test, both against `compile()`'s existing
  `ceilingHeight` / `minDimension` / `minDimensionExact` fields.
- **Part O** - light and ventilation area per SANS class, reusing
  `openings.js`'s area maths but distinguishing "zero because nothing
  qualifies" from "unknown because a fact is null", which `roomOpeningAreas()`
  does not (it is a quantity total, not a verdict).
- **Part M** - riser, going, the 2R+G comfort sum, flight rise, landing length,
  solid risers and winders, against each placed stair SKU's `geometry` and
  `compliance` blocks.
- **Zoning & setbacks** - per-room encroachment against a building line, via
  [site.js](site.js) (below). Still reports `unknown` at each stage that is
  missing: no `pack.locale.municipality`, no property line drawn, or no
  building line yet - never a guessed pass.

The Check tab's four Part buttons (`ribbon.js`) all open the same Check panel,
because the engine always runs every part at once and the panel groups by part
already - there is no per-part run yet, only per-part display.

### Site objects: the last input zoning needed

[site.js](site.js) holds the three facts zoning reads, kept separate because
they come from different sources and change on different cycles, same
reasoning as the SKU pack's five blocks:

- **`propertyLine`** - the erf boundary, drawn once (`ribbon.js`: `property-line`
  arms a click-to-add-vertex tool on the canvas, closed by clicking the first
  point again, Enter, or Escape to cancel).
- **`sgReference`** - one control point tying the plan's local origin to the
  real-world SG diagram coordinate system, plus the erf number
  (`ribbon.js`: `sg-coords`). A single point, not a full transform, which
  assumes the plan is drawn true-north and true-scale - the same assumption
  the underlay's two-point calibration already makes.
- **`buildingLine`** - the setback boundary. `ribbon.js`'s `building-line`
  command derives it automatically: a uniform inward offset
  (`geom.js`'s `offsetPolygonInward`) of the property line by
  `RULE_PACK.zoning.setbackByMunicipality[pack.locale.municipality]`. A
  uniform, municipality-keyed distance is a deliberate simplification - a real
  scheme varies front/side/rear setback by zoning use, which needs a
  municipal scheme document this rule pack does not carry yet. There is no UI
  to draw a building line by hand yet for a municipality whose real building
  line the uniform offset cannot express; only the derived path exists.

`offsetPolygonInward` refuses (returns `null`) rather than silently returning
a self-intersecting result once the requested distance is at or past half the
shape's narrower bounding-box extent - a neighbour-line-intersection offset
cannot otherwise detect a symmetric shape folding through its own centre, which
still comes out with a valid CCW winding and a positive area, just mirrored
and in the wrong place.

## Week 3: sheets

[sheets.js](sheets.js) is the first Week 3 item off `ribbon.js`'s todo list -
the item's own text named the deliverable: "the TSP_SHEET_A1 and A3 title
blocks." A sheet is a doc-level record (`doc.sheets`), not a pack fact: paper
size, drawing title, scale, drawn-by/checked-by and revision history all
belong to one printed drawing, not to the SKU catalog or the rule pack.

- **Paper sizes are landscape ISO, A0-A4**, with a shared title block strip
  proportion across every size rather than a bespoke layout per size - the
  brief only names A1 and A3, but the same maths holds for A0/A2/A4 without a
  special case.
- **Scale is recommended, not chosen blind.** `recommendedScale()` picks the
  largest standard SA drawing scale (the smallest N in 1:N) that fits the
  document's current plan extent inside the sheet's drawable area, falling
  back to the most zoomed-out standard scale for an oversized plan rather
  than refusing to produce a sheet. A firm can still override it per sheet.
- **The title block reads what the document already knows and admits what it
  does not.** `titleBlockFields()` prints `pack.name`, `pack.locale`,
  `doc.site.erfNumber`, and now `doc.projectInfo.jobNumber`/`.clientName` where
  they exist, and an em-dash where they do not - the same "unknown is never a
  plausible default" rule this document states for SKU compliance facts,
  applied to a drawing sheet instead of a SKU. Job number and client name are
  edited once, doc-wide, in the Project information panel `project-info`
  opens; drawn-by/checked-by/date stay per-sheet fields, because those vary
  sheet to sheet where a job number and client name do not.
- **Revisions are letters, issued once, never reused** (A, B, ... Z, AA, ...),
  because a title block's revision history is part of the record, not a
  scratch value a firm can renumber after the fact.
- **One fixed viewport per sheet, drawn schematically.** The Sheets panel
  (`ui.js`) draws the chosen view into the drawable area at the sheet's
  scale: the plan (walls as centrelines, rooms as outline only - no openings,
  no dimensions, no per-level split), a named section (`doc.sections`,
  `sheets.js`'s `sheetView()`), drawn from the same clipped, extruded faces
  and poché the interactive Section view uses (`massing.js`'s
  `faceStyle()`/`hatchPolygon()`, exported for exactly this), a named
  elevation (`doc.elevations`, [elevation.js](elevation.js)) drawn from the
  same extruded faces unclipped and unhatched - an elevation is viewed from
  outside the whole model, so nothing needs cutting away and nothing is a
  poché face - or, now that `callout` has landed too, a named callout
  (`doc.callouts`, [callout.js](callout.js)), which reuses the plan
  branch's own schematic drawing windowed to the callout's own crop
  rectangle instead of the whole plan's extent. The viewport is still not
  movable or resizable.
- **An elevation is a section with no line to draw.** `ribbon.js`'s
  `elevation` used to read "one elevation extruded from the plan" as a Week 3
  todo; it is now a small chooser (`ui.js`'s `openElevationPicker()`) rather
  than an armed canvas tool like Section, because a whole building's facade
  has no start point and no end point for the user to click - the only fact
  they supply is which compass side to look from. [elevation.js](elevation.js)
  reuses section.js's u/v projection maths (`sectionUV`, `projectSectionPoint`,
  `sectionFrame`) against a locked origin and a compass-fixed look/along pair
  instead of inventing a second projection, and every pick is saved as a
  named view the moment it is made, the same permanence rule `createSection`
  follows for the Section tool. `massing.js` gained a fourth camera mode
  (`"elevation"`, alongside orbit/look/section) so the interactive massing
  view can pan and zoom an elevation exactly as it already does a section,
  minus the clip and the hatch.

- **A callout crops the plan; it does not extrude a new direction.**
  `ribbon.js`'s `callout` (Output > Views, "the TSP callout head") used to
  read "needs its own crop/view mechanism" as a Week 3 todo. Unlike a
  section or an elevation, a callout is not an orthographic view from a new
  direction, so [callout.js](callout.js) shares none of section.js's/
  elevation.js's u/v projection maths - its only geometry is a rectangle in
  the plan's own x/y, `calloutFromClicks()` turning two plan clicks (the
  same click-click shape Section's cut line and camera.js's look use, for
  the same reason: a box needs two opposite corners exactly as a cut needs
  two endpoints) into a crop, saved immediately as a named view the same
  permanence rule `createSection`/`createElevation` follow. A callout also
  carries its own `scale` - the "blow-up factor" the customer's brief named -
  which stays `null` until the firm sets one and, when set, wins over
  `sheetScale()`'s auto-fit recommendation (though a sheet's own explicit
  `scaleOverride` still wins over that): the whole reason to draw a callout
  rather than rely on the parent view is to read bigger than "fits" would
  otherwise compute. `sheets.js`'s `sheetView()`/`setSheetView()` union grew
  a third viewport kind (`plan | section | elevation | callout`) alongside
  elevation, falling back to plan if the referenced callout is deleted, and
  `ui.js`'s Sheets panel draws it by reusing the plan branch's own
  schematic-drawing code windowed to the crop rectangle rather than
  building a second drafted-view renderer. What is deliberately still not
  here: a drafted detail view with its own openings/dimensions distinct
  from the plan's, and any on-plan "callout head" marker/bubble showing
  where the crop sits - sections and elevations do not draw an on-plan
  marker yet either, so this is not a gap unique to callout.

- **Document > Lines is one object, two ribbon buttons.** `model-lines` and
  `annot-lines` used to both read "Week 3, with the sheet system" as a todo.
  Unlike section/elevation/callout, a line is simple enough that it did not
  get its own file: `model.js`'s `LINE_KINDS` (`["model", "annotation"]`)
  documents the one distinction between the two buttons, `doc.lines` holds
  both (level-scoped, no SKU - a line is a mark, not a catalog item), and
  `ui.js` commits one with the beam tool's own click-click shape (`tool`
  itself is `"model-line"` or `"annot-line"`, the same "the tool value
  carries the choice" pattern `"section"`/`"elevation"`/`"callout"` already
  use, rather than a second state variable). A model line ghosts to a
  neighbouring level exactly as a wall/beam does - it is a modelled fact,
  even though it is flat - and prints on a sheet's plan/callout viewport; an
  annotation line does neither: it is a drafting mark on this drawing only,
  the same distinction Revit draws between a Model Line and a Detail Line.
  Neither compiles into a 3D face, a schedule row, or the DXF/IFC export -
  compile.js never reads `doc.lines`, and wiring either kind into the
  Exchange exports is a separate, later decision, not a silently dropped one.
  Because both kinds are just endpoint geometry with no SKU, `modify.js`'s
  rotate/mirror/copy/align/split/cut/join all work on a line for free via its
  existing `ENDPOINTED` set (now `segment | beam | line`); attach/detach stay
  narrower, gated on the pre-existing `ATTACHABLE_KINDS` (`segment | beam`
  only) instead, since a line has no template-stated height for a base to
  resolve against.

- **A revision cloud is an annotation on top of a viewport, not a fifth
  viewport kind.** `ribbon.js`'s `revision` (Document > Annotate) used to
  read "Week 3, with the title block revision history" as a todo - that
  history (`sheets.js`'s `addRevision`/`revisionLetter`) already existed, so
  what was missing was purely the drawing/linking half, now
  [revision.js](revision.js). A cloud is a rectangle in the plan's own x/y,
  the same two-click shape `callout.js`'s crop box uses (`revisionCloudFromClicks`),
  but it is not itself a sheet viewport the way a callout is: it is drawn
  *over* whichever viewport a sheet already shows, so it lives in its own
  `doc.revisionClouds` rather than joining `sheetView()`'s
  `plan | section | elevation | callout` union. `createRevisionCloud` always
  saves the cloud unlinked (`sheetId`/`rev` both `null`) the moment the box is
  dropped - the same permanence rule every other Week 3 view follows - and
  `linkRevisionCloud` is a deliberately separate, later step, because
  guessing which future revision a freshly drawn cloud belongs to would
  invent a fact nobody supplied. It is the one integrity block this file
  enforces: a link is refused outright if the target sheet has not actually
  issued that revision letter yet (`sheets.js`'s `addRevision` is the only
  thing allowed to mint one), never accepted with an invented revision to
  make the link succeed. The Sheets panel's new "Revision clouds" list only
  ever offers a sheet's own `revisions` as link targets, so there is no path
  to link a cloud to a revision that does not exist. `cloudArcs()` is the
  one piece of drawing logic here - a fixed-radius scalloped outline around
  the rectangle's four edges, the visual feature that reads as "a cloud"
  rather than "a box" - returned as world-space circles so `ui.js` decides
  how to project and stroke them rather than this file assuming a canvas.
  Like a line, a cloud is level-scoped but not a modelled fact and does not
  ghost to a neighbouring level; unlike a line it draws nowhere on the main
  plan canvas at all (only its own two-click draft does, mid-draw) - the
  same "no on-plan marker yet" gap `callout` already carries, not a new one.

## The drawing leaves as CAD for a Revit user who has no add-in

[dxf.js](dxf.js) writes a millimetre DXF (Output > Exchange > Export CAD).
**File → Open will not load it** — that command only lists Revit projects.
What Revit does without any add-in is **Insert → Link CAD** (or Import CAD),
Files of type DXF, into the firm's template. The result is 2D linework to
trace (wall outlines, door swings, window marks, room names), one layer per
storey, not native walls. `.dwg` is Autodesk's closed CAD format and is not
written here; DXF is the text equivalent Revit's CAD importer already reads.

IFC remains available (Export IFC) for a machine that can File → Open → IFC
and Save As a project. It is not the path that works when the recipient only
has stock Revit and expects File → Open to behave like a drawing.

[ifc.js](ifc.js) still writes IFC 2x3. `.rvt` remains something only Revit
can create.

What that costs, stated rather than hidden:

- **Types arrive by name, not by identity.** Revit's IFC importer creates one
  type per distinct `ObjectType` string, so we write the template's own
  "family : type" there, straight off `sku.revit` (which `build-pack.js` reads
  from Export Catalog). The imported wall is therefore labelled
  `Basic Wall : Masonary wall 220mm (plaster)` and a user maps it to the real
  template type in one step. A SKU with no recorded template type falls back to
  its own SKU name and is **reported**, never given a lookalike type - the same
  rule `build-pack.js` applies to an unmapped Revit category.
- **Geometry is `compile()`'s, never re-derived.** Wall heights and base
  elevations are the *attach-resolved* ones, so an IFC wall standing on a
  foundation lands at the elevation the BOQ priced it at. `compile()`'s payload
  gained one additive field for this, `walls[].level`, so the exporter can file
  a wall under a storey without deriving walls a second time.
- **Canvas y is negated on the way out.** The plan canvas draws +y downwards;
  Revit and IFC put +y north. Without the flip the house imports mirrored about
  its own east-west axis, which reads as a plausible plan and is not one. That
  is the only coordinate change made - no re-origining and no rotation, because
  the plan is already assumed true-north and true-scale, the same assumption the
  underlay calibration and the SG reference point make.
- **Scope is the permit-drawing core**: levels, walls, doors, windows, rooms.
  Floors, roofs, beams, stairs and placed items are already compiled and are a
  later addition to this file rather than a redesign of it - a scheduling block,
  not an integrity one.

Three things carry over from the pack's own rules:

1. **Unknown stays unknown.** A room with no ceiling height exports as a named
   space with no solid rather than one extruded to a believable height, and a
   null `rateRef` is an absent property rather than a `0`.
2. **A fact we cannot write is reported, not guessed.** A wall with no
   thickness or no resolvable height is skipped and named in the report, which
   the Export panel shows rather than swallowing.
3. **Rates are referenced, not embedded.** Each element carries `SP_SKU`
   (SKU id, unit, rate reference, colour class, status, planner id) and
   `SP_Schedule` (the measures that SKU declares), so the imported model is
   still priceable against a rate book the file itself does not contain.

`GlobalId`s are derived from each element's own planner id rather than randomly,
so re-exporting an unchanged drawing produces byte-identical ids. That is what
makes a revised file a revision rather than a second copy of the building.

## The document has an identity, and one save path

Two optional keys, both filled by `normalizeDoc()`, so every document written
before they existed still opens:

| Key | Default | Role |
|---|---|---|
| `id` | a new id on `emptyDoc()` | The drawing's stable identity, generated by the client. It is what a stored row will be keyed by; today it survives a reload |
| `name` | `null` | The job name the builder typed. Never "Untitled Project": `titleBlockFields().projectName` prints it, and prints `—` when it is null. It is deliberately **not** `pack.name` - the pack is the firm's template, so printing it where the client's job name belongs is a plausible default rather than a fact |
| `projectInfo` | `{ jobNumber: null, clientName: null }` | Filled by `ribbon.js`'s `project-info` command (ui.js's Project information panel), the Week 3 item that used to read "feeds the title block" as a todo. Doc-wide, not per-sheet, unlike a sheet's drawn-by/checked-by/date - one job has one job number - and never merged into the pack, since these are the client's own facts, not the firm's template |

`hasJobContent()` sits beside `PlanStore.hasContent()` and answers a different
question. `hasContent()` is about drawn plan geometry, which is what the canvas
legend and the empty-canvas hint care about. `hasJobContent()` is about whether
there is work worth keeping, so it also counts openings, items, beams, stairs,
sheets, inserted levels, revealed floors, the site boundary and an underlay - a
job that is so far only a site boundary is a real job. `packId` is not content:
it is set on every document the moment a pack loads.

**Saving goes through a sink, not `localStorage` directly.** Every mutation still
calls `store.persist()`; `persist()` now hands the document to
[sync.js](sync.js), which coalesces a burst of edits into one write ~1.5 s after
the last one, and reports a state the chrome shows verbatim: `saved`, `pending`,
`saving`, `offline` with a queue count, or `conflict`. An unconfirmed write is
never rendered as "Saved" - the same "unknown is never a plausible default" rule
this document applies to a SKU, applied to a save indicator.

`sync.js` is for the drawing only. Its contract - coalesce, then overwrite
against an `If-Match` revision - suits a canvas someone is dragging walls around
in, and is wrong for a quote or a legal document, which are records that need an
audit trail rather than a scheduler.

## There is no job file. The drawing is a row under a job

The document's home is a `drawing` row in Postgres, beneath a `project` row that
is the job; the server in [../../server/](../../server/) is the system of
record, and the plan behind it is
[../../CLOUD-DOCUMENTS-PLAN.md](../../CLOUD-DOCUMENTS-PLAN.md). Three
consequences worth stating here rather than leaving to be discovered:

- **A job is not a drawing.** The drawing is the first artefact a job owns.
  Quotes, legal documents, supplier correspondence and a timeline become
  siblings hanging off `project` later, not keys inside `doc`.
- **There is no native file format, and no round trip.** Nothing downloads a
  re-openable job. DXF and IFC are unchanged and remain one-way deliverables -
  the distinction that matters is round-trip versus one-way, not open versus
  closed.
- **Nothing is hard-deleted**, and every row carries `created_by` and
  `created_at`. A quote or a legal document without an author and a date is not
  a record, and that cannot be reconstructed after the fact.

The save path is [sync.js](sync.js)'s `httpTransport`: `PUT /api/drawings/:id`
carrying an `If-Match` revision. `200` is adopted, a `409` stops writing and
asks the user to choose between their version and the stored one - never a
merge - and anything else queues and reports "Offline", never "Saved". A `401`
is not queued: the session expired, the write is not going to land however long
it waits, so the chrome asks for a sign-in instead.

[cloud.js](cloud.js) is the other half - accounts and the job library - and is
deliberately a separate file for the same reason `sync.js` is drawing-only.
[library.js](library.js) is the behaviour on top of it, with no DOM in it: the
five commands that replaced Save and Open, and the rule in front of all of them.

`doc.name` is the single source of truth for the job's name: the server copies
it onto `project.name` on every accepted save, so the library and the printed
title block cannot disagree.

**The commands are New, Open, Rename, Duplicate and Delete.** There is no Save,
no Save As, no Clear and no file picker, because none of them replaces anything
in place: each one navigates to a different row and the open job is already
saved. Two of the consequences are visible in the UI and are deliberate:

- **Every switch of job flushes first, and refuses to navigate while a write is
  unconfirmed.** `DocSync.attach()` throws rather than adopting another job's
  document over a standing queue, and the library says so in a sentence. Those
  queued documents belong to the job being left; a silent discard is the data
  loss this whole design exists to prevent.
- **A library row shows a name, an erf and dates, and no thumbnail.** Rendering
  one needs the geometry; a placeholder image would be a picture of a job nobody
  drew, which is the plausible default this document refuses for a SKU. A job
  with no name shows `—`, exactly as the title block prints it.

New, Duplicate, Delete, Rename and the library itself need the server. While the
save path reports `offline` those commands are disabled with that as the reason,
rather than failing after the click. Offline *editing* is step 7 of the plan and
is not a merge engine.

**The underlay is no longer session-only.** It becomes an `asset` row with
`doc.underlay` keeping placement plus an `assetId`, so a job opens on a second
device with its scan and its scale intact. The table exists; the route is step 6.

**Site notes are rows, not a document key** (`project_note`). Two devices' notes
both arrive and cannot conflict, which is precisely why note-taking is allowed
offline when geometry editing is not. The table exists; the route is step 8.

## Open decisions carried into week 2

1. **`floorToCeiling` was null on every level; the real export supplies it.**
   Export Catalog states 2.902 m on all four template storeys, so Part C heights
   (2.4 m over 70% of a habitable room, 2.1 m in a passage) can now be checked
   against a real value rather than the optimistic `system.wallHeight` fallback.
   Two cases still hit that fallback and still need the bound below: a level the
   user inserted (null by design, see "Levels the user inserts"), and a target
   whose type states no height. Confirming that 2.902 m is intended on the
   foundation storey too is an open ask - see
   [../../TEMPLATE-ASKS.md](../../TEMPLATE-ASKS.md).

   **Bounded, not closed** (required before base attach landed, see
   [../../LEVEL-ATTACH-PLAN.md](../../LEVEL-ATTACH-PLAN.md) rollout step 6): an
   attach chain resolves **one hop only**, so a wall's elevation absorbs that
   optimistic fallback at most once - exactly as it did before attach existed -
   rather than once per hop up a chain. A second hop is warned about and falls
   back to the level datum. Deeper chains stay out of scope until this gap is
   actually closed with real floor-to-ceiling values from the template.
   Relatedly, `resolvedBase` will **not** substitute `system.wallHeight` for a
   *target's* missing height: a target whose type states no height is reported
   as an unresolved attach, because an invented elevation underneath a real wall
   is the same category of mistake as a guessed R-value.
2. **Concave `roomMinDimension` is an upper bound.** Exact for anything built
   from rectangles, which is everything the week-1 UI can draw; the value is
   flagged per room as `minDimensionExact` so the rule engine can downgrade a
   free-polygon result to advisory.
3. **`locale.energyZone` and `locale.municipality` are null.** The first selects
   the XA R-value tables and is still unused. The second now also selects the
   zoning setback distance (`RULE_PACK.zoning.setbackByMunicipality`), which
   only covers a handful of municipalities - an unlisted one is `unknown`,
   never a guessed setback.
4. **Rule packs are not in this schema.** Regulation thresholds live in a
   separate versioned document with an effective date, per the plan. Nothing in
   the pack should ever contain a limit from a standard.

## Files

| File | Role |
|---|---|
| [schema.js](schema.js) | Enums, required keys, `validatePack()`, `complianceGaps()` |
| [geom.js](geom.js) | Polygon and segment maths, rectangle union |
| [model.js](model.js) | Document model, shapes, room measures, store, v1 migration |
| [sync.js](sync.js) | The drawing's save path: coalescing writes, an honest save state, the `If-Match` transport |
| [cloud.js](cloud.js) | Accounts and the job library's requests, plus the one-time import of the old browser slot |
| [library.js](library.js) | New, Open, Rename, Duplicate: flush-before-navigate, and what a row shows |
| [../../server/](../../server/) | The system of record: accounts, `project` and `drawing` rows |
| [walls.js](walls.js) | Wall derivation from polygons |
| [openings.js](openings.js) | Host validation, opening placement, Part O areas |
| [compile.js](compile.js) | Extract payload, recipes, quantities, base-attach resolution |
| [schedule.js](schedule.js) | BOQ (priced) and BOM (unpriced) rollups of `compile()`'s instances, one line per SKU |
| [ifc.js](ifc.js) | IFC 2x3 export: a model file Revit can Open → IFC, then Save As |
| [dxf.js](dxf.js) | DXF export: 2D CAD Revit inserts with Link CAD, no add-in |
| [migrate-pack.js](migrate-pack.js) | v1 to v2 pack migration plus gap report |
| [build-pack.js](build-pack.js) | Revit type catalog to v2 pack, plus assumption report |
| [catalog-from-tsv.js](catalog-from-tsv.js) | The family report as a stand-in catalog |
| [ribbon.js](ribbon.js) | The customer's four toolbars plus Check |
| [rules.js](rules.js) | Week 2: the SANS rule pack and `evaluateCompliance()` |
| [site.js](site.js) | Week 2: property line, SG reference, building line |
| [sheets.js](sheets.js) | Week 3: A0-A4 title blocks, scale, revisions, and `view-section`'s plan/section/elevation/callout viewport chooser |
| [elevation.js](elevation.js) | Week 3: compass-direction elevation cuts, reusing section.js's u/v projection |
| [callout.js](callout.js) | Week 3: boxed detail crop of the plan and its own blow-up scale - no projection maths, unlike section/elevation |
| [revision.js](revision.js) | Week 3: revision cloud - a drawn, scalloped annotation linked to a sheet's already-issued revision letter |
| [modify.js](modify.js) | Rotate, mirror, copy, align, merge, split, cut, join, attach/detach base |
| [underlay.js](underlay.js) | PDF and image underlay with two-point calibration |
| [tests/](tests/) | 558 tests over all of the above |
