// Freeze review: prove the v2 schema can already express every object type
// weeks 2 to 4 need, before the schema is declared frozen. If any of these
// cannot be represented, the schema is not ready to freeze.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validatePack, complianceFactsFor, REQUIRED_MEASURES } from "../schema.js";

const basePack = JSON.parse(
  readFileSync(new URL("../../samples/planner-pack-v2.json", import.meta.url)),
);

/** Build a SKU with every compliance fact present, defaulting to null. */
function sku({ id, name, category, unit, draw, geometry, compliance = {}, colourClass, family }) {
  const facts = {};
  for (const key of complianceFactsFor(category)) facts[key] = null;
  return {
    id,
    name,
    category,
    unit,
    draw,
    ...(family ? { family } : {}),
    geometry,
    cost: { rateRef: id, wasteFactor: null },
    compliance: { ...facts, ...compliance },
    drawing: { colourClass, hatch: null, symbol: null },
    schedule: { report: [...REQUIRED_MEASURES[category]], scheduleName: null },
  };
}

// One SKU per capability the plan schedules for weeks 2 to 4.
const FORWARD_SKUS = [
  // Week 2: stairs, required by Part M, the drawing set and the BoQ.
  sku({
    id: "TSP_ST001",
    name: "Concrete stair 900mm",
    category: "stair",
    unit: "ea",
    draw: "stair",
    // Millimetres (sp.pack/3, see schema.js's units note) - matches the rest of
    // basePack now that it's regenerated through migrate-pack.js's mm conversion.
    geometry: { width: 900, riser: 175, going: 260 },
    compliance: {
      solidRisers: true,
      treadOverlap: 0,
      landingLength: 0.9,
      maxFlightRise: 3,
      winders: false,
    },
    colourClass: "concrete",
  }),
  // Week 2: ceilings, required for Part C heights and Part XA.
  sku({
    id: "TSP_CL001",
    name: "Ceiling board 12mm",
    category: "ceiling",
    unit: "m2",
    draw: "fill",
    geometry: { thickness: 12 },
    compliance: { rValue: 0.06 },
    colourClass: "other",
  }),
  // Week 4: sanitary fixtures, needed for drainage derivation.
  sku({
    id: "TSP_WB001",
    name: "Wash basin 500mm",
    category: "sanitary",
    unit: "ea",
    draw: "box",
    geometry: { width: 500, depth: 400, height: 850 },
    compliance: {
      dischargeType: "waste",
      trapDiameter: 0.04,
      fixtureUnits: 1,
      requiresGully: true,
      requiresVent: false,
    },
    colourClass: "other",
  }),
  // Week 4: water heating, which XA requires to be shown on the plan.
  sku({
    id: "TSP_GY150",
    name: "Geyser 150 L heat pump",
    category: "waterheater",
    unit: "ea",
    draw: "box",
    geometry: { width: 500, depth: 500, height: 1400 },
    compliance: { capacityLitres: 150, heatSource: "heatpump", nonResistanceFraction: 1 },
    colourClass: "other",
  }),
  // Week 4: drainage pipe, carrying its own gradient rule.
  sku({
    id: "TSP_DP110",
    name: "uPVC drain 110mm",
    category: "drainage",
    unit: "m",
    draw: "pipe",
    geometry: { diameter: 110 },
    compliance: { minGradient: 1 / 60, ventDiameter: 0.11 },
    colourClass: "drain",
  }),
  // First release: the non-SACAP work types.
  sku({
    id: "TSP_BW220",
    name: "Boundary wall 220mm",
    category: "boundarywall",
    unit: "m3",
    draw: "wall",
    geometry: { thickness: 220, height: 1800 },
    compliance: { loadBearing: false },
    colourClass: "masonry",
  }),
  sku({
    id: "TSP_PL001",
    name: "Swimming pool shell",
    category: "pool",
    unit: "m2",
    draw: "fill",
    geometry: { depth: 1500 },
    colourClass: "concrete",
  }),
  sku({
    id: "TSP_CP001",
    name: "Carport steel 3x6",
    category: "carport",
    unit: "m2",
    draw: "fill",
    geometry: { height: 2400 },
    colourClass: "steel",
  }),
  sku({
    id: "TSP_COL220",
    name: "Column 220x220",
    category: "column",
    unit: "m",
    draw: "box",
    geometry: { width: 220, depth: 220 },
    compliance: { loadBearing: true },
    colourClass: "concrete",
  }),
];

test("schema accommodates every week 2-4 object type", () => {
  const pack = structuredClone(basePack);
  pack.skus.push(...FORWARD_SKUS);
  const result = validatePack(pack);
  assert.equal(result.errors.length, 0, result.errors.join("\n"));
});

test("each forward SKU validates on its own merits", () => {
  for (const forward of FORWARD_SKUS) {
    const pack = structuredClone(basePack);
    pack.skus.push(forward);
    const result = validatePack(pack);
    assert.equal(result.errors.length, 0, `${forward.id}: ${result.errors.join("; ")}`);
  }
});

test("an opening window can be expressed, which the current pack lacks", () => {
  const pack = structuredClone(basePack);
  pack.skus.push(sku({
    id: "TSP_WN1212T",
    name: "Window 1200 x 1200mm top hung",
    category: "window",
    family: "Top-Hung",
    unit: "ea",
    draw: "window",
    geometry: { width: 1200, height: 1200, sill: 900 },
    compliance: {
      providesLight: true,
      providesVentilation: true,
      openableAreaFraction: 0.45,
      glazingLayers: 1,
      sealed: true,
    },
    colourClass: "glass",
  }));
  const result = validatePack(pack);
  assert.equal(result.errors.length, 0, result.errors.join("\n"));

  const added = pack.skus.find((s) => s.id === "TSP_WN1212T");
  assert.equal(added.compliance.providesVentilation, true);
  assert.ok(added.compliance.openableAreaFraction > 0);
});

test("heatSource and dischargeType are closed vocabularies", () => {
  const pack = structuredClone(basePack);
  pack.skus.push(sku({
    id: "TSP_BAD",
    name: "Bad geyser",
    category: "waterheater",
    unit: "ea",
    draw: "box",
    geometry: { width: 500, depth: 500, height: 1400 },
    compliance: { capacityLitres: 150, heatSource: "magic", nonResistanceFraction: 1 },
    colourClass: "other",
  }));
  const result = validatePack(pack);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /heatSource/);
});

test("a stair missing its going is rejected, since Part M cannot be checked", () => {
  const pack = structuredClone(basePack);
  const bad = sku({
    id: "TSP_ST002",
    name: "Stair without a going",
    category: "stair",
    unit: "ea",
    draw: "stair",
    geometry: { width: 900, riser: 175 },
    colourClass: "concrete",
  });
  pack.skus.push(bad);
  const result = validatePack(pack);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /geometry\.going/);
});
