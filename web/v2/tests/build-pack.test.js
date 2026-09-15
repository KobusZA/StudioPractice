import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPack } from "../build-pack.js";
import { catalogFromTsv } from "../catalog-from-tsv.js";
import { validatePack } from "../schema.js";

const tsv = readFileSync(new URL("../../samples/tsp-template-families.tsv", import.meta.url), "utf8");
const catalog = catalogFromTsv(tsv);
const { pack, assumed, skipped } = buildPack(catalog);

const byName = (needle) => pack.skus.find((s) => s.name.includes(needle));

test("the firm's family report parses into a catalog", () => {
  assert.equal(catalog.schema, "sp.catalog/1");
  assert.ok(catalog.types.length > 100);
  assert.ok(catalog.types.every((t) => t.placedCount > 0));
});

test("a pack built from the template validates", () => {
  const result = validatePack(pack);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("walls, foundations and boundary walls are told apart by type name", () => {
  assert.equal(byName("Masonary wall 220mm (plaster)").category, "wall");
  assert.equal(byName("Masonary wall 220mm Foundation (No-plaster)").category, "foundation");
});

test("dimensional type names yield real geometry", () => {
  assert.equal(byName("Masonary wall 110mm (plaster)").geometry.thickness, 110);
  const door = byName("TSP_Door-Interior-Single-4_Panel-Wood — 850 x 2100mm");
  assert.equal(door.geometry.width, 850);
  assert.equal(door.geometry.height, 2100);
  const footing = byName("Bearing Footing - 600X200 mm");
  assert.equal(footing.geometry.width, 600);
  assert.equal(footing.geometry.depth, 200);
  assert.equal(footing.geometry.thickness, 200);
});

// "TSP 16x3 SWA Elect Feeder Cable" is a cable specification. Reading it as a
// 16 by 3 mm footprint would put nonsense into the drawing and the BoQ.
test("electrical point names are never read as dimensions", () => {
  const cable = byName("16x3 SWA");
  assert.equal(cable.category, "electrical");
  assert.equal(cable.geometry.width, 86);
  assert.ok(assumed.some((a) => a.name.includes("16x3 SWA") && a.key === "width"));
});

test("a fixed pane admits light but no ventilation", () => {
  const fixed = byName("TSP_Window-Fixed — 900 x 1650mm");
  assert.equal(fixed.compliance.providesLight, true);
  assert.equal(fixed.compliance.providesVentilation, false);
  assert.equal(fixed.compliance.openableAreaFraction, 0);
});

// The one openable type in the template. Its openable fraction is still unknown,
// so Part O can report "cannot check" rather than a wrong pass.
test("a casement is openable but its openable fraction stays unknown", () => {
  const casement = byName("Casement-Triple-Side-Transom");
  assert.equal(casement.compliance.providesVentilation, true);
  assert.equal(casement.compliance.openableAreaFraction, null);
});

test("a sliding leaf clears half its opening, a hinged leaf all of it", () => {
  assert.equal(byName("TSP_Door-Double-Sliding").compliance.openableAreaFraction, 0.5);
  assert.equal(byName("Two_Lite_Narrow").compliance.openableAreaFraction, 1);
});

test("timber doors are notated as timber, not as unknown", () => {
  assert.equal(byName("4_Panel-Wood — 850 x 2100mm").drawing.colourClass, "timber");
});

test("geysers become water heaters with their stated capacity and heat source", () => {
  const solar = byName("TSP Geyser Solar 200L");
  assert.equal(solar.category, "waterheater");
  assert.equal(solar.compliance.capacityLitres, 200);
  assert.equal(solar.compliance.heatSource, "solar");
  assert.equal(byName("TSP Geyser Electrcical 150L").compliance.heatSource, "resistance");
});

test("sanitary fixtures carry their discharge type", () => {
  assert.equal(byName("Closed Couple WC").compliance.dischargeType, "soil");
  assert.equal(byName("Hand_Wash_Basin").compliance.dischargeType, "waste");
  assert.equal(byName("Hand_Wash_Basin").compliance.requiresGully, true);
});

test("R-values are never invented", () => {
  for (const sku of pack.skus.filter((s) => s.category === "wall")) {
    assert.equal(sku.compliance.rValue, null);
    assert.equal(sku.compliance.surfaceDensity, null);
  }
});

test("the system defaults are the firm's most-used types", () => {
  assert.equal(pack.skus.find((s) => s.id === pack.system.defaultWallSku).geometry.thickness, 220);
  assert.equal(pack.skus.find((s) => s.id === pack.system.defaultFloorSku).name, "Generic 85mm");
});

// A real template's foundation level sits below datum, so it sorts first by
// elevation. Picking levels[0] as the default (as this once did) would open
// every new document with walls, rooms and ceilings stamped onto the
// foundation level unless the user remembered to switch first - silently
// reproducing the exact "wrong level" mistake the app should be preventing.
test("the default level is never a below-datum level like a foundation storey", () => {
  const belowDatumCatalog = {
    schema: "sp.catalog/1",
    levels: [
      { id: "0", name: "00 FOUNDATION", elevation: -0.6 },
      { id: "1", name: "01 GFL", elevation: 0 },
      { id: "2", name: "02 L1", elevation: 3 },
    ],
    types: [
      { id: "t1", category: "Walls", family: "Basic Wall", type: "Masonary wall 220mm (plaster)", placedCount: 5 },
    ],
  };
  const { pack: belowDatumPack } = buildPack(belowDatumCatalog);
  assert.equal(belowDatumPack.system.defaultLevel, "01 GFL");
});

test("the default level still falls back to the lowest level when every level is below or at datum", () => {
  const allBelowCatalog = {
    schema: "sp.catalog/1",
    levels: [
      { id: "0", name: "B2", elevation: -6 },
      { id: "1", name: "B1", elevation: -3 },
    ],
    types: [
      { id: "t1", category: "Walls", family: "Basic Wall", type: "Masonary wall 220mm (plaster)", placedCount: 5 },
    ],
  };
  const { pack: allBelowPack } = buildPack(allBelowCatalog);
  assert.equal(allBelowPack.system.defaultLevel, "B2", "no level at or above datum exists, so this pins the defined fallback rather than leaving it unspecified");
});

test("a 900mm door cannot host in a 110mm wall it does not fit", () => {
  const hosts = pack.recipes.allowedHosts;
  for (const [skuId, allowed] of Object.entries(hosts)) {
    const sku = pack.skus.find((s) => s.id === skuId);
    for (const wallId of allowed) {
      const wall = pack.skus.find((s) => s.id === wallId);
      assert.ok(wall.geometry.thickness >= (sku.geometry.depth || 100) - 1);
    }
  }
});

// Conduit, duct and piping types are all present in the template and all unused.
// The firm counts electrical points instead, so those categories are excluded by
// name rather than falling through as unmapped.
test("unmapped categories are reported, never silently dropped", () => {
  const unmapped = [...skipped].filter(([key]) => key.startsWith("unmapped:"));
  assert.deepEqual(unmapped, []);
});

test("unplaced types are excluded unless asked for", () => {
  const withUnplaced = buildPack(catalog, { includeUnplaced: true }).pack;
  assert.equal(withUnplaced.skus.length, pack.skus.length); // the report only lists placed types
});

// A placed ceiling's "Height Offset From Level" is the firm's own storey
// height, once the extractor has resolved which level it is hosted on. This
// mirrors the real 9mm Plastered Ceilings entry pulled from output/type-catalog.json.
test("floorToCeiling is read from a placed ceiling's Height Offset From Level", () => {
  const ceilingCatalog = {
    schema: "sp.catalog/1",
    levels: [
      { id: "0", name: "00 FOUNDATION", elevation: -0.6 },
      { id: "1", name: "01 GFL", elevation: 0 },
      { id: "2", name: "02 L1", elevation: 3 },
    ],
    types: [
      {
        id: "t1", category: "Walls", family: "Basic Wall",
        type: "Masonary wall 220mm (plaster)", placedCount: 5,
      },
      {
        id: "t2", category: "Ceilings", family: "Compound Ceiling",
        type: "9mm Plastered Ceilings", placedCount: 4,
        instanceLevel: "01 GFL",
        // Millimetres, matching what the real extractor now emits for every
        // length-typed instance param (see TypeCatalogExtractor.cs's units
        // note) - ceilingOffsetsByLevel() converts this back to metres for
        // `floorToCeiling`, which stays a level field.
        instanceParams: { "Height Offset From Level": 2902, Area: 360.4026 },
      },
    ],
  };
  const { pack: ceilingPack } = buildPack(ceilingCatalog);
  const gfl = ceilingPack.levels.find((l) => l.id === "01 GFL");
  assert.equal(gfl.floorToCeiling, 2.902);

  // 02 L1 has no ceiling placed on it in this fixture, so it falls back to the
  // one offset the template does state, rather than staying null forever.
  const l1 = ceilingPack.levels.find((l) => l.id === "02 L1");
  assert.equal(l1.floorToCeiling, 2.902);
});

test("floorToCeiling stays null when the template places no ceilings at all", () => {
  const noCeilingCatalog = {
    schema: "sp.catalog/1",
    levels: [{ id: "1", name: "01 GFL", elevation: 0 }],
    types: [
      { id: "t1", category: "Walls", family: "Basic Wall", type: "Masonary wall 220mm (plaster)", placedCount: 5 },
    ],
  };
  const { pack: noCeilingPack } = buildPack(noCeilingCatalog);
  assert.equal(noCeilingPack.levels[0].floorToCeiling, null);
});
