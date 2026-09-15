# SKU pack v2 — frozen schema

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
- **Levels are inferred, not read.** The family report lists Levels as an
  annotation category with a placed count, never names or elevations. A placed
  cast-in-place stair is evidence of a second storey, so `catalog-from-tsv.js`
  synthesises two levels named "(inferred)" so the level switcher has something
  to switch between. `build-pack.js` prints `INFERRED` when it sees this.
  Export Catalog replaces this with the template's real levels and names.

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
  `doc.site.erfNumber` where they exist and an em-dash where they do not -
  the same "unknown is never a plausible default" rule this document states
  for SKU compliance facts, applied to a drawing sheet instead of a SKU.
  Job number, client name and similar project-wide facts are still
  `project-info`'s unbuilt ribbon item; until it lands, drawn-by/checked-by
  are edited per sheet rather than invented as a shared record, so the two
  features do not fight over the same box on the title block later.
- **Revisions are letters, issued once, never reused** (A, B, ... Z, AA, ...),
  because a title block's revision history is part of the record, not a
  scratch value a firm can renumber after the fact.
- **One fixed viewport per sheet, drawn schematically.** The Sheets panel
  (`ui.js`) draws the current plan's walls (centrelines only) and rooms
  (outline only) into the drawable area at the sheet's scale - no openings,
  no dimensions, no per-level split. A movable/resizable viewport, and
  placing a section or elevation instead of the plan, are `view-section`'s
  and `callout`'s job "once sheets exist" - this file is the "sheets exist"
  part they depend on.

## Open decisions carried into week 2

1. **`floorToCeiling` is null on both levels.** Part C heights (2.4 m over 70% of
   a habitable room, 2.1 m in a passage) cannot be checked until the ceiling
   build-up is known. `compile()` currently falls back to `system.wallHeight`,
   which is floor-to-floor and therefore optimistic.
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
| [walls.js](walls.js) | Wall derivation from polygons |
| [openings.js](openings.js) | Host validation, opening placement, Part O areas |
| [compile.js](compile.js) | Extract payload, recipes, quantities |
| [migrate-pack.js](migrate-pack.js) | v1 to v2 pack migration plus gap report |
| [build-pack.js](build-pack.js) | Revit type catalog to v2 pack, plus assumption report |
| [catalog-from-tsv.js](catalog-from-tsv.js) | The family report as a stand-in catalog |
| [ribbon.js](ribbon.js) | The customer's four toolbars plus Check |
| [rules.js](rules.js) | Week 2: the SANS rule pack and `evaluateCompliance()` |
| [site.js](site.js) | Week 2: property line, SG reference, building line |
| [sheets.js](sheets.js) | Week 3: A0-A4 title blocks, scale, revisions |
| [modify.js](modify.js) | Rotate, mirror, copy, align, merge, split, cut, join |
| [underlay.js](underlay.js) | PDF and image underlay with two-point calibration |
| [tests/](tests/) | 154 tests over all of the above |
