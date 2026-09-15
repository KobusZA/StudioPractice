# Migration plan: linear measurements → millimetres

Status: **proposed, not started**. This document describes the change; no code
has been touched yet. Nothing here is binding until it's reviewed — it exists
so the scope, the breaking points, and the rollout order are agreed before any
schema or extractor code moves.

## Decision

Switch **linear dimensions** (lengths, thicknesses, widths, heights, depths,
sill/riser/going heights, perimeters, structure width, layer width, etc.) from
metres to **millimetres**, matching the QS workbook (`calculators/*.csv`) and
the wall-type naming convention already in the template ("220mm Foundation
Perimeter", etc.).

**Areas and volumes stay in m² / m³.** mm² and mm³ produce unwieldy numbers
(a 4 m² wall face is 4,000,000 mm²) and nothing in the codebase currently
needs mm-precision area/volume — leaving them in metric area/volume avoids
reintroducing exactly the inconsistency this migration is meant to remove.

Counts (`ea`), angles, and non-dimensional facts (density, R-value, cost
rates) are unaffected.

## Why now, and why not further

- Every length value currently passes through `UnitUtils.ConvertFromInternalUnits(_, UnitTypeId.Meters)`
  on the Revit side and is stored as a decimal metre (e.g. `thickness: 0.22`)
  on the web side. There is no feet/inch leakage anywhere in the JSON
  boundary today — this is a metres→millimetres change, not a "fix mixed
  units" change.
- The only place mm already appears is as a **display-formatting** step in
  the legacy `web/app.js` / `web/planner.js` UI (`fmtMm`, `mmFromMeters`,
  `Math.round(sku.width * 1000) + " mm"`). This migration removes that
  conversion layer by making the stored value already be what's displayed.

## Breaking-change scope

### 1. `web/v2/SCHEMA.md` + `web/v2/schema.js` — the pack schema is frozen

`web/v2/SCHEMA.md` states the schema is **frozen** for the demo build:
"renaming or removing a key is not [fine] ... Anything that would break the
frozen surface waits for `sp.pack/3`."

Changing what `geometry.thickness` *means* (0.22 → 220) without renaming the
key is exactly the kind of silent breaking change the freeze exists to
prevent. Required steps:

- Bump `PACK_SCHEMA` in `web/v2/schema.js` from `"sp.pack/2"` to `"sp.pack/3"`.
- Update `web/v2/SCHEMA.md` to document the new convention explicitly per
  block (geometry linear fields in mm, area/volume in m², m³) and record the
  version bump in a changelog section.
- Every `REQUIRED_GEOMETRY` key in `schema.js` (`thickness`, `width`, `height`,
  `depth`, `sill`, `riser`, `going`, etc. — `web/v2/schema.js:99-117`) needs a
  written note of its new unit next to the key.

### 2. `web/v2/build-pack.js`, `web/v2/migrate-pack.js`, `web/v2/catalog-from-tsv.js`

These are the scripts that turn Revit's `sp.catalog/1` dump and the QS TSV
exports into an `sp.pack/2` (soon `/3`) pack. They currently assume metres in,
metres out for `geometry.*`. Plan:

- `migrate-pack.js`: add a one-time conversion step (× 1000, rounded to a
  sensible integer-mm precision) for every linear geometry field when
  migrating an old `sp.pack/2` pack to `/3`. This is what turns
  `web/samples/planner-pack-v2.json` from the old convention to the new one
  without hand-editing 18+ SKUs.
- `build-pack.js` / `catalog-from-tsv.js`: since `TypeCatalogPayload.Units`
  will become `"millimeters"` server-side (see below), these scripts stop
  doing any unit math for linear fields — they just pass the number through.
  Any existing `* 1000` / `/ 1000` conversions they contain today need to be
  found and removed, not added to.

### 3. `web/v2/geom.js`, `web/v2/walls.js`, `web/v2/dimensions.js`, `web/v2/openings.js`, `web/v2/snap.js`, `web/v2/modify.js`

All internal geometry math (wall endpoints, polygon perimeter/area, snapping
tolerance, opening placement) currently operates in metres as its working
unit, independent of what's stored in the pack. Two sub-options:

- **(a) Keep internal math in metres**, and only change the *pack/JSON*
  representation — convert mm → m on load and m → mm on save. Smaller diff,
  keeps `KEY_DP` snapping tolerance semantics unchanged
  (`web/v2/geom.js:10`, `0.1 mm` keying tolerance stays `0.0001` internally).
- **(b) Move internal math to mm** too, so the whole app is unit-consistent
  end to end. Larger diff (touches every geometry function, snapping
  epsilons, area formulas which would need to report m² by dividing mm² by
  10⁶), but removes a conversion seam entirely.

Recommendation: **(a)** for this pass — smallest blast radius, and it's the
only part of this plan that touches render/interaction code rather than
data-shape code. Revisit (b) separately if float drift at the pack boundary
becomes a real problem.

### 4. `web/v2/tests/*` (`core.test.js`, `dimensions.test.js`, `schema-forward.test.js`,
`build-pack.test.js`, `underlay.test.js`, `modify.test.js`)

