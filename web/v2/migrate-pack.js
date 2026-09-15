// Migrate a v1 planner pack to the v2 schema.
//
// Rule: derive only what the v1 data actually states. Anything else is null and
// lands in the gap report for the firm to supply. Physical facts must never be
// invented, because the compliance engine will present them to a plans examiner.
//
//   node web/v2/migrate-pack.js web/samples/planner-pack.json web/samples/planner-pack-v2.json

import { readFileSync, writeFileSync } from "node:fs";
import {
  GEOMETRY_LENGTH_KEYS,
  complianceFactsFor,
  REQUIRED_MEASURES,
  validatePack,
  complianceGaps,
} from "./schema.js";

const COLOUR_BY_CATEGORY = {
  wall: "masonry",
  boundarywall: "masonry",
  foundation: "masonry",
  floor: "concrete",
  ceiling: "other",
  roof: "concrete",
  beam: "concrete",
  column: "concrete",
  window: "glass",
  door: "other", // material not stated in v1; confirm timber vs aluminium
  stair: "concrete",
  sanitary: "other",
  waterheater: "other",
  drainage: "drain",
  electrical: "other",
  furniture: "other",
  casework: "timber",
  pool: "concrete",
  carport: "other",
};

const inferred = [];

function note(skuId, field, reason) {
  inferred.push({ skuId, field, reason });
}

/** Only from the firm's own naming, and always reported. */
function inferPlastered(sku) {
  const n = sku.name.toLowerCase();
  if (n.includes("no plaster")) {
    note(sku.id, "compliance.plastered", 'name contains "no plaster"');
    return false;
  }
  if (n.includes("plaster")) {
    note(sku.id, "compliance.plastered", 'name contains "plaster"');
    return true;
  }
  return null;
}

function complianceFor(sku) {
  const facts = complianceFactsFor(sku.category);
  const out = {};
  for (const key of facts) out[key] = null;

  if (sku.category === "wall" || sku.category === "boundarywall") {
    if ("plastered" in out) out.plastered = inferPlastered(sku);
  }
  if (sku.category === "foundation") {
    out.loadBearing = true;
    note(sku.id, "compliance.loadBearing", "a foundation is load bearing by definition");
  }
  if (sku.category === "beam" && sku.name.toLowerCase().includes("loadbearing")) {
    out.loadBearing = true;
    note(sku.id, "compliance.loadBearing", 'name contains "loadbearing"');
  }
  if (sku.category === "window") {
    out.providesLight = true;
    note(sku.id, "compliance.providesLight", "glazed fenestration admits light");
    // v1 gives every window family "Fixed". A fixed pane does not open, so it
    // contributes nothing to the Part O 5% ventilation requirement.
    if (String(sku.family || "").toLowerCase() === "fixed") {
      out.providesVentilation = false;
      out.openableAreaFraction = 0;
      note(sku.id, "compliance.providesVentilation", 'family is "Fixed", a fixed pane does not open');
    }
  }
  if (sku.category === "door") {
    out.providesVentilation = true;
    out.openableAreaFraction = 1;
    note(sku.id, "compliance.openableAreaFraction", "a door leaf clears its full opening");
  }
  if (sku.category === "sanitary") {
    if (sku.name.toLowerCase().includes("wc")) {
      out.dischargeType = "soil";
      out.requiresGully = false;
      note(sku.id, "compliance.dischargeType", "a WC discharges soil water direct to the soil pipe");
    }
  }
  return out;
}

/**
 * v1 stated every linear dimension in metres. The v2/v3 pack states them in
 * millimetres (see schema.js's units note), matching the QS workbook and the
 * firm's own wall-type naming ("220mm Foundation Perimeter") - so this is the
 * one-time metres-to-millimetres conversion the units migration plan calls
 * for, folded into the same pass that already reshapes v1's flat fields into
 * v2's `geometry` block.
 */
function geometryFor(sku) {
  const g = {};
  for (const key of GEOMETRY_LENGTH_KEYS) {
    if (typeof sku[key] === "number") g[key] = Math.round(sku[key] * 1000);
  }
  return g;
}

function scheduleFor(sku) {
  return {
    report: [...(REQUIRED_MEASURES[sku.category] || ["count"])],
    scheduleName: null,
  };
}

