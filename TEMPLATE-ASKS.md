# Asks for the firm

Every **template block** in [PHILOSOPHY.md](PHILOSOPHY.md)'s sense: something the
app cannot do because the template does not state it, and which no amount of
code will fix. A template block is a question addressed to TSP, not a refusal,
so each entry says what is missing, what it currently costs, and what would
clear it.

Regenerate the fact counts with `npm run build-pack` in `web/v2`; the numbers
below are from `output/type-catalog.json` (Export Catalog, 16 Sep 2026):
**419 template types, 146 placed, 113 SKUs, validation PASS, 139 compliance
facts unknown across 45 SKUs.**

## 1. Families the template does not contain

Each of these is a feature that exists in code and has nothing to place.

| Ask | Blocks | Cleared by |
|---|---|---|
| **Pool** family | `pool` is a valid SKU category with required geometry and measures, and no Revit category maps to it. A pool is one of the work types a builder may submit **without** SACAP registration, so this blocks the most commercially valuable submission path. | One pool family in the template |
| **Carport** family | Same as above - `carport` is schema-ready and unreachable. Also a non-SACAP work type. | One carport family |
| **Ramp** type | `ribbon.js`'s Ramp button, disabled with "the firm must supply one". Also Part S accessibility. | One ramp type |
| **Finishes** types | `ribbon.js`'s Finishes button. Needs a finishes SKU category, which needs types to justify it. | A finishes family set (floor, wall, ceiling finishes) |
| **Openable window types** | The template has one openable type (`TSP_Window-Casement-Triple-Side-Transom`) against four fixed. A fixed pane contributes light but no ventilation, so Part O ventilation has almost nothing to count. | Confirming which openable types the firm actually uses |

## 2. Compliance facts the template does not state

139 facts across 45 SKUs. Grouped by what the gap actually stops:

**SANS 10400-XA (energy) - cannot be checked at all.** `rValue` (11: ceiling,
floor, roof, wall), `uValue` (12: door, window), `sealed` (12: door, window),
`shgc` and `glazingLayers` (5 each: window), `surfaceDensity`, `rendered`,
`cavity`, `thermalBreakRValue` (3 each: wall), `nonResistanceFraction` (8:
water heaters), `insulationRValue` / `underlay` / `radiantBarrier` /
`compressible` (2 each: roof). These come from supplier certificates rather
than from Revit, so they are a document-collection job, not a modelling one.

**SANS 10400-O (light and ventilation).** `openableAreaFraction` on the one
openable window type. Until it arrives, Part O ventilation reports "cannot
check" rather than a pass - which is correct behaviour, and useless to a
builder.

**SANS 10400-N (glazing).** `safetyGlazed` on all 5 window types.

**SANS 10400-M (stairs).** `solidRisers`, `treadOverlap`, `landingLength`,
`maxFlightRise`, `winders` - one each, on the single `TSP_Monolithic Stair`
type. Five small answers close the whole Part M check.

**SANS 10400-P (drainage).** `trapDiameter`, `fixtureUnits`, `requiresVent`
(9 each: sanitary fixtures), `minGradient` and `ventDiameter` (2 each:
drainage), plus one `dischargeType` and one `requiresGully`.

**Structure and construction.** `loadBearing` (5: columns and walls),
`suspended` and `exposed` (5 each: floors), `external` (7: doors).

## 3. Decisions only the firm can make

**The 21 placed Detail Items.** `build-pack.js` reports these as unmapped
rather than dropping them silently, and they are not one thing - they are four:

- **11 `FIRE_*` symbols** (hydrant, hose reel, extinguisher, sprinkler, smoke
  detector, break-glass, alarm trigger, egress arrows). These are countable,
  schedulable, priced equipment and they are exactly what SANS 10400-T asks a
  drawing to show. Recommendation: **a new `fire` SKU category**, placed and
  counted the same way the 64 electrical SKUs are.
- **5 standard drawing details** (`Drg 11745`, `Drg 13299EC Figure A21`,
  `Drg. 874` accessible toilet, `Drg.11017_11017a` stair detail). These are
  reference details a sheet carries, not things placed in a plan.
  Recommendation: sheet content, once sheets place views.
- **3 filled regions** (`BRICK RED`, `CONCRETE`, `CONCRETE 2`) and **2 break
  lines**. Annotation. Recommendation: leave excluded, and reuse the filled
  region names as the source for the Filled region command's colour
  conventions rather than inventing a palette.

**`locale.municipality` and `locale.energyZone` are both null.** The first
selects the zoning setback distance, the second the XA R-value tables; neither
can be guessed. The real question is whether they belong to the template (one
firm, one town) or to the job. Recommendation: the job, with the template
supplying a default.

**Foundation types state no height.** The attach feature warns
`target-height-unknown` rather than inventing an elevation, which means the most
common real attach - a wall onto a foundation - cannot resolve. One height per
foundation type clears it.

**236 assumed dimensions.** Most do not matter: 192 of them are the 64
electrical SKUs' placeholder 86 mm width/depth/height, and those are count-only
items priced as PC sums, so their geometry is never measured. The ones worth
confirming are the geysers (600 × 600 × 1500), the sanitary fixtures (400 mm
depth/height), the monolithic stair's 900 mm width, and the 200 mm foundation
depth.

## 4. Already cleared

Kept so the list shows movement, and so stale statements elsewhere get caught:

- **Floor-to-ceiling is no longer unknown.** The real Export Catalog states
  2.902 m on all four levels, so `SCHEMA.md`'s open decision 1 ("`floorToCeiling`
  is null on both levels") is stale and Part C height checking is unblocked.
  Worth confirming that 2.902 is intended on the foundation storey too.
- **Levels come from the template verbatim** - `00 FOUNDATION` (−0.6),
  `01 GFL` (0), `02 L1` (3), `03 L2` (6) - no longer inferred. A storey beyond
  these four is now the user's to insert, not a template gap.
- **Door material notation is confirmed** from the type names, so timber doors
  are notated as timber instead of falling back to `other`.

## Not asks

For clarity, because they have been mistaken for template gaps: the template's
**90+ views and its `TSP_SHEET_A1` / `TSP_SHEET_A3` / `TSP_COVER PAGE_A1` title
blocks are already exported** in `output/type-catalog.json` and simply not read
by `web/v2` yet. That is our work, not the firm's.