Every fixture and assertion that hardcodes a metre value for a geometry field
needs updating. `schema-forward.test.js` in particular is likely asserting
against `PACK_SCHEMA === "sp.pack/2"` and old-shaped fixtures — it needs a
new fixture pair (old pack in `/2`, expected pack in `/3`) to prove
`migrate-pack.js`'s conversion step is correct.

### 5. `web/samples/planner-pack-v2.json`

The one committed sample pack. Needs regenerating via the updated
`migrate-pack.js` conversion step (not hand-edited) so it exercises the same
path a real firm's pack would take, and gets renamed/versioned to reflect
`sp.pack/3` (or kept at the same path if the schema module is the only
version signal — decide during implementation).

### 6. C# connector — `Models/BomPayload.cs`, `Models/TypeCatalogPayload.cs`

- `BomPayload.Units` (`Models/BomPayload.cs:29`) currently
  `"meters / square meters / cubic meters"` → becomes
  `"millimeters (length/perimeter) / square meters / cubic meters"` or split
  into two explicit fields (e.g. `lengthUnits`, `areaUnits`, `volumeUnits`)
  so downstream consumers don't have to parse a sentence to know what a
  `BomLine.Length` actually is.
- `TypeCatalogPayload.Units` (`Models/TypeCatalogPayload.cs:25`) currently
  `"meters"` → same treatment; the doc comment on `TypeCatalogPayload`
  ("A raw dump of every type in the template, in metres") and on
  `TypeParams`/`StructureWidth` (`Models/TypeCatalogPayload.cs:80,90`)
  need rewording to "in millimetres" once the extractor changes (below).
- Fields affected: `BomLine.Length`, `TakeoffInstance.Length` /
  `.Perimeter`, `SketchForm.Sill`, `SketchLoop.Length`, `SketchCurve.Length`
  / `.Start` / `.End` (these last two are coordinates, not lengths — decide
  whether sketch point coordinates move to mm too, since they feed the same
  plan sketches the web app renders), `CatalogType.StructureWidth`,
  `CatalogType.TypeParams` (only the length-valued entries — this dictionary
  mixes length and non-length numeric params today and has no per-key unit
  tag, which is worth flagging as a separate follow-up), `CatalogLayer.Width`,
  `CatalogTitleBlock.Width`/`.Height`. `BomLine.Area`/`.Volume` and
  `TakeoffInstance.Area`/`.Volume` stay in m²/m³ and are unaffected.

### 7. C# connector — extractors (`Extraction/BomExtractor.cs`,
`Extraction/TypeCatalogExtractor.cs`, `Extraction/MeshExtractor.cs`)

- Every `UnitUtils.ConvertFromInternalUnits(_, UnitTypeId.Meters)` call that
  feeds a *linear* field needs its `UnitTypeId` argument changed to
  `UnitTypeId.Millimeters`. The `UnitTypeId.SquareMeters` /
  `UnitTypeId.CubicMeters` calls (`Extraction/BomExtractor.cs:1239,1242`)
  are untouched.