export function migratePack(v1, { id, version, revision } = {}) {
  const sys = v1.system || {};
  const v1Levels = sys.levels || [];
  // Metres throughout this function's own math: `levels[].elevation`/`.floorToFloor`
  // are positions, not named dimensions, and stay metres in the v2/v3 pack (see
  // schema.js's units note). Only `system.wallHeight` itself is converted to
  // millimetres below, once, right before it goes into the output pack - it needs
  // metres here because `floorToFloor`'s fallback below is a level-datum figure.
  const wallHeightMetres = sys.wallHeight ?? 2.8;

  const levels = v1Levels.map((lvl, i) => {
    const next = v1Levels[i + 1];
    const floorToFloor = next
      ? Number((next.elevation - lvl.elevation).toFixed(4))
      : wallHeightMetres;
    return {
      id: lvl.id,
      name: lvl.name || lvl.id,
      elevation: lvl.elevation,
      floorToFloor,
      floorToCeiling: null, // Part C heights need this; ceiling build-up unknown
    };
  });

  const skus = (v1.skus || []).map((sku) => {
    const category = sku.category === "plumbing" ? "sanitary" : sku.category;
    const next = {
      id: sku.id,
      name: sku.name,
      category,
      unit: sku.unit,
      draw: sku.draw || "box",
      geometry: geometryFor(sku),
      cost: { rateRef: sku.id, wasteFactor: null },
      compliance: complianceFor({ ...sku, category }),
      drawing: {
        colourClass: COLOUR_BY_CATEGORY[category] || "other",
        hatch: null,
        symbol: null,
      },
      schedule: scheduleFor({ ...sku, category }),
    };
    if (sku.family) next.family = sku.family;
    if (sku.defaultLevel) next.defaultLevel = sku.defaultLevel;
    return next;
  });

  return {
    schema: "sp.pack/3",
    id: id || sys.id || "pack",
    name: sys.name || "Pack",
    version: version || "2.0.0",
    revision: revision || new Date().toISOString().slice(0, 10),
    migratedFrom: "sp.pack/1",
    locale: {
      country: "ZA",
      municipality: null, // selects submission requirements and drawing scales
      energyZone: null, // selects the SANS 10400-XA R-value tables
    },
    system: {
      wallHeight: Math.round(wallHeightMetres * 1000),
      defaultWallSku: sys.defaultWallSku ?? null,
      defaultFloorSku: sys.defaultFloorSku ?? null,
      defaultFoundationSku: sys.defaultFoundationSku ?? null,
      defaultRoofSku: sys.defaultRoofSku ?? null,
      defaultCeilingSku: null,
      defaultLevel: sys.defaultLevel ?? levels[0]?.id ?? null,
    },
    levels,
    skus,
    recipes: {
      requires: v1.recipes?.requires || [],
      allowedHosts: v1.recipes?.allowedHosts || {},
      maxSpan: v1.recipes?.maxSpan || {},
      minLength: v1.recipes?.minLength || {},
    },
  };
}

export function inferredNotes() {
  return inferred.slice();
}

// --- CLI ------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath) {
    console.error("usage: node migrate-pack.js <v1.json> [v2.json]");
    process.exit(1);
  }
  const v1 = JSON.parse(readFileSync(inPath, "utf8"));
  const v2 = migratePack(v1);
  const result = validatePack(v2);

  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(v2, null, 2)}\n`);
    console.log(`wrote ${outPath}`);
  }

  console.log(`\nSKUs migrated: ${v2.skus.length}`);
  console.log(`Validation: ${result.ok ? "PASS" : "FAIL"}`);
  for (const err of result.errors) console.log(`  ERROR  ${err}`);

  console.log(`\nInferred from the firm's own data (${inferred.length}) - confirm each:`);
  for (const row of inferredNotes()) {
    console.log(`  ${row.skuId.padEnd(12)} ${row.field.padEnd(34)} ${row.reason}`);
  }

  const gaps = complianceGaps(v2);
  const totalMissing = gaps.reduce((s, g) => s + g.missing.length, 0);
  console.log(`\nCompliance facts the firm must supply (${totalMissing} across ${gaps.length} SKUs):`);
  for (const g of gaps) {
    console.log(`  ${g.id.padEnd(12)} ${g.category.padEnd(12)} ${g.missing.join(", ")}`);
  }

  const other = v2.skus.filter((s) => s.drawing.colourClass === "other");
  if (other.length) {
    console.log(`\nMaterial notation unconfirmed (${other.length}) - NBR colouring defaults to "other":`);
    for (const s of other) console.log(`  ${s.id.padEnd(12)} ${s.name}`);
  }
}