- `Extraction/TypeCatalogExtractor.cs:368-369` — the `ToMeters(double feet)`
  helper needs renaming (e.g. `ToMillimeters`) and re-pointing at
  `UnitTypeId.Millimeters`. Same for the equivalent helper in
  `Extraction/MeshExtractor.cs:244` — but note this one feeds `positions`
  (mesh vertex coordinates for 3D rendering), which is a candidate for
  staying in metres for the same reason as sketch-curve coordinates above:
  worth explicitly deciding "coordinates stay in metres, only named
  dimensions move to mm" vs. "everything numeric moves to mm," rather than
  letting it fall out implicitly per-file.
- `Extraction/BomExtractor.cs:1085,1164` (`UnitUtils.ConvertToInternalUnits`
  for hardcoded fallback constants, e.g. `0.12` metre fallback depth) need
  their literals changed to the mm equivalent (`120`) with the `UnitTypeId`
  argument updated to match.

### 8. `DrawWallCommand.cs:125`

`UnitUtils.ConvertToInternalUnits(3.0, UnitTypeId.Meters)` — this is a
default wall length constant. Whether this needs to change depends entirely
on decision point below (does this constant represent a value a human reads,
or a purely internal default). Likely: change to `3000.0` /
`UnitTypeId.Millimeters` for consistency, but it's cosmetic since it never
leaves the Revit API boundary.

### 9. Legacy `web/app.js`, `web/planner.js`

These already do mm *display* conversion (`fmtMm`, `Math.round(width*1000)`)
on top of metre-stored data and read `units: "meters / ..."` off the BOM
payload (`web/app.js:1022`, `web/planner.js:1607`). Once the payload is
natively mm:

- Delete the `× 1000` / `mmFromMeters` conversion calls at each read site —
  the raw value is already the display value.
- Update the hardcoded `units` string literals to match the new
  `BomPayload.Units` wording so the two don't drift.
- Confirm whether `web/app.js`/`web/planner.js` are still live or fully
  superseded by `web/v2` — if the latter, this step may be "delete the file"
  rather than "edit the file," which changes the estimate a lot.

## Rollout order (once approved)

1. Land the C# side first (`Models/*.cs`, `Extraction/*.cs`,
   `DrawWallCommand.cs`) behind the existing `.addin`/build — nothing on the
   web side reads live Revit output during tests, so this is a low-risk,
   independently shippable step. Update `Units` string fields in the same
   commit as the extractor changes so a payload is never self-contradictory.
2. Bump `PACK_SCHEMA` to `sp.pack/3` in `web/v2/schema.js`, write the
   `migrate-pack.js` conversion step, and regenerate
   `web/samples/planner-pack-v2.json` through it (never hand-edit the
   sample).
3. Update `web/v2/build-pack.js` / `catalog-from-tsv.js` to stop converting
   (they now pass mm through untouched from the C# payload / TSV).
4. Update `web/v2/SCHEMA.md` with the new convention and a changelog entry.
5. Update/add tests in `web/v2/tests/*`, in particular a `/2` → `/3`
   migration fixture pair.
6. Decide and act on the legacy `web/app.js`/`web/planner.js` question above
   (update display code or delete the files).
7. Only after 1–6 are settled, revisit whether internal geometry math
   (`geom.js`, `walls.js`, `dimensions.js`, `openings.js`, `snap.js`,
   `modify.js`) should also move its working unit to mm (option (b) above),
   as a separate, later change.

## Open decisions to confirm before implementation starts

- Sketch/mesh **coordinates** (`SketchCurve.Start`/`.End`, `ModelMesh.Positions`,
  `MeshExtractor`'s vertex output): stay in metres (3D scene / plan sketch
  coordinate space) or move to mm with everything else?
- `CatalogType.TypeParams` / `InstanceParams`: these dictionaries carry mixed
  length and non-length numeric parameters with no per-key unit tag today.
  Does this migration also add a `typeParamUnits` map, or is that out of
  scope and left as a known gap (same spirit as the `SCHEMA.md` "unknown is
  null, never a plausible default" principle — an unlabeled unit is worse
  than a labeled gap)?
- Rounding/precision: integer mm, or keep decimal mm (sub-mm) precision for
  values that need it (e.g. plaster thickness, layer widths)?
- Whether `web/app.js`/`web/planner.js` (v1) are still in active use or dead
  code to be deleted rather than migrated.
